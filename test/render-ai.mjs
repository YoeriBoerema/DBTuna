import { readFileSync } from "node:fs";
import {
  loadAdapter,
  openPreview,
  screenshot,
} from "./helpers/browserHarness.mjs";
const { SqlServerAdapter } = await loadAdapter("sqlserver");
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
const { browser, page, errors } = await openPreview({
  name: "render-ai",
  state: { batch },
  viewport: { width: 1600, height: 1000 },
});
try {
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
    status: "complete",
    model: "test-model",
    advice: {
      score: 75,
      scoreReason: "Some opportunities remain.",
      suggestions: ["Check existing indexes. <img src=x onerror=alert(1)>"],
      updatedQuery: "SELECT 1;",
    },
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
          status: "error",
          advice: undefined,
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
  await screenshot(page, { path: "media/ai-assistance.png" });
  if (errors.length) throw Error(errors.join("\n"));
  console.log(
    "AI UI: explicit requests, operator/context scope, plain-text rendering, stale replies, independent query results, cancellation, settings and ephemeral advice verified.",
  );
} finally {
  await browser.close();
}
