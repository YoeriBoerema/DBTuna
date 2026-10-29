import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const output = resolve("work/selection-regression");
mkdirSync(output, { recursive: true });
// Delay completion only in this test bundle to make the layout/selection race
// deterministic without timing hooks in production code.
await build({
  entryPoints: ["webview/src/App.tsx"],
  outfile: output + "/ui.js",
  bundle: true,
  platform: "browser",
  format: "iife",
  plugins: [
    {
      name: "delay-layout",
      setup(builder) {
        builder.onLoad({ filter: /usePlanLayout\.ts$/ }, (args) => ({
          contents: readFileSync(args.path, "utf8").replace(
            ".then((layout) => {",
            ".then(async (layout) => { if(window.__delayLayout) await new Promise(resolve => setTimeout(resolve, 500));",
          ),
          loader: "ts",
        }));
      },
    },
  ],
});
await build({
  entryPoints: ["packages/adapter-postgres/src/postgresAdapter.ts"],
  outfile: output + "/adapter.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
});
const { PostgresAdapter } = createRequire(import.meta.url)(
  output + "/adapter.cjs",
);
const plan = new PostgresAdapter().parse([
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
        },
      ],
    },
  },
]);
writeFileSync(
  output + "/index.html",
  `<html><head><link rel="stylesheet" href="ui.css"></head><body><div id="root"></div><script>window.acquireVsCodeApi=()=>({getState:()=>(${JSON.stringify({ plan })}),setState(){},postMessage(){}})</script><script src="ui.js"></script></body></html>`,
);
const browser = await chromium.launch({
  executablePath: process.env.DBTUNA_BROWSER,
  headless: true,
});
try {
  const page = await browser.newPage({
    viewport: { width: 1500, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(pathToFileURL(output + "/index.html").href);
  await page.locator(".operator").first().waitFor();
  const target = plan.nodes[1].id;
  const selected = page.getByRole("combobox", { name: "Select operator" });
  const expectSelection = async (id) => {
    await page.waitForFunction(
      ({ id, count }) => {
        const highlighted = [
          ...document.querySelectorAll(".react-flow__node.selected"),
        ];
        return (
          document.querySelector('select[aria-label="Select operator"]')
            .value === id &&
          highlighted.length === 1 &&
          highlighted[0].getAttribute("data-id") === id &&
          document
            .querySelector(".rule-analysis")
            .textContent.includes(`Selected operator: ${count} findings.`)
        );
      },
      { id, count: id === target ? 2 : 0 },
    );
  };
  await page.evaluate(() => (window.__delayLayout = true));
  await page.getByRole("button", { name: "Auto layout", exact: true }).click();
  await selected.selectOption(target);
  await expectSelection(target);
  await page
    .getByText("Laying out plan…", { exact: true })
    .waitFor({ state: "hidden" });
  await expectSelection(target);
  await page.evaluate(() => (window.__delayLayout = false));
  for (let i = 0; i < 20; i++) {
    const id = i % 2 === 0 ? plan.rootNodeIds[0] : target;
    await page
      .locator(`.react-flow__node[data-id="${id}"] .operator`)
      .dispatchEvent("click");
    await expectSelection(id);
  }
  await selected.selectOption(target);
  await page.waitForTimeout(350);
  const box = await page
    .locator(`.react-flow__node[data-id="${plan.rootNodeIds[0]}"] .operator`)
    .boundingBox();
  assert.ok(box);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 5, box.y + box.height / 2 + 5, {
    steps: 2,
  });
  await page.mouse.up();
  await expectSelection(plan.rootNodeIds[0]);
  assert.deepEqual(errors, []);
  console.log(
    "Selection: delayed layout preserves latest operator; rapid clicks and slight drags keep graph, details and local findings synchronized.",
  );
} finally {
  await browser.close();
}
