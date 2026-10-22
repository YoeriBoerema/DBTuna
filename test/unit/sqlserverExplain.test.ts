import { test } from "node:test";
import assert from "node:assert/strict";
import { prepareBatch, explainBatch } from "../../src/extension/services/batchExplain";
import { splitTsqlBatch } from "../../src/extension/sql/sqlServerSelection";
import { prepareTsqlExplain } from "../../src/extension/sql/sqlServerExplain";
import { restoreBatch } from "../../packages/plan-core/src/batch";
import { PostgresAdapter } from "../../packages/adapter-postgres/src/postgresAdapter";

test("tolerant SQL Server explanation skips setup and continues after dependent-table failures", async () => {
  const batch = prepareBatch(splitTsqlBatch(`SET NOCOUNT ON;
CREATE TABLE #results (id int);
SELECT * FROM #results;
SELECT * FROM customers;`), "sqlserver");
  assert.deepEqual(batch.items.map((item) => item.status), ["skipped", "skipped", "pending", "pending"]);
  const collected: string[] = [];
  const plan = new PostgresAdapter().parse([{ Plan: { "Node Type": "Result", "Total Cost": 1, "Plan Rows": 1 } }]);
  const result = await explainBatch(batch, async (sql) => {
    collected.push(sql);
    if (sql.includes("#results")) throw Error("Invalid object name '#results'.");
    return { ...plan, query: sql };
  }, new AbortController().signal, () => {});
  assert.deepEqual(collected, ["SELECT * FROM #results;", "SELECT * FROM customers;"]);
  assert.deepEqual(result.items.map((item) => item.status), ["skipped", "skipped", "error", "complete"]);
  assert.equal(restoreBatch(JSON.parse(JSON.stringify(result))).items[0].status, "skipped");
});

test("tolerant SQL splitting masks syntax and retains declarations without crossing GO", () => {
  const items = prepareBatch(splitTsqlBatch(`SET NOCOUNT ON
DECLARE @id int = 42;
SELECT @id, 'a;b SET NOCOUNT OFF;' AS [a;b]; /* ; */
GO
SELECT @id;`), "sqlserver").items;
  assert.equal(items[0].status, "skipped");
  assert.match(items[1].sql, /DECLARE @id int = 42;/);
  assert.match(items[1].sql, /'a;b SET NOCOUNT OFF;'/);
  assert.equal(items[2].sql, "SELECT @id;");
  assert.equal(items[2].status, "pending"); // SQL Server reports missing batch-local variables.
  assert.throws(() => prepareTsqlExplain("SET NOCOUNT ON; SELECT 'unfinished"));
  assert.equal(prepareTsqlExplain("SET NOCOUNT ON; SELECT CASE WHEN 1=1 THEN 'yes' ELSE 'no' END;")[1].skippedReason, undefined);
});

test("unsupported session changes and control flow never leak statements into compilation", () => {
  for (const setup of ["SET ANSI_NULLS OFF", "SET @id = 9", "USE other_database", "EXEC change_context"]) {
    const items = prepareBatch([`${setup}; SELECT 1;`, "SELECT 2;"], "sqlserver").items;
    assert.deepEqual(items.map((item) => item.status), ["skipped", "skipped", "pending"]);
  }
  for (const sql of [
    "IF 1=0 BEGIN SELECT 1; END; SELECT 2;",
    "CREATE PROCEDURE p AS SELECT 1; SELECT 2;",
  ]) {
    const items = prepareTsqlExplain(sql);
    assert.equal(items.length, 1);
    assert.ok(items[0].skippedReason);
  }
  assert.throws(() => prepareBatch(["SET NOCOUNT ON;" + "SELECT 1;".repeat(21)], "sqlserver"));
});
