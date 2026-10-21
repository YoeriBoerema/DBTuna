import { build } from "esbuild";
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
await build({
  entryPoints: ["packages/adapter-postgres/src/postgresAdapter.ts"],
  outfile: "work/runtime-adapter.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
});
const require = createRequire(import.meta.url);
const { PostgresAdapter } = require("../work/runtime-adapter.cjs");
const adapter = new PostgresAdapter();
const estimated = adapter.parse([
  {
    Plan: {
      "Node Type": "Seq Scan",
      "Relation Name": "customers",
      "Plan Rows": 100,
      "Total Cost": 3,
    },
  },
]);
estimated.id = "runtime-select";
estimated.query = "SELECT * FROM customers;";
estimated.metadata.executionAvailable = true;
const insert = adapter.parse([
  {
    Plan: {
      "Node Type": "ModifyTable",
      Operation: "Insert",
      "Total Cost": 1,
      "Plan Rows": 0,
    },
  },
]);
insert.id = "runtime-insert";
insert.query = "INSERT INTO customers VALUES (1);";
insert.metadata.executionAvailable = true;
const offline = {
  ...estimated,
  id: "offline",
  metadata: { executionAvailable: false },
};
const batch = {
  kind: "dbtuna-batch",
  schemaVersion: "1.0",
  id: "runtime-ui",
  items: [estimated, insert, offline].map((plan, index) => ({
    index: index + 1,
    sql: plan.query,
    status: "complete",
    plan,
  })),
};
const actual = adapter.parse([
  {
    Plan: {
      "Node Type": "Seq Scan",
      "Relation Name": "customers",
      "Plan Rows": 100,
      "Total Cost": 3,
      "Actual Rows": 10,
      "Actual Loops": 1,
      "Actual Total Time": 0.3,
    },
  },
]);
actual.id = "runtime-select:actual";
actual.query = estimated.query;
actual.metadata.planKind = "actual";
writeFileSync(
  "work/runtime-preview.html",
  `<html><head><link rel="stylesheet" href="../dist/webview.css"></head><body><div id="root"></div><script>window.__messages=[];window.__state={batch:${JSON.stringify(batch)}};window.acquireVsCodeApi=()=>({getState:()=>window.__state,setState:s=>window.__state=s,postMessage:m=>window.__messages.push(m)})</script><script src="../dist/webview.js"></script></body></html>`,
);
const browser = await chromium.launch({
  executablePath: process.env.DBTUNA_BROWSER,
  headless: true,
});
try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1050 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(pathToFileURL(resolve("work/runtime-preview.html")).href);
  const first = page.getByRole("region", { name: "Query 1", exact: true }),
    second = page.getByRole("region", { name: "Query 2", exact: true }),
    third = page.getByRole("region", { name: "Query 3", exact: true });
  await first.locator(".operator").first().waitFor();
  if (
    await page.evaluate(() =>
      window.__messages.some((message) => message.type === "RUN_ACTUAL"),
    )
  )
    throw Error("Query ran automatically");
  await first
    .getByRole("button", {
      name: "Run query and collect actual plan",
      exact: true,
    })
    .click();
  const request = await page.evaluate(() =>
    window.__messages.find((message) => message.type === "RUN_ACTUAL"),
  );
  if (request.planId !== estimated.id || Object.keys(request).length !== 3)
    throw Error("Execution request included wrong plan or extra SQL");
  const message = {
    type: "EXECUTION_RESULT",
    requestId: request.requestId,
    planId: request.planId,
    status: "complete",
    actualPlan: actual,
    elapsedMs: 300,
  };
  await page.evaluate(
    (m) => window.postMessage({ ...m, requestId: "stale" }, "*"),
    message,
  );
  if (
    !(await first
      .getByRole("tab", { name: "Actual", exact: true })
      .isDisabled())
  )
    throw Error("Stale actual response accepted");
  await page.evaluate(
    (m) =>
      window.postMessage(
        { ...m, status: "running", actualPlan: undefined },
        "*",
      ),
    message,
  );
  await first.getByText(/Executing:/).waitFor();
  await page.evaluate((m) => window.postMessage(m, "*"), message);
  await first
    .locator(".operator")
    .getByText("Actual rows: 10", { exact: true })
    .waitFor();
  if (
    (await first
      .getByRole("tab", { name: "Actual", exact: true })
      .getAttribute("aria-selected")) !== "true"
  )
    throw Error("Actual tab not selected");
  await first.getByRole("tab", { name: "Estimated", exact: true }).click();
  await first
    .locator(".operator")
    .getByText("Est. rows: 100", { exact: true })
    .waitFor();
  await first.getByRole("tab", { name: "Actual", exact: true }).click();
  await first
    .locator(".operator")
    .getByText("Actual rows: 10", { exact: true })
    .waitFor();
  await first
    .getByRole("button", { name: "Export actual plan", exact: true })
    .click();
  if (
    !(await page.evaluate(() =>
      window.__messages.some(
        (m) => m.type === "EXPORT_ACTUAL" && m.planId === "runtime-select",
      ),
    ))
  )
    throw Error("Actual export not routed");
  if (
    !(await second
      .getByRole("tab", { name: "Actual", exact: true })
      .isDisabled())
  )
    throw Error("Actual result leaked into another query");
  await first
    .getByRole("button", {
      name: "Run again and collect actual plan",
      exact: true,
    })
    .click();
  const repeat = await page.evaluate(() =>
    window.__messages.filter((m) => m.type === "RUN_ACTUAL").at(-1),
  );
  await first
    .getByRole("button", { name: "Cancel execution", exact: true })
    .click();
  if (
    !(await page.evaluate(
      (id) =>
        window.__messages.some(
          (m) => m.type === "CANCEL_ACTUAL" && m.requestId === id,
        ),
      repeat.requestId,
    ))
  )
    throw Error("Cancellation was not routed");
  await page.evaluate((m) => window.postMessage(m, "*"), {
    ...message,
    requestId: repeat.requestId,
    status: "cancelled",
    actualPlan: undefined,
    error: "Cancelled. Data may already have changed.",
  });
  await first.getByRole("alert").waitFor();
  await second
    .getByRole("button", {
      name: "Run query and collect actual plan",
      exact: true,
    })
    .click();
  const insertRequest = await page.evaluate(() =>
    window.__messages.filter((m) => m.type === "RUN_ACTUAL").at(-1),
  );
  if (insertRequest.planId !== insert.id)
    throw Error("INSERT requested another query");
  await page.evaluate((m) => window.postMessage(m, "*"), {
    ...message,
    planId: insert.id,
    requestId: insertRequest.requestId,
    status: "error",
    actualPlan: undefined,
    error: "Execution failed. Data may already have changed.",
  });
  await second.getByRole("alert").waitFor();
  await second
    .locator(".operator strong")
    .getByText("Insert", { exact: true })
    .waitFor();
  await third.scrollIntoViewIfNeeded();
  await third.locator(".operator").first().waitFor();
  if (
    !(await third
      .getByRole("button", {
        name: "Run query and collect actual plan",
        exact: true,
      })
      .isDisabled())
  )
    throw Error("Offline plan enabled execution");
  await first.getByRole("tab", { name: "Actual", exact: true }).click();
  await first.scrollIntoViewIfNeeded();
  if (
    !(await first.evaluate(
      (section) =>
        section.querySelector("footer").getBoundingClientRect().bottom <=
        section.getBoundingClientRect().bottom + 1,
    ))
  )
    throw Error("Runtime toolbar clipped the plan footer");
  await page.screenshot({ path: "media/actual-plan.png" });
  if (errors.length) throw Error(errors.join("\n"));
  console.log(
    "Actual-plan UI: explicit per-query execution, estimated/actual toggle, measured rows, elapsed state, cancellation, errors, export and offline guard verified.",
  );
} finally {
  await browser.close();
}
