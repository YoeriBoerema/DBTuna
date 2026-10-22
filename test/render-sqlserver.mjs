import { readFileSync } from "node:fs";
import {
  loadAdapter,
  openPreview,
  screenshot,
} from "./helpers/browserHarness.mjs";
const { SqlServerAdapter } = await loadAdapter("sqlserver");
const plans = new SqlServerAdapter().parseStatements(
  readFileSync("fixtures/sqlserver/multi-statement.sqlplan", "utf8").replace(
    "SELECT * FROM dbo.Customers",
    "SELECT *&#xd;&#xa;FROM dbo.Customers",
  ),
);
const batch = {
  kind: "dbtuna-batch",
  schemaVersion: "1.0",
  id: "sqlserver-browser",
  items: plans.map((plan, index) => ({
    index: index + 1,
    sql: plan.query,
    status: "complete",
    plan,
  })),
};
const { browser, page, errors } = await openPreview({
  name: "render-sqlserver",
  state: { batch },
  viewport: { width: 1440, height: 900 },
});
try {
  await page.waitForSelector(".operator");
  const queryPreview = page
    .getByRole("region", { name: "Query 1", exact: true })
    .locator(".query-sql");
  await queryPreview.locator("summary").click();
  const previewText = await queryPreview.locator("pre").innerText();
  if (
    previewText.includes("&#xd;") ||
    previewText.includes("&#xa;") ||
    !previewText.includes("\n")
  )
    throw Error("SQL preview still contains encoded XML line breaks");
  await queryPreview.locator("summary").click();
  if ((await page.locator(".query-section").count()) !== 2)
    throw Error("Statement query sections were not split");
  if ((await page.locator(".operator").count()) !== 4)
    throw Error("Missing SQL Server operators");
  const seek = page
    .locator(".operator")
    .filter({ has: page.locator("strong", { hasText: "Index Seek" }) });
  await seek.click();
  await page
    .getByRole("region", { name: "Query 1", exact: true })
    .locator("aside")
    .getByText("Subtree cost", { exact: true })
    .waitFor();
  await page.mouse.move(0, 0);
  await seek.hover();
  await page.waitForTimeout(550);
  await page
    .getByRole("tooltip")
    .getByText("Estimated CPU cost", { exact: true })
    .waitFor();
  await screenshot(page, { path: "media/sqlserver-plan.png" });
  if (errors.length) throw Error(errors.join("\n"));
  console.log(
    "SQL Server: two independent query sections with scoped graphs, native object details, scoped costs and delayed tooltip rendered.",
  );
} finally {
  await browser.close();
}
