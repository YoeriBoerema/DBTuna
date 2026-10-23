import { loadAdapter, openPreview } from "./helpers/browserHarness.mjs";
const { PostgresAdapter } = await loadAdapter("postgres");
const { SqlServerAdapter } = await loadAdapter("sqlserver");
const postgres = new PostgresAdapter().parse([{ Plan: {
  "Node Type": "Seq Scan", "Relation Name": "customers", "Plan Rows": 10,
  "Actual Rows": 10000, "Actual Loops": 1, "Rows Removed by Filter": 200000,
  Filter: "lower(name) = '<img src=x onerror=alert(1)>'", "Sort Space Type": "Disk",
} }]);
const sqlserver = new SqlServerAdapter().parseStatements(`<ShowPlanXML><BatchSequence><Batch><Statements>
<StmtSimple StatementText="SELECT 1" StatementType="SELECT"><QueryPlan>
<Warnings><PlanAffectingConvert Expression="CONVERT_IMPLICIT(int,[id],0)"/></Warnings>
<RelOp PhysicalOp="Index Scan" EstimateRows="10"><RunTimeInformation>
<RunTimeCountersPerThread ActualRows="10000" ActualExecutions="1" ActualRowsRead="200000"/>
</RunTimeInformation><Warnings><SpillToTempDb SpillLevel="1"/></Warnings></RelOp>
</QueryPlan></StmtSimple></Statements></Batch></BatchSequence></ShowPlanXML>`)[0];
for (const [engine, plan] of [["postgresql", postgres], ["sqlserver", sqlserver]]) {
  const { browser, page, errors } = await openPreview({
    name: "render-analysis-" + engine, state: { plan },
    viewport: { width: 1500, height: 1000 },
  });
  try {
    await page.locator(".operator").first().waitFor();
    await page.locator(".operator").first().click();
    const panel = page.getByRole("region", { name: "Local plan analysis", exact: true });
    await panel.getByText("Large estimated-versus-actual row discrepancy", { exact: true }).waitFor();
    await panel.getByText("Disk-backed sort or hash work reported", { exact: true }).waitFor();
    await panel.getByText("Most examined rows were filtered out", { exact: true }).waitFor();
    await panel.getByRole("button", { name: "Show whole query", exact: true }).click();
    await panel.getByRole("button", { name: "Show selected operator", exact: true }).waitFor();
    await panel.getByText("Analysis coverage and limitations", { exact: true }).click();
    await panel.getByText(/Schema, existing indexes/).waitFor();
    if (await panel.locator("img, script").count()) throw Error("Native evidence was interpreted as HTML");
    if (await page.evaluate(() => window.__messages.some((m) => ["AI_ANALYZE", "RUN_ACTUAL"].includes(m.type))))
      throw Error("Local analysis requested AI or execution");
    if (errors.length) throw Error(errors.join("\n"));
  } finally { await browser.close(); }
}
console.log("Local analysis: both engines display operator and query findings, evidence and coverage without AI or execution requests.");
