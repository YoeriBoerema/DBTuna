import { build } from "esbuild";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
await build({
  entryPoints: ["packages/adapter-sqlserver/src/sqlServerAdapter.ts"],
  outfile: "work/ai-adapter.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
});
const require = createRequire(import.meta.url);
const { SqlServerAdapter } = require("../work/ai-adapter.cjs");
const plans = new SqlServerAdapter().parseStatements(
  readFileSync("fixtures/sqlserver/multi-statement.sqlplan", "utf8"),
);
const batch = {
  kind: "dbtuna-batch",
  schemaVersion: "1.0",
  id: "ai-ui",
  items: plans.map((plan, index) => ({
    index: index + 1,
    sql: plan.query,
    status: "complete",
    plan,
  })),
};
writeFileSync(
  "work/ai-preview.html",
  `<html><head><link rel="stylesheet" href="../dist/webview.css"></head><body><div id="root"></div><script>window.__messages=[];window.__state={batch:${JSON.stringify(batch)}};window.acquireVsCodeApi=()=>({getState:()=>window.__state,setState:s=>window.__state=s,postMessage:m=>window.__messages.push(m)})</script><script src="../dist/webview.js"></script></body></html>`,
);
const browser = await chromium.launch({
  executablePath: process.env.DBTUNA_BROWSER,
  headless: true,
});
try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(resolve("work/ai-preview.html")).href);
  const first = page.getByRole("region", { name: "Query 1", exact: true });
  const second = page.getByRole("region", { name: "Query 2", exact: true });
  await first.locator(".operator").first().waitFor();
  if (
    !(await first
      .locator("aside")
      .evaluate((aside) =>
        aside.lastElementChild?.classList.contains("ai-assistance"),
      ))
  )
    throw Error("AI panel is not at the bottom of operator details");
  if (
    await page.evaluate(() =>
      window.__messages.some((m) => m.type === "AI_ANALYZE"),
    )
  )
    throw Error("AI analysis sent automatically");
  await first
    .getByLabel("Additional context (optional)")
    .fill("Focus on missing indexes");
  await first
    .getByRole("button", { name: "Get AI advice", exact: true })
    .click();
  const request = await page.evaluate(() =>
    window.__messages.find((m) => m.type === "AI_ANALYZE"),
  );
  if (
    request.planId !== plans[0].id ||
    request.context !== "Focus on missing indexes"
  )
    throw Error("Incorrect selected plan/context");
  const response = {
    type: "AI_RESULT",
    requestId: request.requestId,
    planId: request.planId,
    nodeId: request.nodeId,
    model: "test-model",
    text: "Score: 75/100 (AI estimate). Some opportunities remain.\n\nSuggestions\n- Check existing indexes. <img src=x onerror=alert(1)>\n\nUpdated query (proposed)\nSELECT 1;",
  };
  await page.evaluate(
    (m) => window.postMessage({ ...m, requestId: "stale" }, "*"),
    response,
  );
  if (await first.locator(".ai-output").count())
    throw Error("Stale result displayed");
  await page.evaluate((m) => window.postMessage(m, "*"), response);
  await first.locator(".ai-output").waitFor();
  if (
    !(await first.locator(".ai-output").innerText()).startsWith("Score: 75/100")
  )
    throw Error("Score is not the first response paragraph");
  if (
    !(await first.locator(".ai-output").innerText()).includes(
      "Updated query (proposed)",
    )
  )
    throw Error("Updated query missing");
  if (await first.locator(".ai-output img").count())
    throw Error("AI HTML was interpreted");
  if (await second.locator(".ai-output").count())
    throw Error("Advice leaked across query sections");
  await first
    .getByRole("button", { name: "Get AI advice", exact: true })
    .click();
  const pending = await page.evaluate(() =>
    window.__messages.filter((m) => m.type === "AI_ANALYZE").at(-1),
  );
  await first.getByRole("button", { name: "Cancel", exact: true }).click();
  if (
    !(await page.evaluate(
      (id) =>
        window.__messages.some(
          (m) => m.type === "AI_CANCEL" && m.requestId === id,
        ),
      pending.requestId,
    ))
  )
    throw Error("Cancel not dispatched");
  await page.evaluate(
    (m) =>
      window.postMessage(
        {
          ...m,
          requestId: m.requestId,
          text: undefined,
          error: "API key was rejected.",
        },
        "*",
      ),
    { ...response, requestId: pending.requestId },
  );
  await first
    .getByRole("alert")
    .getByText("API key was rejected.", { exact: true })
    .waitFor();
  await first.getByRole("button", { name: "Settings", exact: true }).click();
  if (
    !(await page.evaluate(() =>
      window.__messages.some((m) => m.type === "AI_SETTINGS"),
    ))
  )
    throw Error("Settings action missing");
  await first
    .getByRole("button", { name: "Get AI advice", exact: true })
    .click();
  const switching = await page.evaluate(() =>
    window.__messages.filter((m) => m.type === "AI_ANALYZE").at(-1),
  );
  await first
    .locator(".operator")
    .filter({ has: page.locator("strong", { hasText: "Index Seek" }) })
    .click();
  if (
    !(await page.evaluate(
      (id) =>
        window.__messages.some(
          (m) => m.type === "AI_CANCEL" && m.requestId === id,
        ),
      switching.requestId,
    ))
  )
    throw Error("Changing operators did not cancel");
  if (
    JSON.stringify(await page.evaluate(() => window.__state)).includes(
      "Some opportunities remain",
    )
  )
    throw Error("Advice persisted into saved plan state");
  await page.screenshot({ path: "media/ai-assistance.png" });
  if (errors.length) throw Error(errors.join("\n"));
  console.log(
    "AI UI: explicit requests, operator/context scope, plain-text rendering, stale replies, independent query results, cancellation, settings and ephemeral advice verified.",
  );
} finally {
  await browser.close();
}
