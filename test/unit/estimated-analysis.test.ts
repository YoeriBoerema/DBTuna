import { test } from "node:test";
import assert from "node:assert/strict";
import { PostgresAdapter } from "../../packages/adapter-postgres/src/postgresAdapter";
import { SqlServerAdapter } from "../../packages/adapter-sqlserver/src/sqlServerAdapter";
import { analyzePlan } from "../../packages/plan-analysis/src/analyze";
import { postgresNative, sqlServerNative } from "../helpers/nativePlans.mjs";
const pg = new PostgresAdapter(),
  ms = new SqlServerAdapter();
const postgresJoin = () =>
  pg.parse(
    postgresNative({
      "Node Type": "Nested Loop",
      "Plan Rows": 2000000,
      Plans: [
        {
          "Node Type": "Seq Scan",
          "Plan Rows": 1000,
          "Parent Relationship": "Outer",
        },
        {
          "Node Type": "Index Scan",
          "Plan Rows": 1000,
          "Parent Relationship": "Inner",
          Filter: "lower(name) = 'x'",
        },
      ],
    }),
  );
const sqlJoin = () =>
  ms.parseStatements(
    sqlServerNative({
      operator: "Nested Loops",
      estimate: 2000000,
      body: `<NestedLoops>
<RelOp PhysicalOp="Table Scan" EstimateRows="1000"/>
<RelOp PhysicalOp="Index Scan" EstimateRows="1000" EstimateRebinds="999" EstimateRewinds="0">
<IndexScan><Predicate><ScalarOperator ScalarString="lower([name])='x'"/></Predicate></IndexScan></RelOp>
</NestedLoops>`,
    }),
  )[0];

test("estimated plans for both engines diagnose volume, loop work and predicates without actual counters", () => {
  for (const plan of [postgresJoin(), sqlJoin()]) {
    const before = JSON.stringify(plan);
    assert.ok(plan.nodes.every((node) => !node.actuals));
    const report = analyzePlan(plan);
    for (const id of [
      "estimate.large-result",
      "estimate.repeated-access",
      "estimate.predicate-expression",
    ])
      assert.ok(
        report.findings.some((finding) => finding.ruleId === id),
        `${plan.database.engine}: ${id}`,
      );
    assert.ok(
      report.findings.every((finding) => finding.basis === "estimated"),
    );
    assert.ok(
      report.findings.some(
        (finding) => finding.title === "Potential join row expansion",
      ),
    );
    assert.ok(
      !report.findings.some((finding) =>
        [
          "memory.spill",
          "filter.discarded-rows",
          "cardinality.discrepancy",
        ].includes(finding.ruleId),
      ),
    );
    assert.equal(JSON.stringify(plan), before);
  }
});

test("large sort/hash inputs use input estimates rather than small aggregate output or summed cost", () => {
  for (const operation of ["Sort", "Aggregate"]) {
    const plan = pg.parse(
      postgresNative({
        "Node Type": operation,
        Strategy: "Hashed",
        "Plan Rows": 1,
        Plans: [
          { "Node Type": "Seq Scan", "Plan Rows": 500000, "Plan Width": 200 },
        ],
      }),
    );
    const finding = analyzePlan(plan).findings.find(
      (finding) => finding.ruleId === "estimate.sort-hash-input",
    )!;
    assert.equal(finding.basis, "estimated");
    assert.equal(finding.evidence["Estimated input rows (sum)"], 500000);
    assert.equal(finding.evidence["Estimated input data bytes"], 100000000);
  }
  const plan = ms.parseStatements(
    sqlServerNative({
      operator: "Hash Match",
      estimate: 1,
      body: '<Hash><RelOp PhysicalOp="Table Scan" EstimateRows="500000" AvgRowSize="80"/></Hash>',
    }),
  )[0];
  assert.ok(
    analyzePlan(plan).findings.some(
      (finding) => finding.ruleId === "estimate.sort-hash-input",
    ),
  );
});

test("SQL Server missing-index candidates remain statement-scoped estimates and preserve all columns", () => {
  const index = (
    table: string,
  ) => `<MissingIndexGroup Impact="75"><MissingIndex Database="[db]" Schema="[dbo]" Table="[${table}]">
  <ColumnGroup Usage="EQUALITY"><Column Name="[a]"/><Column Name="[b]"/></ColumnGroup>
  <ColumnGroup Usage="INEQUALITY"><Column Name="[c]"/></ColumnGroup><ColumnGroup Usage="INCLUDE"><Column Name="[d]"/></ColumnGroup>
  </MissingIndex></MissingIndexGroup>`;
  const plan = ms.parseStatements(
    sqlServerNative({
      statementWarnings: `<MissingIndexes>${index("t")}${index("other")}</MissingIndexes>`,
    }),
  )[0];
  const finding = analyzePlan(plan).findings.find(
    (finding) => finding.ruleId === "estimate.native-missing-index",
  )!;
  assert.equal(finding.evidence["Candidate 1 equality columns"], "[a], [b]");
  assert.equal(finding.evidence["Candidate 1 inequality columns"], "[c]");
  assert.equal(finding.evidence["Candidate 1 included columns"], "[d]");
  assert.equal(finding.evidence["Candidate 2 relation"], "[db].[dbo].[other]");
  assert.deepEqual(finding.nodeIds, [plan.rootNodeIds[0]]);
  assert.match(finding.limitation, /not a promised runtime/);
  const separate = ms.parseStatements(sqlServerNative())[0];
  assert.ok(
    !analyzePlan(separate).findings.some(
      (finding) => finding.ruleId === "estimate.native-missing-index",
    ),
  );
});

test("small, missing, cached, partial and constant-only plans avoid speculative findings", () => {
  const small = pg.parse(
    postgresNative({
      "Node Type": "Seq Scan",
      "Plan Rows": 2,
      Filter: "lower('constant') = 'x'",
    }),
  );
  assert.deepEqual(analyzePlan(small).findings, []);
  for (const expression of [
    "lower(N'constant') = 'x'",
    "lower(@parameter)='x'",
    '"lower(name)" = 1',
    "cast('x' as varchar(100))='x'",
  ]) {
    const plan = pg.parse(
      postgresNative({ "Node Type": "Seq Scan", Filter: expression }),
    );
    assert.ok(
      !analyzePlan(plan).findings.some(
        (finding) => finding.ruleId === "estimate.predicate-expression",
      ),
      expression,
    );
  }
  const converted = ms.parseStatements(
    sqlServerNative({
      body: "<IndexScan><Predicate><ScalarOperator ScalarString=\"CONVERT(varchar(100),[name])=N'x'\"/></Predicate></IndexScan>",
    }),
  )[0];
  assert.ok(
    analyzePlan(converted).findings.some(
      (finding) => finding.ruleId === "estimate.predicate-expression",
    ),
  );
  const missing = postgresJoin();
  delete missing.nodes[0].estimates!.rows;
  assert.ok(
    !analyzePlan(missing).findings.some(
      (f) => f.ruleId === "estimate.large-result",
    ),
  );
  const cached = pg.parse(
    postgresNative({
      "Node Type": "Nested Loop",
      Plans: [
        {
          "Node Type": "Seq Scan",
          "Plan Rows": 10000,
          "Parent Relationship": "Outer",
        },
        {
          "Node Type": "Materialize",
          "Plan Rows": 1000,
          "Parent Relationship": "Inner",
          Plans: [{ "Node Type": "Index Scan", "Plan Rows": 1000 }],
        },
      ],
    }),
  );
  assert.ok(
    !analyzePlan(cached).findings.some(
      (f) => f.ruleId === "estimate.repeated-access",
    ),
  );
  const limited = pg.parse(
    postgresNative({
      "Node Type": "Limit",
      Plans: [
        postgresNative({
          "Node Type": "Nested Loop",
          "Plan Rows": 2000000,
          Plans: [
            {
              "Node Type": "Seq Scan",
              "Plan Rows": 10000,
              "Parent Relationship": "Outer",
            },
            {
              "Node Type": "Index Scan",
              "Plan Rows": 1000,
              "Parent Relationship": "Inner",
            },
          ],
        })[0].Plan,
      ],
    }),
  );
  assert.ok(
    !analyzePlan(limited).findings.some(
      (f) => f.ruleId === "estimate.repeated-access",
    ),
  );
  const unscoped = sqlJoin();
  delete unscoped.nodes[2].properties.EstimateRewinds;
  assert.ok(
    !analyzePlan(unscoped).findings.some(
      (f) => f.ruleId === "estimate.repeated-access",
    ),
  );
});

test("extreme row estimates never produce non-finite evidence", () => {
  const plan = postgresJoin();
  plan.nodes[0].estimates!.rows = 1e308;
  plan.nodes[1].estimates!.rows = 1e-308;
  plan.nodes[2].estimates!.rows = 1e-308;
  assert.ok(
    analyzePlan(plan).findings.every((finding) =>
      Object.values(finding.evidence).every(
        (value) => typeof value !== "number" || Number.isFinite(value),
      ),
    ),
  );
});
