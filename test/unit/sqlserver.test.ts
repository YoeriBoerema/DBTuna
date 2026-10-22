import { XMLParser } from "fast-xml-parser";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SqlServerAdapter } from "../../packages/adapter-sqlserver/src/sqlServerAdapter";
import { AdapterRegistry } from "../../packages/adapter-sdk/src/registry";
import { validate, bounded } from "../../packages/plan-core/src/schema";
import {
  splitTsqlBatch,
  validateTsql,
} from "../../src/extension/sql/sqlServerSelection";
import {
  explainSqlServerSession,
  sqlServerConfig,
} from "../../src/extension/connection/sqlServerClient";
import { profileSchema } from "../../src/extension/connection/profile";
const xml = readFileSync(
  new URL("../../fixtures/sqlserver/multi-statement.sqlplan", import.meta.url),
  "utf8",
);
test("SQL Server XML maps multiple statements, scoped IDs, native properties and subtree metrics", () => {
  const plan = new AdapterRegistry([new SqlServerAdapter()]).parse(xml);
  assert.equal(plan.database.engine, "sqlserver");
  assert.equal(plan.nodes.length, 4);
  assert.equal(plan.rootNodeIds.length, 2);
  assert.equal(plan.edges.length, 2);
  const seek = plan.nodes[1];
  assert.equal(seek.category, "INDEX_ACCESS");
  assert.equal(seek.object?.index, "[IX_Customers_LastName]");
  assert.equal(plan.nodes[0].object, undefined); // Never borrow a child's accessed object.
  assert.equal(seek.estimates?.costScope, "subtree");
  assert.equal(seek.actuals, undefined);
  assert.equal(plan.nodes[0].estimates?.cpuCost, 0.001);
  assert.ok(seek.properties.IndexScan);
  assert.equal(plan.nodes[3].category, "OTHER");
  assert.equal(
    new SqlServerAdapter().parse(
      xml.replace("IX_Customers_LastName", "IX_A&amp;B"),
    ).nodes[1].object?.index,
    "[IX_A&B]",
  );
  assert.ok(plan.metadata.nativeXml);
  assert.deepEqual(
    validate(bounded(JSON.stringify(plan))),
    JSON.parse(JSON.stringify(plan)),
  );
});
test("XML rejects malformed, entity declarations, excessive depth, invalid metrics and missing operators", () => {
  const adapter = new SqlServerAdapter();
  assert.throws(() =>
    adapter.parse(xml.replace('EstimateRows="12"', 'EstimateRows="-1"')),
  );
  assert.throws(() => adapter.parse(xml.slice(0, 200)));
  assert.throws(() => adapter.parse('<!DOCTYPE x [<!ENTITY e "x">]>' + xml));
  assert.throws(() =>
    adapter.parse(
      "<ShowPlanXML>" + "<x>".repeat(70) + "</x>".repeat(70) + "</ShowPlanXML>",
    ),
  );
  assert.throws(() => adapter.parse("<ShowPlanXML/>"));
});
test("deep Showplan operator trees parse and split within bounded limits", () => {
  const operator =
    '<RelOp PhysicalOp="Nested Loops" EstimateRows="1"><NestedLoops>';
  const makePlan = (depth: number) =>
    '<ShowPlanXML><BatchSequence><Batch><Statements><StmtSimple StatementText="SELECT 1"><QueryPlan>' +
    operator.repeat(depth) +
    '<RelOp PhysicalOp="Constant Scan" />' +
    "</NestedLoops></RelOp>".repeat(depth) +
    "</QueryPlan></StmtSimple></Statements></Batch></BatchSequence></ShowPlanXML>";
  const adapter = new SqlServerAdapter();
  const plan = adapter.parseStatements(makePlan(80))[0];
  assert.equal(plan.nodes.length, 81);
  assert.equal(plan.edges.length, 80);
  assert.equal(validate(JSON.stringify(plan)).nodes.length, 81);
  assert.throws(
    () => adapter.parseStatements(makePlan(300)),
    /nested tags|nesting/i,
  );
});

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
test("T-SQL rejects Showplan escape attempts, dynamic code, SQLCMD and unsupported controls", () => {
  for (const sql of [
    "SELECT 1; SET SHOWPLAN_XML OFF; INSERT INTO t VALUES(1)",
    "SELECT @UPDATE; SET SHOWPLAN_XML OFF",
    "EXEC('SELECT 1')",
    "SELECT 1; EXEC sp_executesql N'x'",
    "SELECT 1; :r script.sql",
    "SELECT 1\nGO 2",
    "UPDATE t SET x=1",
    "DELETE FROM t",
    "DECLARE @x int=1",
  ])
    assert.throws(() => validateTsql(sql), sql);
  validateTsql("INSERT INTO [SET] SELECT N'SET SHOWPLAN_XML OFF'; -- SET\n");
  validateTsql("WITH x AS (SELECT TOP (1) * FROM [dbo].[t]) SELECT * FROM x;");
});
test("Showplan session uses separate batches and cleans up on success and failure without retries", async () => {
  const calls: string[] = [];
  const run = async (sql: string) => {
    calls.push(sql);
    return sql === "SELECT 1" ? [[xml]] : [];
  };
  const result = await explainSqlServerSession(run, "SELECT 1");
  assert.equal(result.raw, xml);
  assert.deepEqual(calls, [
    "SET SHOWPLAN_XML ON",
    "SELECT 1",
    "SET SHOWPLAN_XML OFF",
  ]);
  calls.length = 0;
  await assert.rejects(() =>
    explainSqlServerSession(async (sql) => {
      calls.push(sql);
      if (sql === "SELECT 1") throw Error("permission denied");
      return [];
    }, "SELECT 1"),
  );
  assert.deepEqual(calls, [
    "SET SHOWPLAN_XML ON",
    "SELECT 1",
    "SET SHOWPLAN_XML OFF",
  ]);
  calls.length = 0;
  await assert.rejects(() =>
    explainSqlServerSession(async (sql) => {
      calls.push(sql);
      throw Error("no showplan permission");
    }, "SELECT 1"),
  );
  assert.deepEqual(calls, ["SET SHOWPLAN_XML ON"]);
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

test("SSMS UTF-16 and UTF-8 files decode before XML import", async () => {
  const { decodePlan } = await import("../../src/extension/services/planText");
  const adapter = new SqlServerAdapter();
  for (const bytes of [
    Buffer.from(xml),
    Buffer.concat([Buffer.from([255, 254]), Buffer.from(xml, "utf16le")]),
    Buffer.concat([
      Buffer.from([254, 255]),
      Buffer.from(xml, "utf16le").swap16(),
    ]),
  ])
    assert.equal(adapter.parse(decodePlan(bytes)).nodes.length, 4);
});

test("batch cost sums independent roots without counting child subtree costs twice", async () => {
  const { estimatedPlanCost } =
    await import("../../packages/plan-core/src/metrics");
  const plan = new SqlServerAdapter().parse(xml);
  plan.nodes[3].estimates!.totalCost = 2;
  assert.equal(estimatedPlanCost(plan), 2.02);
  delete plan.nodes[3].estimates!.totalCost;
  assert.equal(estimatedPlanCost(plan), undefined);
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
      assert.equal(sql, text);
      return adapter.parseStatements(native);
    },
    new AbortController().signal,
    () => {},
  );
  assert.equal(calls, 1); // Preserve compilation context; never run separate user statements.
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

test("SQL Server XML line-break references decode before preview, batching and execution validation", async () => {
  const { XMLParser, XMLBuilder } = await import("fast-xml-parser");
  const { executionQuery } =
    await import("../../src/extension/services/executionQuery");
  const query = `SELECT * FROM CUSTOMERS c \r\n inner JOIN CUSTOMERS_HISTORY ch ON c.CUSTOMER_ID = ch.CUSTOMER_ID \r\n and ch.CUSTOMERHIS_ID is not null \r\n and c.CUSTOMER_ID is not NULL \r\n inner join ORDERS o on o.CUSTOMER_ID = c.CUSTOMER_ID \r\n inner join products p on p.PRODUCT_ID = o.PRODUCT_ID`;
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
  const encoded = new XMLBuilder({
    ignoreAttributes: false,
    suppressBooleanAttributes: false,
  })
    .build(doc)
    .replaceAll("\r", "&#xd;")
    .replaceAll("\n", "&#xa;");
  const adapter = new SqlServerAdapter();
  for (const source of [
    encoded,
    encoded.replaceAll("&#xd;", "&#13;").replaceAll("&#xa;", "&#10;"),
  ]) {
    const plans = adapter.parseStatements(source);
    assert.equal(plans.length, 3);
    for (const plan of plans) {
      assert.equal(plan.query, query);
      assert.equal(executionQuery(plan).kind, "SELECT");
      assert.equal(executionQuery(plan).sql, query);
      assert.ok(!plan.query!.includes("&#xd;"));
    }
  }
});
test("XML values decode exactly once without changing entity-looking SQL literals or identifiers", async () => {
  const { decodeXmlValue } =
    await import("../../packages/adapter-sqlserver/src/xmlValues");
  assert.equal(
    decodeXmlValue("&#xd;&#xa;&#13;&#10;&#x1F41F;"),
    "\r\n\r\n\u{1F41F}",
  );
  assert.equal(
    decodeXmlValue("&amp;#xd; &amp;amp; &lt; &gt; &quot; &apos;"),
    "&#xd; &amp; < > \" '",
  );
  assert.throws(() => decodeXmlValue("&#0;"));
  assert.throws(() => decodeXmlValue("&#xD800;"));
  assert.throws(() => decodeXmlValue("&#x110000;"));
  const { XMLParser, XMLBuilder } = await import("fast-xml-parser");
  const doc = new XMLParser({ ignoreAttributes: false }).parse(xml);
  const statement =
    doc.ShowPlanXML.BatchSequence.Batch.Statements.StmtSimple[0];
  statement["@_StatementText"] =
    "SELECT N'&#xd;', N'&amp;', N'&lt;', N'a & b', N'<literal>' AS [emoji\u{1F41F}]";
  doc.ShowPlanXML.BatchSequence.Batch.Statements.StmtSimple = [statement];
  const encoded = new XMLBuilder({
    ignoreAttributes: false,
    suppressBooleanAttributes: false,
  }).build(doc);
  const plan = new SqlServerAdapter().parseStatements(encoded)[0];
  assert.equal(plan.query, statement["@_StatementText"]);
  assert.equal(
    new SqlServerAdapter().parseStatements(String(plan.metadata.nativeXml))[0]
      .query,
    plan.query,
  );
});

test("statement extraction parses XML once and preserves scoped native XML without double decoding", (context) => {
  const parse = context.mock.method(XMLParser.prototype, "parse");
  const plans = new SqlServerAdapter().parseStatements(xml);
  assert.equal(parse.mock.callCount(), 1);
  assert.equal(plans.length, 2);
  assert.equal(
    String(plans[0].metadata.nativeXml).includes('StatementId="2"'),
    false,
  );
  assert.equal(
    String(plans[1].metadata.nativeXml).includes('StatementId="1"'),
    false,
  );
});

test("statement splitting enforces the operator budget across the entire native document", () => {
  const nodes = Array.from(
    { length: 600 },
    (_, index) =>
      `<RelOp NodeId="${index}" PhysicalOp="Constant Scan"><ConstantScan/></RelOp>`,
  ).join("");
  const statements = [1, 2]
    .map(
      (id) =>
        `<StmtSimple StatementId="${id}" StatementText="SELECT 1" StatementType="SELECT"><QueryPlan>${nodes}</QueryPlan></StmtSimple>`,
    )
    .join("");
  assert.throws(
    () =>
      new SqlServerAdapter().parseStatements(
        `<ShowPlanXML><BatchSequence><Batch><Statements>${statements}</Statements></Batch></BatchSequence></ShowPlanXML>`,
      ),
    /1000 operators/,
  );
});
