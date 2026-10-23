import {
  loadAdapter,
  openPreview,
  screenshot,
} from "./helpers/browserHarness.mjs";
const { PostgresAdapter } = await loadAdapter("postgres");
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
estimated.application.executionAvailable = true;
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
insert.application.executionAvailable = true;
const offline = {
  ...estimated,
  id: "offline",
  application: { executionAvailable: false },
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
actual.application.planKind = "actual";
const { browser, page, errors } = await openPreview({
  name: "render-execution",
  state: { batch },
  viewport: { width: 1600, height: 1050 },
});
try {
  const first = page.getByRole("region", { name: "Query 1", exact: true }),
    second = page.getByRole("region", { name: "Query 2", exact: true }),
    third = page.getByRole("region", { name: "Query 3", exact: true });
  await first.locator(".operator").first().waitFor();
  const expectBadge = async (section, label) => {
    await section
      .locator(".query-heading .query-status")
      .getByText(label, { exact: true })
      .waitFor();
  };
  await expectBadge(first, "Predicted");
  if (
    !(await first
      .getByRole("button", {
        name: "Run query and collect actual plan",
        exact: true,
      })
      .isDisabled())
  )
    throw Error(
      "Restored snapshot enabled execution before a live host update",
    );
  await page.evaluate(
    (batch) =>
      window.postMessage({ type: "BATCH_LOADED", payload: batch }, "*"),
    batch,
  );

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
  if (
    await page.evaluate(() =>
      window.__messages.some((m) => m.type === "RUN_ACTUAL"),
    )
  )
    throw Error("First click executed SQL before inline confirmation");
  await first
    .getByRole("button", { name: "Are you sure?", exact: true })
    .click();
  const request = await page.evaluate(() =>
    window.__messages.find((message) => message.type === "RUN_ACTUAL"),
  );
  await expectBadge(first, "Predicted");
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
  await expectBadge(first, "Predicted");
  await page.evaluate(
    (m) =>
      window.postMessage(
        { ...m, status: "running", actualPlan: undefined },
        "*",
      ),
    message,
  );
  await first.getByText(/Executing:/).waitFor();
  await expectBadge(first, "Predicted");
  await page.evaluate((m) => window.postMessage(m, "*"), message);
  await first
    .locator(".operator")
    .getByText("Actual rows: 10", { exact: true })
    .waitFor();
  await expectBadge(first, "Verified");
  await expectBadge(second, "Predicted");
  if (
    (await first
      .getByRole("tab", { name: "Actual", exact: true })
      .getAttribute("aria-selected")) !== "true"
  )
    throw Error("Actual tab not selected");
  await first.getByRole("tab", { name: "Estimated", exact: true }).click();
  await expectBadge(first, "Verified");
  await first
    .locator(".operator")
    .getByText("Est. rows: 100", { exact: true })
    .waitFor();
  await first.getByRole("tab", { name: "Actual", exact: true }).click();
  await first
    .locator(".operator")
    .getByText("Actual rows: 10", { exact: true })
    .waitFor();
  if (
    await first
      .getByRole("button", { name: "Export actual plan", exact: true })
      .count()
  )
    throw Error("Removed actual export control is still visible");
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
  await first
    .getByRole("button", { name: "Are you sure?", exact: true })
    .click();
  const repeat = await page.evaluate(() =>
    window.__messages.filter((m) => m.type === "RUN_ACTUAL").at(-1),
  );
  await first
    .getByRole("button", { name: "Cancel execution", exact: true })
    .click();
  if (
    await page.evaluate(
      (id) =>
        window.__messages.some(
          (m) => m.type === "CANCEL_ACTUAL" && m.requestId === id,
        ),
      repeat.requestId,
    )
  )
    throw Error("First cancellation click sent a cancellation request");
  await first
    .getByRole("button", { name: "Are you sure?", exact: true })
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
  await expectBadge(first, "Verified");
  await second
    .getByRole("button", {
      name: "Run query and collect actual plan",
      exact: true,
    })
    .click();
  const beforeInsert = await page.evaluate(
    () => window.__messages.filter((m) => m.type === "RUN_ACTUAL").length,
  );
  if (beforeInsert !== 2) throw Error("First INSERT click executed SQL");
  await second
    .getByRole("button", { name: "Are you sure?", exact: true })
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
  await expectBadge(second, "Predicted");
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
  await screenshot(page, { path: "media/actual-plan.png" });
  if (errors.length) throw Error(errors.join("\n"));
  const freshBatch = {
    ...batch,
    id: "fresh-explain",
    items: batch.items.map((item) => ({
      ...item,
      plan: { ...item.plan, id: item.plan.id + ":fresh" },
    })),
  };
  await page.evaluate(
    (payload) => window.postMessage({ type: "BATCH_LOADED", payload }, "*"),
    freshBatch,
  );
  await expectBadge(first, "Predicted");
  console.log(
    "Actual-plan UI: explicit per-query execution, estimated/actual toggle, measured rows, elapsed state, cancellation, errors and offline guard verified.",
  );
} finally {
  await browser.close();
}
