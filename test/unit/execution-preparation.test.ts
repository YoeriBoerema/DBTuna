import { test } from "node:test";

import assert from "node:assert/strict";

import { readFileSync } from "node:fs";

import { PostgresAdapter } from "../../packages/adapter-postgres/src/postgresAdapter";

import { SqlServerAdapter } from "../../packages/adapter-sqlserver/src/sqlServerAdapter";

import { executionQuery } from "../../src/extension/services/executionQuery";

import { actualSqlServerSession } from "../../src/extension/connection/sqlServerClient";

const pg = (query = "SELECT 1") => {
  const plan = new PostgresAdapter().parse([
    { Plan: { "Node Type": "Result", "Total Cost": 1 } },
  ]);
  plan.query = query;
  return plan;
};

const xml = readFileSync("fixtures/sqlserver/multi-statement.sqlplan", "utf8");

test("actual SQL scopes a single SELECT/INSERT and only necessary literal DECLARE context", () => {
  assert.equal(executionQuery(pg("SELECT 1")).kind, "SELECT");
  assert.equal(
    executionQuery(
      pg("WITH x AS (SELECT 1 AS id) INSERT INTO t SELECT id FROM x"),
    ).kind,
    "INSERT",
  );
  assert.throws(() => executionQuery(pg("SELECT 1; INSERT INTO t VALUES(1)")));
  assert.throws(() => executionQuery(pg("DELETE FROM t")));
  const plan = new SqlServerAdapter().parseStatements(xml)[0];
  plan.query = "SELECT @id;";
  let batchSql =
    "DECLARE @id int=1; SELECT 99; INSERT INTO t VALUES (99); SELECT @id;";
  assert.equal(
    executionQuery(plan, batchSql).sql,
    "DECLARE @id int=1;\nSELECT @id;",
  );
  batchSql = "DECLARE @unused int=2; DECLARE @id int=1; SELECT @id;";
  assert.equal(
    executionQuery(plan, batchSql).sql,
    "DECLARE @id int=1;\nSELECT @id;",
  );
  batchSql = "DECLARE @id int=dbo.side_effect(); SELECT @id;";
  assert.throws(() => executionQuery(plan, batchSql), /variable setup/);
  plan.query = "SELECT * INTO new_table FROM t";
  assert.throws(() => executionQuery(plan, batchSql), /SELECT INTO/);
  plan.query = "SELECT @@VERSION";
  assert.equal(executionQuery(plan, batchSql).sql, plan.query);
});

test("SQL Server actual collection enables statistics, discards results, cleans up, and never retries", async () => {
  const calls: string[] = [];
  const result = await actualSqlServerSession(async (sql, options) => {
    calls.push(sql);
    if (sql === "SELECT 1") {
      assert.equal(options?.plansOnly, true);
      return [[xml]];
    }
    return [];
  }, "SELECT 1");
  assert.equal(result.raw, xml);
  assert.deepEqual(calls, [
    "SET STATISTICS XML ON",
    "SELECT 1",
    "SET STATISTICS XML OFF",
  ]);
  calls.length = 0;
  await assert.rejects(() =>
    actualSqlServerSession(async (sql) => {
      calls.push(sql);
      if (sql === "INSERT INTO t VALUES(1)") throw Error("connection failed");
      return [];
    }, "INSERT INTO t VALUES(1)"),
  );
  assert.equal(calls.filter((sql) => sql.startsWith("INSERT")).length, 1);
  assert.equal(calls.at(-1), "SET STATISTICS XML OFF");
  await assert.rejects(
    () => actualSqlServerSession(async () => [], "SELECT 1"),
    /may already have changed/,
  );
});
