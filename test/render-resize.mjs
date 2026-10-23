import { loadAdapter, openPreview } from "./helpers/browserHarness.mjs";
const { PostgresAdapter } = await loadAdapter("postgres");
const plan = new PostgresAdapter().parse([
  { Plan: { "Node Type": "Seq Scan", "Plan Rows": 100, "Total Cost": 10 } },
]);
const batch = {
  kind: "dbtuna-batch",
  schemaVersion: "1.0",
  id: "resize",
  items: [1, 2].map((index) => ({
    index,
    sql: "SELECT 1",
    status: "complete",
    plan: { ...plan, id: "resize-" + index },
  })),
};
for (const state of [{ batch }, { plan }]) {
  const { browser, page, errors } = await openPreview({
    name: "resize-" + (state.batch ? "batch" : "single"),
    state,
    viewport: { width: 1500, height: 1100 },
  });
  try {
    await page.locator(".operator").first().waitFor();
    const box = page
      .locator(state.batch ? ".lazy-plan" : ".single-plan > .executable-plan")
      .first();
    const before = await box.boundingBox();
    const secondHeight = state.batch
      ? await page
          .locator(".lazy-plan")
          .nth(1)
          .evaluate((el) => el.clientHeight)
      : undefined;
    // Shrink first, keeping the native resize handle inside the visible viewport.
    await page.mouse.move(
      before.x + before.width - 4,
      before.y + before.height - 4,
    );
    await page.mouse.down();
    await page.mouse.move(
      before.x + before.width - 4,
      before.y + before.height - 124,
      { steps: 12 },
    );
    await page.mouse.up();
    const after = await box.boundingBox();
    if (
      before.height - after.height < 100 ||
      Math.abs(before.width - after.width) > 1
    )
      throw Error("Vertical drag did not resize height independently of width");
    if (
      state.batch &&
      secondHeight !==
        (await page
          .locator(".lazy-plan")
          .nth(1)
          .evaluate((el) => el.clientHeight))
    )
      throw Error("Resizing changed another query's height");
    const footer = await box.locator("footer").boundingBox();
    if (footer.y + footer.height > after.y + after.height + 1)
      throw Error("Resize clipped the navigation footer");
    if (errors.length) throw Error(errors.join("\n"));
  } finally {
    await browser.close();
  }
}
console.log(
  "Vertical resizing: single and batch plans resize independently without width changes or clipped footers.",
);
