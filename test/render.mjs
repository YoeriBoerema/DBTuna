import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
await build({
  entryPoints: ["packages/adapter-postgres/src/postgresAdapter.ts"],
  outfile: "work/adapter.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
});
const { PostgresAdapter } = require("../work/adapter.cjs");
const plan = new PostgresAdapter().parse(
  readFileSync("fixtures/postgres/nested-loop.json", "utf8"),
);
mkdirSync("work", { recursive: true });
const html = `<html><head><link rel="stylesheet" href="../dist/webview.css"></head><body><div id="root"></div><script>window.__messages=[];window.__state={plan:${JSON.stringify(plan)}};window.acquireVsCodeApi=()=>({getState:()=>window.__state,setState:s=>window.__state=s,postMessage:m=>window.__messages.push(m)})</script><script src="../dist/webview.js"></script></body></html>`;
writeFileSync("work/preview.html", html);
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
  await page.goto(pathToFileURL(resolve("work/preview.html")).href);
  await page.waitForSelector(".operator");
  await page.waitForTimeout(800);
  const horizontal = () =>
    page.evaluate(() => {
      const root = document
        .querySelector('.react-flow__node[data-id="0"]')
        ?.getBoundingClientRect();
      const child = document
        .querySelector('.react-flow__node[data-id="0.0"]')
        ?.getBoundingClientRect();
      return !!root && !!child && root.left < child.left;
    });
  if (!(await horizontal()))
    throw Error("Compact view did not put the root left of its input");
  await page.getByText("Index Scan", { exact: true }).first().click();
  await page.waitForSelector('aside h2:text("Index Scan")');
  await page.screenshot({ path: "media/screenshot.png" });
  await page.mouse.move(0, 0);
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  const indexNode = page
    .locator(".operator")
    .filter({ has: page.locator("strong", { hasText: "Index Scan" }) });
  await indexNode.hover({ force: true });
  await page.clock.fastForward(499);
  if (await page.getByRole("tooltip").count())
    throw Error("Cost tooltip appeared before half a second");
  await page.clock.fastForward(2);
  await page.getByRole("tooltip").waitFor();
  if (
    !(await page
      .getByRole("tooltip")
      .getByText("Index Scan", { exact: true })
      .count())
  )
    throw Error("Tooltip contains the wrong operator");
  if (
    !(await page
      .getByRole("tooltip")
      .getByText("Startup cost", { exact: true })
      .count()) ||
    !(await page
      .getByRole("tooltip")
      .getByText("Total cost", { exact: true })
      .count())
  )
    throw Error("Tooltip lacks cost estimates");
  await page.screenshot({ path: "work/cost-tooltip.png" });
  await page.mouse.move(0, 0);
  if (await page.getByRole("tooltip").count())
    throw Error("Tooltip did not dismiss on pointer leave");
  await indexNode.hover({ force: true });
  await page.clock.fastForward(250);
  await page.mouse.move(0, 0);
  await page.clock.fastForward(1000);
  if (await page.getByRole("tooltip").count())
    throw Error("Cancelled hover still opened a tooltip");
  await indexNode.hover({ force: true });
  await page.clock.fastForward(499);
  if (await page.getByRole("tooltip").count())
    throw Error("Re-entry did not restart the hover delay");
  await page.clock.fastForward(2);
  await page.getByRole("tooltip").waitFor();
  await page.keyboard.press("Escape");
  if (await page.getByRole("tooltip").count())
    throw Error("Escape did not dismiss tooltip");
  await page.mouse.move(0, 0);
  await page.clock.resume();
  console.log(
    "Half-second cost tooltip delay, cancellation, re-entry and Escape verified.",
  );
  await page.getByRole("combobox", { name: "Plan view" }).selectOption("cards");
  await page.waitForSelector(".operator:not(.compact)");
  await page.waitForFunction(() => {
    const root = document
      .querySelector('.react-flow__node[data-id="0"]')
      ?.getBoundingClientRect();
    const child = document
      .querySelector('.react-flow__node[data-id="0.0"]')
      ?.getBoundingClientRect();
    return !!root && !!child && root.top < child.top;
  });
  await page.waitForSelector('aside h2:text("Index Scan")');
  await page.waitForFunction(() => window.__state.view === "cards");
  await page.screenshot({ path: "work/card-view.png" });
  await page
    .getByRole("combobox", { name: "Plan view" })
    .selectOption("compact");
  await page.waitForSelector(".operator.compact");
  await page.waitForFunction(() => window.__state.view === "compact");
  if (!(await horizontal()))
    throw Error("Switching back did not restore horizontal layout");
  console.log(
    "View switching, selection preservation, orientation and saved view preference verified.",
  );
  await page.getByRole("button", { name: "Export" }).click();
  if (
    !(await page.evaluate(() =>
      window.__messages.some((m) => m.type === "EXPORT_PLAN"),
    ))
  )
    throw Error("Export handshake failed");
  await page.getByRole("button", { name: "Import", exact: true }).click();
  if (
    !(await page.evaluate(() =>
      window.__messages.some((m) => m.type === "IMPORT_PLAN"),
    ))
  )
    throw Error("Import handshake failed");
  const lightTheme = await page.addStyleTag({
    content:
      ":root{--vscode-foreground:#202020;--vscode-editor-background:#ffffff;--vscode-editorWidget-background:#f5f5f5;--vscode-sideBar-background:#f3f3f3;--vscode-panel-border:#c7c7c7;--vscode-descriptionForeground:#555;--vscode-button-secondaryBackground:#dedede;--vscode-button-secondaryForeground:#202020}",
  });
  await page.screenshot({ path: "work/light-theme.png" });
  await page.emulateMedia({ forcedColors: "active" });
  await page.screenshot({ path: "work/high-contrast.png" });
  const large = new PostgresAdapter().parse([
    {
      Plan: {
        "Node Type": "Append",
        Plans: Array.from({ length: 100 }, () => ({ "Node Type": "Seq Scan" })),
      },
    },
  ]);
  const start = Date.now();
  await page.evaluate(
    (p) => window.postMessage({ type: "PLAN_LOADED", payload: p }, "*"),
    large,
  );
  await page.waitForFunction(
    () => document.querySelectorAll(".operator").length === 101,
    {},
    { timeout: 15000 },
  );
  await page
    .getByRole("combobox", { name: "Select operator" })
    .selectOption("0.99");
  await page.waitForSelector('aside h2:text("Seq Scan")');
  console.log(
    "101-node layout and selection: " +
      (Date.now() - start) +
      "ms; light/high-contrast token render and import/export messages verified.",
  );
  const insertPlan = new PostgresAdapter().parse(
    readFileSync("fixtures/postgres/real-insert-postgres-18.json", "utf8"),
  );
  await page.evaluate(
    (p) => window.postMessage({ type: "PLAN_LOADED", payload: p }, "*"),
    insertPlan,
  );
  await page.waitForSelector('aside h2:text("Insert")');
  await page
    .locator("aside")
    .getByText("ModifyTable", { exact: true })
    .waitFor();
  console.log("INSERT operator label and native ModifyTable details verified.");
  await page.emulateMedia({ forcedColors: "none" });
  await lightTheme.evaluate((element) => element.remove());
  await page
    .locator(".operator strong")
    .filter({ hasText: /^Insert$/ })
    .waitFor();
  await page.getByRole("button", { name: "Fit view", exact: true }).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: "media/horizontal-plan.png" });
  const batch = {
    kind: "dbtuna-batch",
    schemaVersion: "1.0",
    id: "browser-batch",
    connectionLabel: "Local samples",
    items: [
      { index: 1, sql: "SELECT * FROM orders;", status: "running" },
      {
        index: 2,
        sql: "SELECT * FROM orders o JOIN customers c ON c.id=o.customer_id;",
        status: "pending",
      },
      {
        index: 3,
        sql: "SELECT missing_column FROM orders;",
        status: "pending",
      },
    ],
  };
  await page.evaluate(
    (b) => window.postMessage({ type: "BATCH_LOADED", payload: b }, "*"),
    batch,
  );
  await page.getByRole("button", { name: "Cancel batch", exact: true }).click();
  if (
    !(await page.evaluate(() =>
      window.__messages.some((m) => m.type === "CANCEL_BATCH"),
    ))
  )
    throw Error("Batch cancel message missing");
  batch.items[0] = {
    ...batch.items[0],
    status: "complete",
    plan: new PostgresAdapter().parse(
      readFileSync("fixtures/postgres/seq-scan.json", "utf8"),
    ),
  };
  batch.items[1] = { ...batch.items[1], status: "complete", plan };
  batch.items[2] = {
    ...batch.items[2],
    status: "error",
    error: "Column missing_column does not exist.",
  };
  await page.setViewportSize({ width: 1440, height: 1480 });
  await page.evaluate(
    (b) => window.postMessage({ type: "BATCH_LOADED", payload: b }, "*"),
    batch,
  );
  const query1 = page.getByRole("region", { name: "Query 1", exact: true });
  const query2 = page.getByRole("region", { name: "Query 2", exact: true });
  const query3 = page.getByRole("region", { name: "Query 3", exact: true });
  await query1.locator(".operator").first().waitFor();
  await query2.scrollIntoViewIfNeeded();
  await query2.locator(".operator").first().waitFor();
  await query2
    .locator(".operator strong")
    .filter({ hasText: /^Index Scan$/ })
    .click();
  await query2
    .locator("aside h2")
    .filter({ hasText: /^Index Scan$/ })
    .waitFor();
  if ((await query1.locator("aside h2").innerText()) !== "Seq Scan")
    throw Error("Selecting query 2 changed query 1 details");
  if (
    !(await query3
      .getByRole("alert")
      .innerText()
      .then((s) => s.includes("missing_column")))
  )
    throw Error("Per-query error missing");
  await query2.locator(".query-sql summary").click();
  if (
    !(await query2
      .locator(".query-sql pre")
      .innerText()
      .then((sql) => sql.includes("JOIN customers")))
  )
    throw Error("Full query SQL preview missing");
  await query2.locator(".query-sql summary").click();
  await page.getByRole("button", { name: "Export batch" }).click();
  await page.getByRole("combobox", { name: "Plan view" }).selectOption("cards");
  await query1.locator(".operator:not(.compact)").first().waitFor();
  await query2.locator(".operator:not(.compact)").first().waitFor();
  await page
    .getByRole("combobox", { name: "Plan view" })
    .selectOption("compact");
  await query1.locator(".operator.compact").first().waitFor();
  await query2.locator(".operator.compact").first().waitFor();
  await page.waitForFunction(
    () => window.__state.batch?.id === "browser-batch",
  );
  await page
    .locator(".batch-list")
    .evaluate((element) => (element.scrollTop = 0));
  await page.waitForTimeout(250);
  const ids = await page
    .locator("marker")
    .evaluateAll((markers) => markers.map((m) => m.id));
  if (new Set(ids).size !== ids.length)
    throw Error("Batch flow instances have duplicate marker IDs");
  await page.screenshot({ path: "media/batch-plans.png" });
  console.log(
    "Batch query sections, independent selection, errors, cancel/export messages, view switching and saved state verified.",
  );
  if (errors.length) throw Error(errors.join("\n"));
  console.log("Browser render, ELK layout and operator selection verified.");
} finally {
  await browser.close();
}
