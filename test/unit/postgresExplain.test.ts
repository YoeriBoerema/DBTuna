import { test } from "node:test";
import assert from "node:assert/strict";
import { prepareBatch, explainBatch } from "../../src/extension/services/batchExplain";
import { splitSqlBatch } from "../../src/extension/sql/batchSelection";
import { restoreBatch } from "../../packages/plan-core/src/batch";
import { PostgresAdapter } from "../../packages/adapter-postgres/src/postgresAdapter";

test("PostgreSQL setup is skipped without collection while dependent failures do not stop independent queries", async () => {
  const batch = prepareBatch(splitSqlBatch(`-- Settings are not replayed
SET search_path TO app;
CREATE TEMP TABLE scratch (id int);
BEGIN;
SELECT * FROM scratch;
SELECT 42;
COMMIT;`));
  assert.deepEqual(batch.items.map((item) => item.status), ["skipped", "skipped", "skipped", "pending", "pending", "skipped"]);
  assert.match(batch.items[0].error!, /connection defaults/);
  assert.match(batch.items[1].error!, /not executed/);
  assert.match(batch.items[2].error!, /read-only/);
  const calls: string[] = [];
  const result = await explainBatch(batch, async (sql) => {
    calls.push(sql);
    if (sql.includes("scratch")) throw Error('relation "scratch" does not exist');
    const plan = new PostgresAdapter().parse([{ Plan: { "Node Type": "Result", "Total Cost": 1 } }]);
    plan.query = sql;
    return plan;
  }, new AbortController().signal, () => {});
  assert.deepEqual(calls, ["SELECT * FROM scratch;", "SELECT 42;"]);
  assert.deepEqual(result.items.map((item) => item.status), ["skipped", "skipped", "skipped", "error", "complete", "skipped"]);
  assert.equal(restoreBatch(JSON.parse(JSON.stringify(result))).items[0].status, "skipped");
});

test("PostgreSQL classification preserves supported queries and distinguishes invalid syntax from unsupported statements", () => {
  const sql = [
    "SELECT 'SET search_path TO app; CREATE TABLE t(id int);';",
    "VALUES (1);",
    "INSERT INTO t VALUES (1);",
    "WITH x AS (SELECT 1) SELECT * FROM x;",
    "SELECT FROM;",
    "SET search_path TO;",
    "DELETE FROM t;",
    "DO $$ BEGIN RAISE NOTICE 'hello;'; END $$;",
    "SELEC 42;",
  ];
  const batch = prepareBatch(splitSqlBatch(sql.join("\n")));
  assert.deepEqual(batch.items.map((item) => item.status), ["pending", "pending", "pending", "pending", "error", "error", "skipped", "skipped", "error"]);
  assert.deepEqual(batch.items.map((item) => item.sql), sql);
  assert.equal(prepareBatch(["SET enable_seqscan = off;"]).items[0].status, "skipped");
});
