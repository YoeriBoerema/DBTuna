import { test } from "node:test";

import assert from "node:assert/strict";

import { readFileSync } from "node:fs";

import { SqlServerAdapter } from "../../packages/adapter-sqlserver/src/sqlServerAdapter";

import {
  splitTsqlBatch,
  validateTsql,
} from "../../src/extension/sql/sqlServerSelection";

import { sqlServerConfig } from "../../src/extension/connection/sqlServerClient";

import { profileSchema } from "../../src/extension/connection/profile";

const xml = readFileSync(
  new URL("../../fixtures/sqlserver/multi-statement.sqlplan", import.meta.url),
  "utf8",
);

test("T-SQL preserves dependent statements; GO only separates outside quoted content and comments", () => {
  const text =
    "DECLARE @x int=1; SELECT @x;\nGO -- next batch\nSELECT '[x;]'; /* GO */\nGO\nSELECT N'hello\nGO\nworld' AS [GO];";
  const parts = splitTsqlBatch(text);
  assert.equal(parts.length, 3);
  assert.match(parts[0], /DECLARE.*SELECT/);
  parts.forEach(validateTsql);
  assert.deepEqual(splitTsqlBatch("SELECT 0", "SELECT 42"), ["SELECT 42"]);
  assert.throws(() => splitTsqlBatch("SELECT 'unclosed"));
  assert.throws(() =>
    splitTsqlBatch(Array(22).fill("SELECT 1").join("\nGO\n")),
  );
});

test("typed profiles exclude secrets; SQL Server TLS and explicit NTLM configuration", () => {
  const p = profileSchema.parse({
    id: "s",
    name: "s",
    type: "sqlserver",
    host: "localhost",
    port: 1433,
    database: "test",
    user: "reader",
    ssl: "verify",
  });
  assert.ok(p.type === "sqlserver");
  assert.equal(
    sqlServerConfig(p, "secret").options?.trustServerCertificate,
    false,
  );
  assert.equal(
    sqlServerConfig({ ...p, ssl: "trust" }, "secret").options?.encrypt,
    true,
  );
  assert.equal(
    sqlServerConfig(
      { ...p, authentication: "ntlm", domain: "EXAMPLE" },
      "secret",
    ).authentication?.type,
    "ntlm",
  );
  assert.throws(() => profileSchema.parse({ ...p, type: undefined }));
  assert.throws(() => profileSchema.parse({ ...p, password: "secret" }));
  assert.throws(() => profileSchema.parse({ ...p, authentication: "ntlm" }));
});

test("three identical semicolon-separated SQL Server queries become three independent query sections", async () => {
  const { XMLParser, XMLBuilder } = await import("fast-xml-parser");
  const { prepareBatch, explainBatch, completedBatch } =
    await import("../../src/extension/services/batchExplain");
  const query = `SELECT * FROM CUSTOMERS c
 inner JOIN CUSTOMERS_HISTORY ch ON c.CUSTOMER_ID = ch.CUSTOMER_ID
 and ch.CUSTOMERHIS_ID is not null and c.CUSTOMER_ID is not NULL
 inner join ORDERS o on o.CUSTOMER_ID = c.CUSTOMER_ID
 inner join products p on p.PRODUCT_ID = o.PRODUCT_ID;`;
  const text = [query, query, query].join("\n\n");
  const doc = new XMLParser({ ignoreAttributes: false }).parse(xml);
  const statement =
    doc.ShowPlanXML.BatchSequence.Batch.Statements.StmtSimple[0];
  doc.ShowPlanXML.BatchSequence.Batch.Statements.StmtSimple = [1, 2, 3].map(
    (id) => ({
      ...statement,
      "@_StatementId": String(id),
      "@_StatementText": query,
    }),
  );
  const native = new XMLBuilder({
    ignoreAttributes: false,
    suppressBooleanAttributes: false,
  }).build(doc);
  const adapter = new SqlServerAdapter();
  let calls = 0;
  const result = await explainBatch(
    prepareBatch(splitTsqlBatch(text), "sqlserver"),
    async (sql) => {
      calls++;
      assert.equal(sql, query);
      return [adapter.parseStatements(native)[calls - 1]];
    },
    new AbortController().signal,
    () => {},
  );
  assert.equal(calls, 3); // Compile independent statements separately; never execute them.
  assert.equal(result.items.length, 3);
  assert.deepEqual(
    result.items.map((item) => item.index),
    [1, 2, 3],
  );
  assert.equal(new Set(result.items.map((item) => item.plan!.id)).size, 3);
  for (const item of result.items) {
    assert.equal(item.sql, query);
    assert.equal(item.status, "complete");
    assert.equal(item.plan!.nodes.length, 3);
    assert.equal(item.plan!.rootNodeIds.length, 1);
    assert.ok(
      !String(item.plan!.metadata.nativeXml).includes('StatementId="2"') ||
        item.index === 2,
    );
  }
  assert.equal(completedBatch(adapter.parseStatements(native)).items.length, 3);
});

test("statement expansion preserves subsequent GO batches, declarations, cancellation and result limits", async () => {
  const { prepareBatch, explainBatch } =
    await import("../../src/extension/services/batchExplain");
  const plans = new SqlServerAdapter().parseStatements(xml);
  const controller = new AbortController();
  let calls = 0;
  const result = await explainBatch(
    prepareBatch(
      ["DECLARE @x int=1; SELECT @x; SELECT 1;", "SELECT 2", "SELECT 3"],
      "sqlserver",
    ),
    async (sql) => {
      calls++;
      if (calls === 1) {
        assert.match(sql, /DECLARE/);
        return plans;
      }
      assert.equal(sql, "SELECT 2");
      controller.abort();
      throw Error("cancelled");
    },
    controller.signal,
    () => {},
  );
  assert.equal(calls, 2);
  assert.deepEqual(
    result.items.map((item) => item.status),
    ["complete", "complete", "cancelled", "cancelled"],
  );
  assert.deepEqual(
    result.items.map((item) => item.index),
    [1, 2, 3, 4],
  );
  const tooMany = await explainBatch(
    prepareBatch(["SELECT 1"], "sqlserver"),
    async () => Array(21).fill(plans[0]),
    new AbortController().signal,
    () => {},
  );
  assert.equal(tooMany.items.length, 1);
  assert.equal(tooMany.items[0].status, "error");
});
