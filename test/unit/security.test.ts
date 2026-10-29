import { test } from "node:test";
import assert from "node:assert/strict";
import { bounded } from "../../packages/plan-core/src/schema";
import { PLAN_LIMITS } from "../../packages/plan-core/src/limits";
import {
  UserFacingError,
  safeErrorMessage,
} from "../../packages/plan-core/src/errors";
import { databaseError } from "../../src/extension/connection/databaseErrors";
import { ExecutionManager } from "../../src/extension/services/executionManager";
import { PostgresAdapter } from "../../packages/adapter-postgres/src/postgresAdapter";
import {
  explainBatch,
  prepareBatch,
} from "../../src/extension/services/batchExplain";
import { restoreBatch } from "../../packages/plan-core/src/batch";
import type { Profile } from "../../src/extension/connection/profile";
import type { ExtensionToWebview } from "../../src/extension/webview/messages";

test("plan budget counts aggregate strings, keys, UTF-8, escapes and lone surrogates for object inputs", () => {
  assert.throws(() => bounded({ x: "x".repeat(PLAN_LIMITS.bytes) }), /5 MiB/);
  assert.throws(
    () =>
      bounded({
        a: "x".repeat(3 * 1024 * 1024),
        b: "x".repeat(3 * 1024 * 1024),
      }),
    /5 MiB/,
  );
  for (const unit of [
    "x",
    "é",
    "水",
    "😀",
    "\n",
    "\u0000",
    "\ud800",
    '"',
    "\\",
  ]) {
    const size = Buffer.byteLength(JSON.stringify(unit)) - 2;
    const n = Math.floor((PLAN_LIMITS.bytes - 2) / size);
    const fitting = unit.repeat(n);
    assert.ok(bounded([fitting.slice(0, Math.max(0, fitting.length - 4))]));
    assert.throws(() => bounded([unit.repeat(n + 1)]), /5 MiB/);
  }
  assert.throws(() => bounded({ ["x".repeat(PLAN_LIMITS.bytes)]: 1 }), /5 MiB/);
  const native = [
    { Plan: { "Node Type": "Result", large: "x".repeat(PLAN_LIMITS.bytes) } },
  ];
  assert.throws(() => new PostgresAdapter().parse(native), /5 MiB/);
});

const initial: Profile = {
  id: "security",
  name: "Test",
  type: "postgresql",
  host: "localhost",
  port: 55439,
  database: "test",
  user: "test",
  ssl: "disable",
};
const plan = (sql = "INSERT INTO t VALUES (1)") => ({
  ...new PostgresAdapter().parse([{ Plan: { "Node Type": "Result" } }]),
  query: sql,
});

for (const change of [
  "reject",
  "cancel",
  "reset",
  "stale",
  "connection",
  "trust",
  "query",
  "credential-connection",
  "credential-trust",
  "credential-stale",
] as const) {
  test(`host approval fails closed on ${change}`, async () => {
    let profile = { ...initial },
      trusted = true,
      current = true,
      calls = 0,
      passwords = 0;
    let finish!: (approved: boolean) => void;
    let requested!: () => void;
    const asked = new Promise<void>((resolve) => {
      requested = resolve;
    });
    const p = plan();
    const manager = new ExecutionManager(
      {
        profiles: () => [profile],
        password: async () => {
          passwords++;
          if (change === "credential-connection")
            profile = { ...profile, database: "changed" };
          if (change === "credential-trust") trusted = false;
          if (change === "credential-stale") current = false;
          return "mock";
        },
      },
      () => {},
      () => current,
      {
        trusted: () => trusted,
        confirm: async (details) => {
          assert.equal(details.sql, p.query);
          assert.equal(details.profile.id, initial.id);
          requested();
          return new Promise<boolean>((resolve) => {
            finish = resolve;
          });
        },
        exportPlan: async () => {},
      },
      async () => {
        calls++;
        return { raw: null };
      },
    );
    manager.register(p, profile);
    const pending = manager.run(p.id, "request");
    await asked;
    assert.equal(calls, 0);
    assert.equal(passwords, 0);
    // A concurrent or duplicate message cannot enter a second approval path.
    await manager.run(p.id, "other");
    await manager.run(p.id, "request");
    if (change === "cancel") manager.cancel();
    if (change === "reset") manager.reset();
    if (change === "stale") current = false;
    if (change === "connection") profile = { ...profile, host: "changed" };
    if (change === "trust") trusted = false;
    if (change === "query") p.query = "INSERT INTO t VALUES (2)";
    finish(change !== "reject");
    await pending;
    assert.equal(calls, 0);
  });
}

test("SELECT and INSERT require fresh host approval on each new run", async () => {
  for (const sql of ["SELECT 1", "INSERT INTO t VALUES (1)"]) {
    let approvals = 0,
      calls = 0;
    const manager = new ExecutionManager(
      { profiles: () => [initial], password: async () => "mock" },
      () => {},
      () => true,
      {
        trusted: () => true,
        confirm: async ({ kind }) => {
          approvals++;
          assert.equal(kind, sql.startsWith("SELECT") ? "SELECT" : "INSERT");
          return true;
        },
        exportPlan: async () => {},
      },
      async () => {
        calls++;
        return { raw: [{ Plan: { "Node Type": "Result", "Actual Rows": 1 } }] };
      },
    );
    const p = plan(sql);
    await manager.run(p.id, "unbound");
    assert.equal(approvals, 0);
    manager.register(p, initial);
    await manager.run(p.id, "first");
    await manager.run(p.id, "first");
    await manager.run(p.id, "second");
    assert.equal(approvals, 2);
    assert.equal(calls, 2);
  }
});

test("native error contents never reach mapped diagnostics, results or exported batches", async () => {
  const sentinel = "PRIVATE_DATABASE_VALUE_7429";
  for (const code of [
    "42601",
    "57014",
    "42501",
    "28P01",
    "ETIMEOUT",
    sentinel,
  ]) {
    const error = Object.assign(Error(sentinel, { cause: Error(sentinel) }), {
      code,
      detail: sentinel,
      hint: sentinel,
    });
    assert.equal(databaseError(error).message.includes(sentinel), false);
    assert.equal(safeErrorMessage(error, "Fallback"), "Fallback");
  }
  for (const fields of [
    { number: 229 },
    { number: 18456 },
    { errorNum: 1031 },
    { errorNum: 1017 },
  ])
    assert.equal(
      databaseError(Object.assign(Error(sentinel), fields)).message.includes(
        sentinel,
      ),
      false,
    );
  const controlled = new UserFacingError("Select exactly one statement.");
  assert.equal(databaseError(controlled), controlled);
  assert.match(databaseError({ code: "57014" }).message, /timed out/);
  assert.match(databaseError({ code: "42501" }).message, /permissions/);
  const messages: ExtensionToWebview[] = [];
  const manager = new ExecutionManager(
    { profiles: () => [initial], password: async () => "mock" },
    (m) => messages.push(m),
    () => true,
    {
      trusted: () => true,
      confirm: async () => true,
      exportPlan: async () => {},
    },
    async () => {
      throw Error(sentinel);
    },
  );
  const p = plan();
  manager.register(p, initial);
  await manager.run(p.id, "failure");
  assert.equal(JSON.stringify(messages).includes(sentinel), false);
  assert.match(JSON.stringify(messages), /may already have changed/);
  const batch = await explainBatch(
    prepareBatch(["SELECT 1"]),
    async () => {
      throw Error(sentinel);
    },
    new AbortController().signal,
    () => {},
  );
  assert.equal(JSON.stringify(batch).includes(sentinel), false);
  batch.items[0].error = sentinel;
  assert.equal(JSON.stringify(restoreBatch(batch)).includes(sentinel), false);
});
