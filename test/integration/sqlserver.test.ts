import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  collectSqlServerPlan,
  collectActualSqlServerPlan,
  withSqlServer,
} from "../../src/extension/connection/sqlServerClient";
import { SqlServerAdapter } from "../../packages/adapter-sqlserver/src/sqlServerAdapter";
import type { Profile } from "../../src/extension/connection/profile";
// Explicit opt-in; never read production connection strings or saved profiles.
test(
  "isolated SQL Server: estimates do not execute; explicit actual SELECT/INSERT runs collect metrics and commit writes",
  { skip: process.env.DBTUNA_SQLSERVER_TEST !== "1" },
  async () => {
    const password = process.env.DBTUNA_SQLSERVER_TEST_PASSWORD;
    assert.ok(
      password,
      "Set DBTUNA_SQLSERVER_TEST_PASSWORD for the disposable test login.",
    );
    const p: Profile = {
      id: "integration",
      name: "Isolated SQL Server",
      type: "sqlserver",
      host: "127.0.0.1",
      port: 55440,
      database: "dbtuna_integration",
      user: "sa",
      ssl: "trust",
    };
    const table = "dbo.dbtuna_test_" + randomUUID().replaceAll("-", "");
    await withSqlServer(p, password, async (query) => {
      await query(
        `CREATE TABLE ${table} (id int PRIMARY KEY, name nvarchar(100)); INSERT INTO ${table} VALUES (1,N'one');`,
      );
      try {
        for (const sql of [
          `SELECT TOP (1) * FROM ${table} WHERE id=1`,
          `INSERT INTO ${table} SELECT 2,N'two'`,
          `DECLARE @id int=1; SELECT * FROM ${table} WHERE id=@id; SELECT 1;`,
        ]) {
          const result = await collectSqlServerPlan(p, password, sql);
          assert.ok(new SqlServerAdapter().parse(result.raw).nodes.length);
          assert.equal((await query(`SELECT COUNT(*) FROM ${table}`))[0][0], 1);
        }
        await assert.rejects(() =>
          collectSqlServerPlan(
            p,
            password,
            `SELECT * FROM dbo.dbtuna_missing_${randomUUID().replaceAll("-", "")}`,
          ),
        );
        const controller = new AbortController();
        controller.abort();
        await assert.rejects(() =>
          collectSqlServerPlan(p, password, "SELECT 1", controller.signal),
        );
        const selectActual = await collectActualSqlServerPlan(
          p,
          password,
          `SELECT * FROM ${table}`,
        );
        const adapter = new SqlServerAdapter();
        assert.ok(
          adapter
            .parseStatements(selectActual.raw)[0]
            .nodes.some((node) => node.actuals),
        );
        const insertActual = await collectActualSqlServerPlan(
          p,
          password,
          `INSERT INTO ${table} VALUES (2,N'two')`,
        );
        assert.ok(
          adapter
            .parseStatements(insertActual.raw)[0]
            .nodes.some((node) => node.actuals),
        );
        assert.equal((await query(`SELECT COUNT(*) FROM ${table}`))[0][0], 2);
      } finally {
        await query(`DROP TABLE ${table}`);
      }
    });
  },
);
