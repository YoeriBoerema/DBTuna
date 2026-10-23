import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadAdapter, openPreview } from "./helpers/browserHarness.mjs";
const { OracleAdapter } = await loadAdapter("oracle");
const native = JSON.parse(
  readFileSync("fixtures/oracle/sort-native.json", "utf8"),
);
const adapter = new OracleAdapter();
const estimated = adapter.parse(native);
estimated.id = "oracle-estimated";
estimated.application.executionAvailable = true;
const insert = adapter.parse({
  ...native,
  query: "INSERT INTO customers SELECT * FROM source_customers",
});
insert.id = "oracle-insert";
insert.application.executionAvailable = true;
const actual = adapter.parse({
  ...native,
  planKind: "actual",
  rows: native.rows.map((row) => ({
    ...row,
    LAST_STARTS: 1,
    LAST_OUTPUT_ROWS: 200000,
    LAST_ELAPSED_TIME: 1000000,
    ...(row.ID === 1
      ? { LAST_TEMPSEG_SIZE: 1000000, LAST_EXECUTION: "ONE PASS" }
      : {}),
  })),
});
actual.id = "oracle-actual";
const batch = {
  kind: "dbtuna-batch",
  schemaVersion: "1.0",
  id: "oracle-browser",
  items: [estimated, insert].map((plan, i) => ({
    index: i + 1,
    status: "complete",
    sql: plan.query,
    plan,
  })),
};
const { browser, page, errors } = await openPreview({
  name: "oracle",
  state: { batch },
  viewport: { width: 1600, height: 1100 },
});
try {
  const first = page.getByRole("region", { name: "Query 1", exact: true });
  const second = page.getByRole("region", { name: "Query 2", exact: true });
  await first.locator(".operator").first().waitFor();
  await second.scrollIntoViewIfNeeded();
  await second.locator(".operator").first().waitFor();
  await first.scrollIntoViewIfNeeded();
  await page.evaluate(
    (batch) =>
      window.postMessage({ type: "BATCH_LOADED", payload: batch }, "*"),
    batch,
  );
  const run = first.getByRole("button", {
    name: "Run query and collect actual plan",
    exact: true,
  });
  await run.click();
  assert.equal(
    await page.evaluate(
      () => window.__messages.filter((m) => m.type === "RUN_ACTUAL").length,
    ),
    0,
  );
  await first
    .getByRole("button", { name: "Are you sure?", exact: true })
    .click();
  const request = await page.evaluate(() =>
    window.__messages.find((m) => m.type === "RUN_ACTUAL"),
  );
  assert.ok(request);
  await page.evaluate(
    ({ request, actual }) =>
      window.postMessage(
        {
          type: "EXECUTION_RESULT",
          planId: request.planId,
          requestId: request.requestId,
          status: "complete",
          actualPlan: actual,
          elapsedMs: 1200,
        },
        "*",
      ),
    { request, actual },
  );
  await first.getByRole("tab", { name: "Actual", exact: true }).click();
  await first
    .getByRole("combobox", { name: "Select operator" })
    .selectOption("1");
  const panel = first.getByRole("region", {
    name: "Local plan analysis",
    exact: true,
  });
  await panel
    .getByText("Disk-backed sort or hash work reported", { exact: true })
    .waitFor();
  await panel
    .getByRole("button", {
      name: "Disk-backed sort or hash work reported: highlight operator 1",
      exact: true,
    })
    .click();
  assert.equal(
    await first.getByRole("combobox", { name: "Select operator" }).inputValue(),
    "1",
  );
  await first.getByRole("tab", { name: "Estimated", exact: true }).click();
  await first.locator(".operator").first().waitFor();
  await first
    .getByRole("combobox", { name: "Select operator" })
    .selectOption("2");
  await panel
    .getByText("Potential index-access issue in predicate expression", {
      exact: true,
    })
    .waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "Oracle: independent sections, confirmed execution, actual/estimated tabs, local findings and operator navigation passed.",
  );
} finally {
  await browser.close();
}
