import { sqlServerNative } from "../helpers/nativePlans.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { PostgresAdapter } from "../../packages/adapter-postgres/src/postgresAdapter";
import { SqlServerAdapter } from "../../packages/adapter-sqlserver/src/sqlServerAdapter";
import { analyzePlan } from "../../packages/plan-analysis/src/analyze";
import { extractFacts } from "../../packages/plan-analysis/src/facts";

const pg = (extra: Record<string, unknown> = {}) =>
  new PostgresAdapter().parse([
    {
      Plan: {
        "Node Type": "Seq Scan",
        "Plan Rows": 100,
        "Actual Rows": 10000,
        "Actual Loops": 2000,
        ...extra,
      },
    },
  ]);
const sql = (
  counters = '<RunTimeCountersPerThread Thread="0" ActualRows="200000" ActualExecutions="2000" ActualRowsRead="4000000"/>',
  warnings = "",
  metadata = "",
) =>
  new SqlServerAdapter().parseStatements(
    sqlServerNative({
      counters,
      warnings,
      statementWarnings: metadata,
      body: `<IndexScan><Object Table="t"/><Predicate><ScalarOperator ScalarString="lower([name])='x'"/></Predicate></IndexScan>`,
    }),
  )[0];
const ids = (plan: ReturnType<typeof pg>) =>
  analyzePlan(plan).findings.map((finding) => finding.ruleId);

test("PostgreSQL rules normalize per-loop rows and report evidence without modifying plans", () => {
  const plan = pg({
    "Rows Removed by Filter": 200000,
    Filter: "lower(name) = 'x'",
    "Sort Space Type": "Disk",
  });
  const before = JSON.stringify(plan);
  assert.deepEqual(
    ids(plan).sort(),
    [
      "cardinality.discrepancy",
      "filter.discarded-rows",
      "memory.spill",
      "predicate.expression-review",
      "work.repeated-access",
    ].sort(),
  );
  const facts = extractFacts(plan, plan.nodes[0]);
  assert.equal(facts.rowsPerExecution, 10000);
  assert.equal(facts.totalRows, 20000000);
  assert.equal(facts.rejectedRows, 400000000);
  assert.equal(JSON.stringify(plan), before);
  assert.deepEqual(analyzePlan(plan), analyzePlan(plan));
});

test("SQL Server total rows, parallel threads and statement warnings have separate semantics", () => {
  const plan = sql(
    undefined,
    '<Warnings><SpillToTempDb SpillLevel="1"/><NoJoinPredicate>true</NoJoinPredicate></Warnings>',
    '<Warnings><PlanAffectingConvert Expression="CONVERT_IMPLICIT(int,[id],0)" ConvertIssue="Seek Plan"/></Warnings>',
  );
  const rules = ids(plan);
  assert.ok(!rules.includes("cardinality.discrepancy")); // 200000 / 2000 = 100 estimated per execution.
  for (const rule of [
    "memory.spill",
    "work.repeated-access",
    "filter.discarded-rows",
    "predicate.plan-affecting-conversion",
    "native.warning",
  ])
    assert.ok(rules.includes(rule), rule);
  assert.equal(extractFacts(plan, plan.nodes[0]).examinedRows, 4000000);
  const parallel = sql(
    '<RunTimeCountersPerThread Thread="0" ActualRows="100000" ActualExecutions="1" ActualRowsRead="200000"/><RunTimeCountersPerThread Thread="1" ActualRows="200000" ActualExecutions="1" ActualRowsRead="300000"/>',
  );
  assert.equal(
    extractFacts(parallel, parallel.nodes[0]).rowsPerExecution,
    undefined,
  );
  assert.equal(extractFacts(parallel, parallel.nodes[0]).examinedRows, 500000);
  assert.ok(!ids(parallel).includes("cardinality.discrepancy"));
  assert.ok(
    ids(
      sql(
        '<RunTimeCountersPerThread ActualRows="200000" ActualExecutions="1"/>',
      ),
    ).includes("cardinality.discrepancy"),
  );
  assert.ok(
    ids(
      sql(
        undefined,
        "",
        '<Warnings><PlanAffectingConvert Expression="first"/><PlanAffectingConvert Expression="second"/></Warnings>',
      ),
    ).includes("predicate.plan-affecting-conversion"),
  );
});

test("unknown, zero-loop and small measurements do not become false positives", () => {
  const estimated = pg();
  delete estimated.nodes[0].actuals;
  assert.deepEqual(ids(estimated), []);
  assert.ok(
    analyzePlan(estimated).coverage.some((text) =>
      text.includes("unavailable"),
    ),
  );
  assert.deepEqual(ids(pg({ "Actual Loops": 0 })), []);
  assert.deepEqual(
    ids(
      pg({
        "Plan Rows": 1,
        "Actual Rows": 2,
        "Actual Loops": 1,
        "Rows Removed by Filter": 3,
      }),
    ),
    [],
  );
  assert.ok(ids(pg({ "Plan Rows": 0 })).includes("cardinality.discrepancy"));
  const unknownScope = pg();
  delete unknownScope.nodes[0].actuals!.rowsScope;
  assert.deepEqual(ids(unknownScope), []);
  const missingRead = sql(
    '<RunTimeCountersPerThread ActualRows="100" ActualExecutions="1"/>',
  );
  assert.ok(!ids(missingRead).includes("filter.discarded-rows"));
});

test("early termination and native operator boundaries prevent misleading diagnoses", () => {
  const plan = new PostgresAdapter().parse([
    {
      Plan: {
        "Node Type": "Limit",
        "Plan Rows": 1,
        Plans: [
          {
            "Node Type": "Seq Scan",
            "Plan Rows": 100000,
            "Actual Rows": 1,
            "Actual Loops": 1,
          },
        ],
      },
    },
  ]);
  assert.ok(!ids(plan).includes("cardinality.discrepancy"));
  const boundary = pg();
  boundary.nodes[0].properties.RelOp = {
    Warnings: { SpillToTempDb: { SpillLevel: 1 } },
  };
  boundary.database.engine = "sqlserver";
  assert.ok(!ids(boundary).includes("memory.spill"));
  boundary.database.engine = "unknown";
  assert.deepEqual(ids(boundary), []);
});

test("spill indicators, configurable thresholds and missing evidence are explicit", () => {
  assert.ok(ids(pg({ "Hash Batches": 4 })).includes("memory.spill"));
  assert.ok(!ids(pg({ "Hash Batches": 1 })).includes("memory.spill"));
  const plan = pg();
  assert.ok(
    !analyzePlan(plan, { cardinalityRatio: 1000 }).findings.some(
      (f) => f.ruleId === "cardinality.discrepancy",
    ),
  );
  assert.throws(() => analyzePlan(plan, { examinedRows: NaN }));
  assert.throws(() => analyzePlan(plan, { rejectedFraction: 2 }));
  const overflow = pg({ "Actual Rows": 1e308, "Actual Loops": 1e308 });
  const measured = extractFacts(overflow, overflow.nodes[0]);
  assert.equal(measured.totalRows, undefined);
  assert.ok(
    analyzePlan(plan).findings.every(
      (finding) =>
        finding.ruleVersion === 1 &&
        finding.nodeIds.length &&
        finding.limitation,
    ),
  );
});

test("all SQL Server conversions retain their provenance and coverage explains unavailable rules", () => {
  const plan = sql(
    undefined,
    '<Warnings><PlanAffectingConvert Expression="operator conversion"/></Warnings>',
    '<Warnings><PlanAffectingConvert Expression="first"/><PlanAffectingConvert Expression="second"/></Warnings>',
  );
  const facts = extractFacts(plan, plan.nodes[0]);
  assert.deepEqual(
    facts.conversions.map((value) => value.expression),
    ["operator conversion", "first", "second"],
  );
  assert.deepEqual(
    facts.conversions.map((value) => value.source),
    ["operator", "statement", "statement"],
  );
  const finding = analyzePlan(plan).findings.find(
    (value) => value.ruleId === "predicate.plan-affecting-conversion",
  )!;
  assert.equal(Object.keys(finding.evidence).length, 3);
  const estimated = pg();
  delete estimated.nodes[0].actuals;
  const report = analyzePlan(estimated).ruleCoverage.find(
    (value) => value.ruleId === "cardinality.discrepancy",
  )!;
  assert.equal(report.evaluatedNodes, 0);
  assert.equal(report.skippedNodes, 1);
  assert.ok(report.reasons.length);
});
