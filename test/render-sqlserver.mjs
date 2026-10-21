import { build } from "esbuild";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
await build({
  entryPoints: ["packages/adapter-sqlserver/src/sqlServerAdapter.ts"],
  outfile: "work/sqlserver-adapter.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
});
const require = createRequire(import.meta.url);
const { SqlServerAdapter } = require("../work/sqlserver-adapter.cjs");
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
writeFileSync(
  "work/sqlserver-preview.html",
  `<html><head><link rel="stylesheet" href="../dist/webview.css"></head><body><div id="root"></div><script>window.acquireVsCodeApi=()=>({getState:()=>({batch:${JSON.stringify(batch)}}),setState:()=>{},postMessage:()=>{}})</script><script src="../dist/webview.js"></script></body></html>`,
);
const browser = await chromium.launch({
  executablePath: process.env.DBTUNA_BROWSER,
  headless: true,
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(resolve("work/sqlserver-preview.html")).href);
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
  await page.screenshot({ path: "media/sqlserver-plan.png" });
  if (errors.length) throw Error(errors.join("\n"));
  console.log(
    "SQL Server: two independent query sections with scoped graphs, native object details, scoped costs and delayed tooltip rendered.",
  );
} finally {
  await browser.close();
}
