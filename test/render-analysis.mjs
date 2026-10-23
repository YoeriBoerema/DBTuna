import { loadAdapter, openPreview } from "./helpers/browserHarness.mjs";
const { PostgresAdapter } = await loadAdapter("postgres");
const { SqlServerAdapter } = await loadAdapter("sqlserver");
const postgres = new PostgresAdapter().parse([
  {
    Plan: {
      "Node Type": "Aggregate",
      "Plan Rows": 1,
      Plans: [
        {
          "Node Type": "Seq Scan",
          "Relation Name": "customers",
          "Plan Rows": 10,
          "Actual Rows": 10000,
          "Actual Loops": 1,
          "Rows Removed by Filter": 200000,
          Filter: "lower(name) = '<img src=x onerror=alert(1)>'",
          "Sort Space Type": "Disk",
        },
      ],
    },
  },
]);
const sqlserver = new SqlServerAdapter()
  .parseStatements(`<ShowPlanXML><BatchSequence><Batch><Statements>
<StmtSimple StatementText="SELECT 1" StatementType="SELECT"><QueryPlan>
<Warnings><PlanAffectingConvert Expression="CONVERT_IMPLICIT(int,[id],0)"/></Warnings>
<RelOp PhysicalOp="Nested Loops" EstimateRows="1"><NestedLoops>
<RelOp PhysicalOp="Index Scan" EstimateRows="10"><RunTimeInformation>
<RunTimeCountersPerThread ActualRows="10000" ActualExecutions="1" ActualRowsRead="200000"/>
</RunTimeInformation><Warnings><SpillToTempDb SpillLevel="1"/></Warnings></RelOp>
</NestedLoops></RelOp></QueryPlan></StmtSimple></Statements></Batch></BatchSequence></ShowPlanXML>`)[0];
for (const [engine, plan] of [
  ["postgresql", postgres],
  ["sqlserver", sqlserver],
]) {
  const { browser, page, errors } = await openPreview({
    name: "render-analysis-" + engine,
    state: { plan },
    viewport: { width: 1500, height: 1000 },
  });
  try {
    await page.locator(".operator").first().waitFor();
    const target = plan.nodes.find((node) => node.actuals).id;
    await page
      .getByRole("combobox", { name: "Select operator" })
      .selectOption(target);
    const panel = page.getByRole("region", {
      name: "Local plan analysis",
      exact: true,
    });
    await panel
      .getByText("Large estimated-versus-actual row discrepancy", {
        exact: true,
      })
      .waitFor();
    await panel
      .getByText("Disk-backed sort or hash work reported", { exact: true })
      .waitFor();
    await panel
      .getByText("Most examined rows were filtered out", { exact: true })
      .waitFor();
    await panel
      .getByRole("button", { name: "Show whole query", exact: true })
      .click();
    await panel
      .getByRole("button", { name: "Show selected operator", exact: true })
      .waitFor();
    await panel
      .getByText("Analysis coverage and limitations", { exact: true })
      .click();
    await panel.getByText(/Schema, existing indexes/).waitFor();
    if (await panel.locator("img, script").count())
      throw Error("Native evidence was interpreted as HTML");
    for (const action of ["click", "Enter", " "]) {
      await page
        .getByRole("combobox", { name: "Select operator" })
        .selectOption(plan.rootNodeIds[0]);
      await panel
        .getByRole("button", { name: "Show whole query", exact: true })
        .click();
      const finding = panel.getByRole("button", {
        name: `Large estimated-versus-actual row discrepancy: highlight operator ${target}`,
        exact: true,
      });
      if (action === "click") await finding.click();
      else await finding.press(action);
      await page.waitForFunction((id) => {
        const selected = document.querySelector(".react-flow__node.selected");
        return (
          selected?.getAttribute("data-id") === id &&
          document.querySelector('select[aria-label="Select operator"]')
            .value === id
        );
      }, target);
      await page
        .waitForFunction(
          (id) => {
            const node = [
              ...document.querySelectorAll(".react-flow__node"),
            ].find((n) => n.getAttribute("data-id") === id);
            const n = node.getBoundingClientRect();
            const c = document
              .querySelector(".react-flow")
              .getBoundingClientRect();
            return (
              Math.abs(n.x + n.width / 2 - c.x - c.width / 2) < 5 &&
              Math.abs(n.y + n.height / 2 - c.y - c.height / 2) < 5
            );
          },
          target,
          { timeout: 3000 },
        )
        .catch(async (error) => {
          console.log(
            engine,
            action,
            await page.evaluate(
              (id) => ({
                node: document
                  .querySelector(`.react-flow__node[data-id="${id}"]`)
                  .getBoundingClientRect()
                  .toJSON(),
                canvas: document
                  .querySelector(".react-flow")
                  .getBoundingClientRect()
                  .toJSON(),
                transform: document
                  .querySelector(".react-flow__viewport")
                  .getAttribute("style"),
              }),
              target,
            ),
          );
          throw error;
        });
    }
    if (
      await page.evaluate(() =>
        window.__messages.some((m) =>
          ["AI_ANALYZE", "RUN_ACTUAL"].includes(m.type),
        ),
      )
    )
      throw Error("Local analysis requested AI or execution");
    if (errors.length) throw Error(errors.join("\n"));
  } finally {
    await browser.close();
  }
}
console.log(
  "Local analysis: both engines display operator and query findings, evidence and coverage without AI or execution requests.",
);
