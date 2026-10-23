import { loadAdapter, openPreview } from "./helpers/browserHarness.mjs";
import { postgresNative, sqlServerNative } from "./helpers/nativePlans.mjs";
const { PostgresAdapter } = await loadAdapter("postgres");
const { SqlServerAdapter } = await loadAdapter("sqlserver");
const pg = new PostgresAdapter().parse(
  postgresNative({
    "Node Type": "Sort",
    "Plan Rows": 2000000,
    Plans: [
      {
        "Node Type": "Nested Loop",
        "Plan Rows": 2000000,
        Plans: [
          {
            "Node Type": "Seq Scan",
            "Plan Rows": 1000,
            "Parent Relationship": "Outer",
          },
          {
            "Node Type": "Index Scan",
            "Plan Rows": 1000,
            "Parent Relationship": "Inner",
            Filter: "lower(name)='x'",
          },
        ],
      },
    ],
  }),
);
const ms = new SqlServerAdapter().parseStatements(
  sqlServerNative({
    operator: "Sort",
    estimate: 2000000,
    statementWarnings:
      '<MissingIndexes><MissingIndexGroup Impact="50"><MissingIndex Schema="[dbo]" Table="[t]"><ColumnGroup Usage="EQUALITY"><Column Name="[name]"/></ColumnGroup></MissingIndex></MissingIndexGroup></MissingIndexes>',
    body: `<Sort><RelOp PhysicalOp="Nested Loops" EstimateRows="2000000"><NestedLoops>
    <RelOp PhysicalOp="Table Scan" EstimateRows="1000"/>
    <RelOp PhysicalOp="Index Scan" EstimateRows="1000" EstimateRebinds="999" EstimateRewinds="0"><IndexScan><Predicate><ScalarOperator ScalarString="lower([name])='x'"/></Predicate></IndexScan></RelOp>
  </NestedLoops></RelOp></Sort>`,
  }),
)[0];
const batch = {
  kind: "dbtuna-batch",
  schemaVersion: "1.0",
  id: "estimated-analysis",
  items: [pg, ms].map((plan, i) => ({
    index: i + 1,
    sql: "SELECT * FROM t",
    status: "complete",
    plan: { ...plan, id: "estimated-" + i },
  })),
};
const { browser, page, errors } = await openPreview({
  name: "estimated-analysis",
  state: { batch },
  viewport: { width: 1600, height: 1100 },
});
try {
  for (const i of [1, 2]) {
    const query = page.getByRole("region", { name: "Query " + i, exact: true });
    await query.scrollIntoViewIfNeeded();
    await query.locator(".operator").first().waitFor();
    const analysis = query.getByRole("region", {
      name: "Local plan analysis",
      exact: true,
    });
    await analysis
      .getByRole("button", { name: "Show whole query", exact: true })
      .click();
    for (const title of [
      "Large estimated sort/hash workload",
      "Potential join row expansion",
      "Potential repeated access from estimates",
      "Potential index-access issue in predicate expression",
    ])
      await analysis.getByText(title, { exact: true }).waitFor();
    if (
      !(await analysis
        .locator(".rule-finding small")
        .filter({ hasText: "Estimated risk" })
        .count())
    )
      throw Error("Estimated basis was not labeled");
    if (
      await analysis
        .locator(".rule-finding")
        .filter({ hasText: "Measured evidence" })
        .count()
    )
      throw Error("Estimate was labeled measured");
    if (i === 2)
      await analysis
        .getByText("SQL Server suggests missing-index candidates", {
          exact: true,
        })
        .waitFor();
    await analysis
      .getByRole("button", {
        name: /Potential index-access issue in predicate expression: highlight operator/,
      })
      .click();
    const selected = await query
      .getByRole("combobox", { name: "Select operator", exact: true })
      .inputValue();
    if (selected === batch.items[i - 1].plan.rootNodeIds[0])
      throw Error("Estimated finding did not navigate to its operator");
  }
  if (
    await page.evaluate(() =>
      window.__messages.some((m) =>
        ["RUN_ACTUAL", "AI_ANALYZE"].includes(m.type),
      ),
    )
  )
    throw Error("Estimated analysis requested execution or AI");
  if (errors.length) throw Error(errors.join("\n"));
  console.log(
    "Estimated analysis: both engines show labeled risks and navigable evidence before execution; SQL Server index candidates stay scoped.",
  );
} finally {
  await browser.close();
}
