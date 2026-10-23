import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  collectSqlServerPlan,
  collectActualSqlServerPlan,
  withSqlServer,
} from "../../src/extension/connection/sqlServerClient";
import { SqlServerAdapter } from "../../packages/adapter-sqlserver/src/sqlServerAdapter";
import type { Profile } from "../../src/extension/connection/profile";
import { databaseConnector } from "../../src/extension/connectors/registry";
import {
  prepareBatch,
  explainBatch,
} from "../../src/extension/services/batchExplain";
import { analyzePlan } from "../../packages/plan-analysis/src/analyze";
// Explicit opt-in; never read production connection strings or saved profiles.
test(
  "isolated SQL Server: estimates do not execute; explicit actual SELECT/INSERT runs collect metrics and commit writes",
  { skip: process.env.DBTUNA_SQLSERVER_TEST !== "1", timeout: 120000 },
  async (t) => {
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
        console.log(
          "Verified live SQL Server " +
            String(
              (
                await query(
                  "SELECT CONVERT(varchar(50), SERVERPROPERTY('ProductVersion'))",
                )
              )[0][0],
            ),
        );
        await t.test(
          "independent semicolon queries remain separate plans",
          async () => {
            const connector = databaseConnector("sqlserver");
            const batch = prepareBatch(
              connector.split(
                `SELECT * FROM ${table}; SELECT * FROM ${table}; SELECT * FROM ${table};`,
              ),
              "sqlserver",
            );
            const result = await explainBatch(
              batch,
              async (sql, signal) =>
                connector.parse(
                  (await connector.collectEstimated(p, password, sql, signal))
                    .raw,
                ),
              new AbortController().signal,
              () => {},
            );
            assert.equal(result.items.length, 3);
            assert.ok(result.items.every((item) => item.status === "complete"));
          },
        );
        await t.test(
          "large result sets are discarded while actual rows and analysis remain available",
          async () => {
            await query(
              `INSERT INTO ${table} SELECT TOP (2048) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) + 10, N'bulk' FROM sys.all_objects a CROSS JOIN sys.all_objects b`,
            );
            const plan = adapter.parseStatements(
              (
                await collectActualSqlServerPlan(
                  p,
                  password,
                  `SELECT * FROM ${table} ORDER BY name`,
                )
              ).raw,
            )[0];
            assert.ok(plan.nodes.some((node) => node.actuals?.rows === 2050));
            assert.doesNotThrow(() => analyzePlan(plan));
          },
        );
        await t.test("failed INSERT does not change rows", async () => {
          const before = (await query(`SELECT COUNT(*) FROM ${table}`))[0][0];
          await assert.rejects(
            collectActualSqlServerPlan(
              p,
              password,
              `INSERT INTO ${table} VALUES(1, N'duplicate')`,
            ),
          );
          assert.equal(
            (await query(`SELECT COUNT(*) FROM ${table}`))[0][0],
            before,
          );
        });
        await t.test(
          "mixed batch skips setup and preserves independent plans after errors",
          async () => {
            const connector = databaseConnector("sqlserver");
            const batch = prepareBatch(
              connector.split(
                `SET NOCOUNT ON; CREATE TABLE #unused(id int); SELECT * FROM ${table}; SELECT * FROM dbo.dbtuna_missing; SELECT id FROM ${table} WHERE id=1;`,
              ),
              "sqlserver",
            );
            const result = await explainBatch(
              batch,
              async (sql, signal) =>
                connector.parse(
                  (await connector.collectEstimated(p, password, sql, signal))
                    .raw,
                ),
              new AbortController().signal,
              () => {},
            );
            assert.deepEqual(
              result.items.map((item) => item.status),
              ["skipped", "skipped", "complete", "error", "complete"],
            );
          },
        );
        await t.test(
          "constant-only statements report absent graphical operators explicitly",
          async () => {
            const result = await collectSqlServerPlan(p, password, "SELECT 1");
            assert.match(String(result.raw), /StmtSimple/);
            assert.throws(
              () => adapter.parseStatements(result.raw),
              /no graphical operators/,
            );
          },
        );
        await t.test(
          "cancelling a blocked INSERT closes its server request without writing",
          async () => {
            const before = (await query(`SELECT COUNT(*) FROM ${table}`))[0][0],
              abort = new AbortController();
            await query(
              `BEGIN TRANSACTION; SELECT COUNT(*) FROM ${table} WITH (TABLOCKX, HOLDLOCK)`,
            );
            const pending = collectActualSqlServerPlan(
              p,
              password,
              `INSERT INTO ${table} VALUES(99999, N'cancelled')`,
              abort.signal,
            ).then(
              () => undefined,
              (error) => error,
            );
            try {
              let blocked = false;
              const deadline = Date.now() + 5000;
              while (Date.now() < deadline) {
                if (
                  Number(
                    (
                      await query(
                        "SELECT COUNT(*) FROM sys.dm_exec_requests WHERE blocking_session_id = @@SPID",
                      )
                    )[0][0],
                  ) > 0
                ) {
                  blocked = true;
                  break;
                }
                await delay(25);
              }
              assert.ok(
                blocked,
                "The actual INSERT did not reach the server lock",
              );
              abort.abort();
              const error = await pending;
              assert.ok(error instanceof Error);
              assert.match(error.message, /cancel|closed/i);
              let released = false;
              const cleanupDeadline = Date.now() + 5000;
              while (Date.now() < cleanupDeadline) {
                if (
                  Number(
                    (
                      await query(
                        "SELECT COUNT(*) FROM sys.dm_exec_requests WHERE blocking_session_id = @@SPID",
                      )
                    )[0][0],
                  ) === 0
                ) {
                  released = true;
                  break;
                }
                await delay(25);
              }
              assert.ok(
                released,
                "Cancelled request remained blocked on the server",
              );
            } finally {
              abort.abort();
              await pending;
              await query("ROLLBACK TRANSACTION");
            }
            assert.equal(
              (await query(`SELECT COUNT(*) FROM ${table}`))[0][0],
              before,
            );
          },
        );
      } finally {
        await query(`DROP TABLE ${table}`);
      }
    });
  },
);
