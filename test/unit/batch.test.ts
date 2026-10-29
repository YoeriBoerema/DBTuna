import { postgresNative } from "../helpers/nativePlans.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { splitSqlBatch } from "../../src/extension/sql/batchSelection";
import {
  prepareBatch,
  explainBatch,
} from "../../src/extension/services/batchExplain";
import {
  validateBatch,
  restoreBatch,
} from "../../packages/plan-core/src/batch";
import { PostgresAdapter } from "../../packages/adapter-postgres/src/postgresAdapter";
const plan = () => new PostgresAdapter().parse(postgresNative());
test("batch selection honors exact text; handles strings, identifiers, comments and dollar quotes", () => {
  const selected = `SELECT 'a;''b'; -- ignored ;\n SELECT * FROM "table;name"; /* outer /* ; */ tail */ SELECT $tag$a;b$tag$; SELECT 4;`;
  const parts = splitSqlBatch("not sql", selected);
  assert.equal(parts.length, 4);
  assert.match(parts[0], /a;''b/);
  assert.match(parts[1], /table;name/);
  assert.match(parts[2], /\$tag\$a;b\$tag\$/);
  assert.equal(parts[3], "SELECT 4;");
  assert.equal(splitSqlBatch("SELECT E'a\\';b'; SELECT 2;").length, 2);
  assert.equal(
    splitSqlBatch(";; -- comment\n SELECT 1; /* trailing */").length,
    1,
  );
});
test("batch boundaries fail closed on ambiguous quotes, unfinished input and resource limits", () => {
  for (const text of [
    "SELECT 'unfinished; SELECT 2",
    "SELECT 1; /* unfinished",
    "SELECT $$unfinished;",
    "SELECT 'a\\'; SELECT 2;",
  ])
    assert.throws(() => splitSqlBatch(text));
  assert.throws(() => splitSqlBatch("SELECT 1", "   "));
  assert.throws(() => splitSqlBatch("SELECT 1;".repeat(21)), /20/);
  assert.throws(() => splitSqlBatch(" ".repeat(1024 * 1024 + 1)), /1 MiB/);
});
test("batch retains valid results and individual syntax/unsupported/database failures in source order", async () => {
  const batch = prepareBatch(
    splitSqlBatch(
      "SELECT 1; SELECT FROM; DELETE FROM t; SELECT missing FROM t; SELECT 5;",
    ),
  );
  const calls: string[] = [];
  const snapshots: string[][] = [];
  let active = 0;
  const result = await explainBatch(
    batch,
    async (sql) => {
      assert.equal(++active, 1);
      calls.push(sql);
      await new Promise<void>((resolve) => setImmediate(resolve));
      active--;
      if (sql.includes("missing")) throw Error("Column missing does not exist");
      return plan();
    },
    new AbortController().signal,
    (b) => snapshots.push(b.items.map((i) => i.status)),
  );
  assert.deepEqual(
    result.items.map((i) => i.status),
    ["complete", "error", "skipped", "error", "complete"],
  );
  assert.equal(calls.length, 3);
  assert.ok(result.items[1].error?.includes("syntax"));
  assert.match(result.items[3].error!, /Check SQL syntax/);
  assert.equal(JSON.stringify(result).includes("Column missing"), false);
  assert.notEqual(result.items[0].plan!.id, result.items[4].plan!.id);
  assert.equal(snapshots[0][0], "pending");
  assert.equal(snapshots.at(-1)?.[4], "complete");
  assert.deepEqual(
    validateBatch(JSON.stringify(result)),
    JSON.parse(JSON.stringify(result)),
  );
});
test("batch cancellation retains finished plans and never starts remaining statements", async () => {
  const controller = new AbortController();
  let calls = 0;
  const result = await explainBatch(
    prepareBatch(["SELECT 1", "SELECT 2", "SELECT 3"]),
    async () => {
      if (++calls === 2) {
        controller.abort();
        throw Error("Connection closed");
      }
      return plan();
    },
    controller.signal,
    () => {},
  );
  assert.equal(calls, 2);
  assert.deepEqual(
    result.items.map((i) => i.status),
    ["complete", "cancelled", "cancelled"],
  );
  assert.ok(result.items[0].plan);
});
test("cancelled-before-start batches make no collector calls", async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await explainBatch(
    prepareBatch(["SELECT 1"]),
    async () => {
      throw Error("Must not run");
    },
    controller.signal,
    () => {},
  );
  assert.equal(result.items[0].status, "cancelled");
});
test("batch envelope validates status, ordering and combined size", () => {
  const batch = prepareBatch(["SELECT 1"]);
  assert.throws(() =>
    validateBatch({
      ...batch,
      items: [{ ...batch.items[0], status: "complete" }],
    }),
  );
  assert.throws(() =>
    validateBatch({ ...batch, items: [{ ...batch.items[0], index: 2 }] }),
  );
  const large = plan();
  large.metadata.large = "x".repeat(6 * 1024 * 1024);
  assert.throws(
    () =>
      validateBatch({
        ...batch,
        items: [{ ...batch.items[0], status: "complete", plan: large }],
      }),
    /5 MiB/,
  );
});
test("importing an unfinished batch cancels pending work without resuming it", () => {
  const pending = prepareBatch(["SELECT 1", "SELECT 2"]);
  pending.items[0].status = "running";
  const restored = restoreBatch(JSON.stringify(pending));
  assert.deepEqual(
    restored.items.map((i) => i.status),
    ["cancelled", "cancelled"],
  );
  assert.equal(pending.items[0].status, "running");
});
