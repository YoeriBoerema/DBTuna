import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { databaseConnector } from "../../src/extension/connectors/registry";
import { AdapterRegistry } from "../../packages/adapter-sdk/src/registry";
import { PostgresAdapter } from "../../packages/adapter-postgres/src/postgresAdapter";
import { SqlServerAdapter } from "../../packages/adapter-sqlserver/src/sqlServerAdapter";
import { validate } from "../../packages/plan-core/src/schema";
import {
  prepareBatch,
  explainBatch,
} from "../../src/extension/services/batchExplain";
const rawPg = [{ Plan: { "Node Type": "Result", "Total Cost": 1 } }];
const xml = readFileSync("fixtures/sqlserver/multi-statement.sqlplan", "utf8");
test("connectors expose dialect-specific splitting, validation and execution preparation through one contract", () => {
  const pg = databaseConnector("postgresql");
  assert.equal(pg.split("SELECT 1; SELECT 2;").length, 2);
  assert.equal(pg.classify("SELECT 1")[0].status, "supported");
  assert.equal(pg.classify("SET search_path TO public")[0].status, "skipped");
  assert.equal(pg.classify("SELECT FROM")[0].status, "invalid");
  assert.throws(() => pg.validate("DELETE FROM t"));
  const [plan] = pg.parse(rawPg);
  plan.query = "INSERT INTO t VALUES (1)";
  assert.deepEqual(pg.prepareExecution(plan), {
    sql: plan.query,
    kind: "INSERT",
  });
  const sqlServer = databaseConnector("sqlserver");
  assert.equal(sqlServer.classify("SELECT 1")[0].status, "supported");
  assert.equal(
    sqlServer.classify("SET NOCOUNT ON; SELECT 1;")[0].status,
    "skipped",
  );
  assert.equal(sqlServer.split("SELECT 1; SELECT 2;\nGO\nSELECT 3;").length, 2);
  assert.throws(() => sqlServer.validate("SET SHOWPLAN_XML OFF; SELECT 1"));
  const [statement] = sqlServer.parse(xml);
  statement.query = "SELECT @id;";
  assert.throws(() => sqlServer.prepareExecution(statement), /variable setup/);
  assert.deepEqual(
    sqlServer.prepareExecution(statement, "DECLARE @id int=7; SELECT @id;"),
    { sql: "DECLARE @id int=7;\nSELECT @id;", kind: "SELECT" },
  );
  assert.throws(
    () => databaseConnector("unknown"),
    /Unsupported database type/,
  );
  const adapters = new AdapterRegistry([
    new PostgresAdapter(),
    new SqlServerAdapter(),
  ]);
  assert.equal(adapters.parseStatements(xml).length, 2);
  assert.equal(adapters.parseStatements(rawPg).length, 1);
  assert.equal(
    adapters.parseStatements(plan)[0].application.planKind,
    undefined,
  );
});
test("legacy canonical plans migrate application fields while preserving unknown native attributes", () => {
  const [original] = databaseConnector("postgresql").parse(rawPg);
  const legacy: Record<string, unknown> = { ...original };
  delete legacy.application;
  const plan = validate({
    ...legacy,
    metadata: {
      connectionLabel: "Local",
      executionAvailable: true,
      batchSql: "SELECT private_setup",
      statementType: "SELECT",
      nativeCounter: { value: 42 },
    },
  });
  assert.equal(plan.application.connectionLabel, "Local");
  assert.equal(plan.application.statementType, "SELECT");
  assert.deepEqual(plan.metadata, { nativeCounter: { value: 42 } });
  assert.equal(JSON.stringify(plan).includes("private_setup"), false);
  assert.equal(validate(original).application.executionAvailable, undefined);
  assert.throws(() => validate({ ...original, application: [] }));
  assert.throws(() =>
    validate({ ...original, application: { clientElapsedMs: -1 } }),
  );
});
test("completed plan callbacks retain exact source batches without serializing execution context", async () => {
  const batches = [
    "DECLARE @id int=1; SELECT @id;",
    "DECLARE @id int=2; SELECT @id;",
  ];
  const contexts = new Map<string, string>();
  const result = await explainBatch(
    prepareBatch(batches, "sqlserver"),
    async () => {
      const [plan] = databaseConnector("sqlserver").parse(xml);
      plan.query = "SELECT @id;";
      return plan;
    },
    new AbortController().signal,
    (snapshot) => {
      for (const item of snapshot.items)
        if (item.plan) assert.equal(contexts.has(item.plan.id), true);
    },
    (plan, sourceSql) => {
      contexts.set(plan.id, sourceSql);
      plan.application.executionAvailable = true;
    },
  );
  assert.deepEqual(
    result.items.map((item) => contexts.get(item.plan!.id)),
    batches,
  );
  assert.ok(
    result.items.every((item) => item.plan?.application.executionAvailable),
  );
  assert.equal(
    JSON.stringify(result.items.map((item) => item.plan)).includes("DECLARE"),
    false,
  );
});
