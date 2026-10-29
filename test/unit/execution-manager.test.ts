import { test } from "node:test";

import assert from "node:assert/strict";

import { readFileSync } from "node:fs";

import { PostgresAdapter } from "../../packages/adapter-postgres/src/postgresAdapter";

import { SqlServerAdapter } from "../../packages/adapter-sqlserver/src/sqlServerAdapter";

import { ExecutionManager } from "../../src/extension/services/executionManager";

import {
  webviewMessageSchema,
  type ExtensionToWebview,
} from "../../src/extension/webview/messages";

import type { Profile } from "../../src/extension/connection/profile";

const pg = (query = "SELECT 1") => {
  const plan = new PostgresAdapter().parse([
    { Plan: { "Node Type": "Result", "Total Cost": 1 } },
  ]);
  plan.query = query;
  return plan;
};

const xml = readFileSync("fixtures/sqlserver/multi-statement.sqlplan", "utf8");

test("SQL Server runtime metrics aggregate rows/CPU across threads and keep max-thread elapsed distinct", () => {
  const native = xml.replace(
    "<NestedLoops>",
    '<RunTimeInformation><RunTimeCountersPerThread Thread="0" ActualRows="3" ActualExecutions="2" ActualElapsedms="10" ActualCPUms="6"/><RunTimeCountersPerThread Thread="1" ActualRows="5" ActualExecutions="2" ActualElapsedms="12" ActualCPUms="7"/></RunTimeInformation><NestedLoops>',
  );
  const plan = new SqlServerAdapter().parseStatements(native)[0];
  assert.deepEqual(plan.nodes[0].actuals, {
    rows: 8,
    loops: 4,
    rowsScope: "total",
    elapsedTimeMs: 12,
    cpuTimeMs: 13,
  });
  assert.equal(plan.nodes[1].actuals, undefined);
  assert.throws(() =>
    new SqlServerAdapter().parse(
      native.replace('ActualRows="3"', 'ActualRows="-1"'),
    ),
  );
});

test("execution coordinator requires current live bindings, original connection, trust", async () => {
  let profile: Profile = {
    id: "p",
    name: "Test",
    type: "postgresql",
    host: "localhost",
    port: 55439,
    database: "test",
    user: "test",
    ssl: "disable",
  };
  let trusted = true,
    current = true,
    collects = 0;
  const messages: ExtensionToWebview[] = [];
  const service = new ExecutionManager(
    { profiles: () => [profile], password: async () => "test-only" },
    (m) => messages.push(m),
    () => current,
    {
      trusted: () => trusted,
      confirm: async () => true,
      exportPlan: async () => {},
    },
    async () => {
      collects++;
      return {
        raw: [
          {
            Plan: {
              "Node Type": "Result",
              "Actual Rows": 1,
              "Actual Loops": 1,
              "Actual Total Time": 0.1,
            },
          },
        ],
      };
    },
  );
  const plan = pg();
  await service.run(plan.id, "unbound");
  assert.equal(collects, 0);
  service.register(plan, profile);
  trusted = false;
  await service.run(plan.id, "untrusted");
  assert.equal(collects, 0);
  trusted = true;
  profile = { ...profile, host: "changed" };
  await service.run(plan.id, "changed");
  assert.equal(collects, 0);
  profile = { ...profile, host: "localhost" };
  current = false;
  await service.run(plan.id, "stale");
  assert.equal(collects, 0);
  current = true;
  await service.run(plan.id, "allowed");
  assert.equal(collects, 1);
  const result = messages.at(-1);
  assert.ok(
    result?.type === "EXECUTION_RESULT" && result.status === "complete",
  );
  assert.equal(result.actualPlan?.query, "SELECT 1");
  assert.ok(result.actualPlan?.nodes[0].actuals);
  assert.ok(service.findActual(result.actualPlan!.id));
});

test("INSERT duplicates are blocked and uncertain outcomes never retry", async () => {
  const profile: Profile = {
    id: "p",
    name: "Test",
    type: "postgresql",
    host: "localhost",
    port: 55439,
    database: "test",
    user: "test",
    ssl: "disable",
  };
  let unlock!: () => void;
  let calls = 0;
  const messages: ExtensionToWebview[] = [];
  const manager = new ExecutionManager(
    { profiles: () => [profile], password: async () => "test" },
    (m) => messages.push(m),
    () => true,
    {
      trusted: () => true,
      confirm: async () => true,
      exportPlan: async () => {},
    },
    async () => {
      calls++;
      await new Promise<void>((resolve) => {
        unlock = resolve;
      });
      throw Error("Lost connection after commit");
    },
  );
  const plan = pg("INSERT INTO t VALUES (1)");
  manager.register(plan, profile);
  const running = manager.run(plan.id, "one");
  while (!unlock) await new Promise<void>((resolve) => setImmediate(resolve));
  await manager.run(plan.id, "two");
  assert.equal(calls, 1);
  unlock();
  await running;
  const last = messages.at(-1);
  assert.ok(last?.type === "EXECUTION_RESULT");
  assert.match(last.error!, /may already have changed/);
  assert.equal(calls, 1);
  await manager.run(plan.id, "one");
  assert.equal(calls, 1); // Late duplicate request must not repeat the INSERT.
});

test("execution messages accept only IDs; webviews cannot supply SQL or connection details", () => {
  const message = { type: "RUN_ACTUAL", planId: "p", requestId: "r" };
  assert.ok(webviewMessageSchema.safeParse(message).success);
  assert.equal(
    webviewMessageSchema.safeParse({
      ...message,
      sql: "INSERT INTO t VALUES(1)",
    }).success,
    false,
  );
  assert.equal(
    webviewMessageSchema.safeParse({ ...message, connectionId: "other" })
      .success,
    false,
  );
  assert.ok(
    webviewMessageSchema.safeParse({ type: "CANCEL_ACTUAL", requestId: "r" })
      .success,
  );
});

test("active execution cancellation retains uncertainty and does not trigger another query", async () => {
  const profile: Profile = {
    id: "p",
    name: "Test",
    type: "postgresql",
    host: "localhost",
    port: 55439,
    database: "test",
    user: "test",
    ssl: "disable",
  };
  const messages: ExtensionToWebview[] = [];
  let calls = 0;
  const manager = new ExecutionManager(
    { profiles: () => [profile], password: async () => "test" },
    (m) => messages.push(m),
    () => true,
    {
      trusted: () => true,
      confirm: async () => true,
      exportPlan: async () => {},
    },
    async (p, password, sql, signal) => {
      calls++;
      await new Promise<void>((resolve, reject) =>
        signal.addEventListener(
          "abort",
          () => reject(Error("Connection closed")),
          { once: true },
        ),
      );
      return { raw: null };
    },
  );
  const plan = pg("INSERT INTO t VALUES (1)");
  manager.register(plan, profile);
  const pending = manager.run(plan.id, "cancelled");
  while (!calls) await new Promise<void>((resolve) => setImmediate(resolve));
  manager.cancel("cancelled");
  await pending;
  const last = messages.at(-1);
  assert.ok(last?.type === "EXECUTION_RESULT");
  assert.equal(last.status, "cancelled");
  assert.match(last.error!, /may already have changed/);
  assert.equal(calls, 1);
});

test("SQL Server execution identifies the requested statement's actual plan among other returned plans", async () => {
  const profile: Profile = {
    id: "sql",
    name: "Test SQL",
    type: "sqlserver",
    host: "localhost",
    port: 55440,
    database: "test",
    user: "test",
    ssl: "trust",
  };
  const native = xml.replace(
    "<NestedLoops>",
    '<RunTimeInformation><RunTimeCountersPerThread Thread="0" ActualRows="12" ActualExecutions="1" ActualElapsedms="2" ActualCPUms="1"/></RunTimeInformation><NestedLoops>',
  );
  const estimated = new SqlServerAdapter().parseStatements(xml)[0];
  const messages: ExtensionToWebview[] = [];
  const manager = new ExecutionManager(
    { profiles: () => [profile], password: async () => "test" },
    (m) => messages.push(m),
    () => true,
    {
      trusted: () => true,
      confirm: async () => true,
      exportPlan: async () => {},
    },
    async () => ({ raw: native }),
  );
  manager.register(estimated, profile);
  await manager.run(estimated.id, "sql-actual");
  const result = messages.at(-1);
  assert.ok(result?.type === "EXECUTION_RESULT");
  assert.equal(result.status, "complete");
  assert.equal(result.actualPlan?.rootNodeIds.length, 1);
  assert.equal(result.actualPlan?.nodes[0].actuals?.rows, 12);
});

test("SQL Server run uses host-bound declarations without adding setup SQL to the displayed actual plan", async () => {
  const profile: Profile = {
    id: "sql-context",
    name: "Test SQL",
    type: "sqlserver",
    host: "localhost",
    port: 55440,
    database: "test",
    user: "test",
    ssl: "trust",
  };
  const native = xml
    .replace(/StatementText="[^"]*"/, 'StatementText="SELECT @id;"')
    .replace(
      "<NestedLoops>",
      '<RunTimeInformation><RunTimeCountersPerThread Thread="0" ActualRows="12" ActualExecutions="1"/></RunTimeInformation><NestedLoops>',
    );
  const estimated = new SqlServerAdapter().parseStatements(xml)[0];
  estimated.query = "SELECT @id;";
  const messages: ExtensionToWebview[] = [];
  const manager = new ExecutionManager(
    { profiles: () => [profile], password: async () => "test" },
    (message) => messages.push(message),
    () => true,
    {
      trusted: () => true,
      confirm: async () => true,
      exportPlan: async () => {},
    },
    async (_profile, _password, sql) => {
      assert.equal(sql, "DECLARE @id int=42;\nSELECT @id;");
      return { raw: native };
    },
  );
  manager.register(estimated, profile, "DECLARE @id int=42; SELECT @id;");
  assert.equal(estimated.application.executionAvailable, true);
  await manager.run(estimated.id, "context-run");
  const result = messages.at(-1);
  assert.ok(result?.type === "EXECUTION_RESULT");
  assert.equal(result.status, "complete", result.error);
  assert.equal(result.actualPlan?.query, "SELECT @id;");
  assert.equal(JSON.stringify(estimated).includes("DECLARE"), false);
  assert.equal(JSON.stringify(result).includes("DECLARE"), false);
});
