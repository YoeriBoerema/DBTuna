import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PostgresAdapter } from "../../packages/adapter-postgres/src/postgresAdapter";
import { validate, bounded } from "../../packages/plan-core/src/schema";
import { AdapterRegistry } from "../../packages/adapter-sdk/src/registry";
import {
  selectStatement,
  validateSql,
} from "../../src/extension/sql/statementSelection";
const adapter = new PostgresAdapter();
for (const file of readdirSync("fixtures/postgres"))
  test("fixture " + file, () => {
    const p = adapter.parse(readFileSync("fixtures/postgres/" + file, "utf8"));
    assert.ok(p.nodes.length);
    assert.deepEqual(
      JSON.parse(JSON.stringify(validate(JSON.parse(JSON.stringify(p))))),
      JSON.parse(JSON.stringify(p)),
    );
  });
test("stable IDs, unknown properties and actuals", () => {
  const raw = [
    {
      Plan: {
        "Node Type": "Future Operator",
        "Plan Rows": 42,
        "Actual Rows": 10,
        Future: { foo: true },
        Plans: [{ "Node Type": "Seq Scan" }],
      },
      "Planning Time": 1,
    },
  ];
  const p = adapter.parse(raw);
  assert.deepEqual(
    p.nodes.map((n) => n.id),
    ["0", "0.0"],
  );
  assert.equal(p.nodes[0].category, "OTHER");
  assert.deepEqual(p.nodes[0].properties.Future, { foo: true });
  assert.equal(p.nodes[0].actuals?.rows, 10);
  assert.equal(p.nodes[0].estimates?.rows, 42);
  assert.equal(p.metadata["Planning Time"], 1);
  assert.equal(
    new AdapterRegistry([adapter]).parse(JSON.stringify(JSON.stringify(raw)))
      .nodes.length,
    2,
  );
});
test("invalid and bounded imports", () => {
  for (const v of [null, [], [{}], [{ Plan: {} }], "{"])
    assert.throws(() => adapter.parse(v));
  let v: unknown = {};
  for (let i = 0; i < 70; i++) v = { x: v };
  assert.throws(() => bounded(v));
  assert.throws(() => bounded(" ".repeat(6 * 1024 * 1024)));
});
test("graph validation rejects broken graph", () => {
  const p = adapter.parse([{ Plan: { "Node Type": "Seq Scan" } }]);
  assert.throws(() =>
    validate({ ...p, edges: [{ id: "x", source: "0", target: "missing" }] }),
  );
  assert.throws(() => validate({ ...p, nodes: [...p.nodes, ...p.nodes] }));
});
test("selection ignores unrelated log text and other statements", () => {
  const file =
    "Execution log\nINSERT INTO target SELECT 1;\nSELECT 2;\nFinished";
  assert.equal(selectStatement(file, "SELECT 2;"), "SELECT 2");
});
test("no selection validates the whole file", () => {
  assert.equal(
    selectStatement("-- Query\nSELECT 42;\n"),
    "-- Query\nSELECT 42",
  );
  assert.throws(() => selectStatement("SELECT 1; SELECT 2;"), /exactly one/);
});
test("whitespace selection does not fall back to the file", () => {
  assert.throws(() => selectStatement("SELECT 1", " \n\t"), /complete/);
  assert.throws(() => selectStatement("SELECT 1", ""), /complete/);
});
test("selected input must itself be a complete supported statement", () => {
  assert.throws(
    () => selectStatement("SELECT 1", "SELECT 2; SELECT 3;"),
    /exactly one/,
  );
  assert.throws(
    () => selectStatement("SELECT 1", "DELETE FROM orders"),
    /Only SELECT/,
  );
});

test("SQL accepted forms", () => {
  for (const q of [
    "SELECT 1",
    "VALUES (1),(2)",
    "WITH x AS (SELECT 1) SELECT * FROM x",
    "SELECT 'a;b'",
    "SELECT coalesce(cast(NULL AS varchar(8000)), ']#NULL#[')",
  ])
    assert.ok(validateSql(q));
});

test("INSERT forms and the reported generator lookup query are supported", () => {
  for (const query of [
    "INSERT INTO orders(id, customer_id) VALUES (1, 2)",
    "INSERT INTO orders SELECT 1, 2",
    "WITH source AS (SELECT 1 AS id) INSERT INTO customers SELECT id FROM source",
    "INSERT INTO customers VALUES (1) RETURNING id",
    "INSERT INTO customers VALUES (1) ON CONFLICT (id) DO NOTHING",
    "INSERT INTO customers VALUES (1) ON CONFLICT (id) DO UPDATE SET id = excluded.id",
    readFileSync("fixtures/sql/insert-select.sql", "utf8"),
  ])
    assert.ok(validateSql(query));
});

test("INSERT selection preserves scope and does not allow modifying CTEs or batches", () => {
  const query = readFileSync("fixtures/sql/insert-select.sql", "utf8");
  assert.equal(
    selectStatement("Execution log\n" + query + "\nFinished", query),
    query.trim().replace(/;$/, ""),
  );
  assert.equal(selectStatement(query), query.trim().replace(/;$/, ""));
  for (const input of [
    "INSERT INTO customers VALUES (1); DELETE FROM customers",
    "WITH changed AS (INSERT INTO customers VALUES (1) RETURNING *) SELECT * FROM changed",
    "WITH changed AS (DELETE FROM customers RETURNING *) INSERT INTO customers SELECT * FROM changed",
    "UPDATE customers SET id=2",
    "EXPLAIN ANALYZE INSERT INTO customers VALUES (1)",
  ])
    assert.throws(() => validateSql(input));
});

test("INSERT operator label preserves native ModifyTable identification", () => {
  const plan = adapter.parse([
    {
      Plan: {
        "Node Type": "ModifyTable",
        Operation: "Insert",
        "Relation Name": "orders",
        Plans: [{ "Node Type": "Result" }],
      },
    },
  ]);
  assert.equal(plan.nodes[0].label, "Insert");
  assert.equal(plan.nodes[0].nativeType, "ModifyTable");
  assert.equal(plan.nodes[0].properties.Operation, "Insert");
  assert.equal(plan.edges.length, 1);
});
test("SQL rejects unsafe and ambiguous statements", () => {
  for (const q of [
    "",
    "SELECT 1; DELETE FROM x",
    "DELETE FROM x",
    "WITH x AS (DELETE FROM x RETURNING *) SELECT * FROM x",
    "SELECT * INTO x FROM y",
    "SELECT * FROM y FOR UPDATE",
    "CALL foo()",
  ])
    assert.throws(() => validateSql(q), q);
});
test("100-node graph", () => {
  const p = adapter.parse([
    {
      Plan: {
        "Node Type": "Append",
        Plans: Array.from({ length: 100 }, () => ({ "Node Type": "Seq Scan" })),
      },
    },
  ]);
  assert.equal(p.nodes.length, 101);
  assert.equal(p.edges.length, 100);
});
