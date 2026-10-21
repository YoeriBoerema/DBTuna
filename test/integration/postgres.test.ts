import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync } from "node:fs";
import {
  collectPlan,
  collectActualPlan,
  withClient,
} from "../../src/extension/connection/postgresClient";
import { PostgresAdapter } from "../../packages/adapter-postgres/src/postgresAdapter";
import {
  prepareBatch,
  explainBatch,
} from "../../src/extension/services/batchExplain";
import { splitSqlBatch } from "../../src/extension/sql/batchSelection";
const config = {
  host: "127.0.0.1",
  port: Number(process.env.DBTUNA_TEST_PORT || 55439),
  user: "dbtuna",
  password: "test-only",
  database: "postgres",
};
test("real PostgreSQL read-only EXPLAIN workflow", async () => {
  await withClient(config, async (c) => {
    await c.query("CREATE TABLE IF NOT EXISTS customers(id int primary key)");
    await c.query("CREATE TABLE IF NOT EXISTS orders(id int, customer_id int)");
    await c.query("TRUNCATE orders,customers");
    await c.query("INSERT INTO customers SELECT generate_series(1,20)");
    await c.query(
      "INSERT INTO orders SELECT n,n%20+1 FROM generate_series(1,100) n",
    );
    await c.query(
      'CREATE TABLE "DPF_TMP_15" ("DPV_RID" int, "NEW_VALUE" varchar(128))',
    );
    await c.query(
      'CREATE TABLE "DPF_TMP_PRE_COND_18" ("DPV_RID" int, "LAST_NAME_UPPER" text)',
    );
    await c.query(
      'CREATE TABLE "DPF_TMP_HASH_17" ("LAST_NAME_UPPER" text, "MODULO" int)',
    );
    await c.query(
      'CREATE TABLE "DPF_TMP_SEED_16" ("DPV_RID" int, "LAST_NAME_UPPER" text)',
    );
    await c.query("INSERT INTO \"DPF_TMP_PRE_COND_18\" VALUES (1, 'OLD')");
    await c.query("INSERT INTO \"DPF_TMP_HASH_17\" VALUES ('OLD', 1)");
    await c.query("INSERT INTO \"DPF_TMP_SEED_16\" VALUES (1, 'NEW')");
  });
  const a = new PostgresAdapter();
  for (const sql of [
    "SELECT * FROM orders",
    "SELECT * FROM orders o JOIN customers c ON c.id=o.customer_id",
  ]) {
    const result = await collectPlan(config, sql);
    const plan = a.parse(result.raw);
    if (sql === "SELECT * FROM orders")
      writeFileSync(
        "fixtures/postgres/real-postgres-18.json",
        JSON.stringify(result.raw, null, 2),
      );
    assert.ok(plan.nodes.length);
    assert.equal(plan.nodes[0].actuals, undefined);
    console.log("Verified PostgreSQL " + result.version + " / " + sql);
  }
  for (const sql of [
    "INSERT INTO orders(id,customer_id) VALUES (201,1)",
    "INSERT INTO orders SELECT id+200,customer_id FROM orders",
    "WITH source AS (SELECT 202 AS id) INSERT INTO customers SELECT id FROM source",
    "INSERT INTO customers VALUES (203) RETURNING id",
    "INSERT INTO customers VALUES (1) ON CONFLICT (id) DO UPDATE SET id=excluded.id",
    readFileSync("fixtures/sql/insert-select.sql", "utf8"),
  ]) {
    const result = await collectPlan(config, sql);
    const plan = a.parse(result.raw);
    assert.equal(plan.nodes[0].nativeType, "ModifyTable");
    assert.equal(plan.nodes[0].label, "Insert");
    assert.equal(plan.nodes[0].actuals, undefined);
    if (sql.includes("DPF_TMP_15"))
      writeFileSync(
        "fixtures/postgres/real-insert-postgres-18.json",
        JSON.stringify(result.raw, null, 2),
      );
  }
  await withClient(config, async (c) => {
    assert.equal(
      (await c.query("SELECT count(*)::int AS n FROM orders")).rows[0].n,
      100,
    );
    assert.equal(
      (await c.query("SELECT count(*)::int AS n FROM customers")).rows[0].n,
      20,
    );
    assert.equal(
      (await c.query('SELECT count(*)::int AS n FROM "DPF_TMP_15"')).rows[0].n,
      0,
    );
  });
  console.log(
    "Verified six INSERT plan forms, including generator lookup; target row counts unchanged.",
  );
  await assert.rejects(collectPlan(config, "SELECT missing FROM orders"));
  const batch = await explainBatch(
    prepareBatch(
      splitSqlBatch(
        "SELECT * FROM orders; INSERT INTO orders VALUES (999,1); SELECT missing FROM orders; DELETE FROM orders; SELECT * FROM customers;",
      ),
    ),
    async (sql, signal) =>
      a.parse((await collectPlan(config, sql, signal)).raw),
    new AbortController().signal,
    () => {},
  );
  assert.deepEqual(
    batch.items.map((item) => item.status),
    ["complete", "complete", "error", "error", "complete"],
  );
  await withClient(config, async (c) =>
    assert.equal(
      (await c.query("SELECT count(*)::int AS n FROM orders")).rows[0].n,
      100,
    ),
  );
  console.log(
    "Verified mixed batch: three plans, isolated database/validation errors, and no inserted rows.",
  );
  await assert.rejects(collectPlan(config, "DELETE FROM orders"));
  await assert.rejects(
    withClient(config, async (c) => {
      await c.query("BEGIN READ ONLY");
      await c.query("DELETE FROM orders");
    }),
  );
  const measuredSelect = await collectActualPlan(
    config,
    "SELECT * FROM orders",
  );
  const measured = a.parse(measuredSelect.raw);
  assert.ok(measured.nodes.some((node) => node.actuals));
  assert.equal(measured.nodes[0].actuals?.rows, 100);
  assert.ok("Execution Time" in measured.metadata);
  const measuredInsert = await collectActualPlan(
    config,
    "INSERT INTO orders(id,customer_id) VALUES (999,1)",
  );
  assert.ok(a.parse(measuredInsert.raw).nodes[0].actuals);
  await withClient(config, async (client) =>
    assert.equal(
      (await client.query("SELECT count(*)::int AS n FROM orders WHERE id=999"))
        .rows[0].n,
      1,
    ),
  );
  await assert.rejects(() =>
    collectActualPlan(config, "INSERT INTO customers VALUES (1)"),
  );
  await withClient(config, async (client) =>
    assert.equal(
      (await client.query("SELECT count(*)::int AS n FROM customers")).rows[0]
        .n,
      20,
    ),
  );
  const stopped = new AbortController();
  stopped.abort();
  await assert.rejects(() =>
    collectActualPlan(
      config,
      "INSERT INTO customers VALUES (999)",
      stopped.signal,
    ),
  );
  await withClient(config, async (client) =>
    assert.equal(
      (
        await client.query(
          "SELECT count(*)::int AS n FROM customers WHERE id=999",
        )
      ).rows[0].n,
      0,
    ),
  );
  console.log(
    "Verified SELECT/INSERT actual plans, committed INSERT persistence, failure rollback and cancellation before execution.",
  );
});
