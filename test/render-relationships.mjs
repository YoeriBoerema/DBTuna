import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
mkdirSync("work", { recursive: true });
const path = resolve("work/relationships-preview.html");
writeFileSync(
  path,
  `<html style="--vscode-editor-background:#181c25;--vscode-editor-foreground:#dee6f4;--vscode-editorWidget-background:#252c39;--vscode-textLink-foreground:#7db3ff;--vscode-panel-border:#3a4457"><head><link rel="stylesheet" href="../dist/relationships.css"></head><body><div id="root"></div><script>window.acquireVsCodeApi=()=>({postMessage:m=>window.ready=true})</script><script src="../dist/relationships.js"></script></body></html>`,
);
const browser = await chromium.launch({
  executablePath: process.env.DBTUNA_BROWSER,
  headless: true,
});
try {
  const page = await browser.newPage({
    viewport: { width: 1400, height: 900 },
  });
  const errors = [];
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.error(e.message);
  });
  await page.goto(pathToFileURL(path).href);
  await page.waitForFunction(() => window.ready);
  const tables = [
    {
      id: "orders",
      schema: "sales",
      name: "Orders",
      columns: ["CustomerID", "TenantID", "ShippingAddressID"],
      external: false,
    },
    {
      id: "customers",
      schema: "sales",
      name: "Customers",
      columns: ["CustomerID", "TenantID", "ParentCustomerID"],
      external: false,
    },
    {
      id: "address",
      schema: "people",
      name: "Addresses",
      columns: ["AddressID"],
      external: true,
    },
    {
      id: "audit",
      schema: "sales",
      name: "AuditLog <script> with_a_very_long_wrapped_identifier_that_requires_multiple_lines_in_the_card_header",
      columns: [],
      external: false,
    },
  ];
  const relationships = [
    {
      id: "customer",
      name: "FK_Orders_Customers",
      source: "orders",
      target: "customers",
      columns: ["CustomerID → CustomerID"],
      columnPairs: [
        { source: "CustomerID", target: "CustomerID" },
        { source: "TenantID", target: "TenantID" },
      ],
    },
    {
      id: "address",
      name: "FK_Orders_Addresses",
      source: "orders",
      target: "address",
      columns: ["ShippingAddressID → AddressID"],
      columnPairs: [{ source: "ShippingAddressID", target: "AddressID" }],
    },
    {
      id: "parent",
      name: "FK_Customers_Parent",
      source: "customers",
      target: "customers",
      columns: ["ParentCustomerID → CustomerID"],
      columnPairs: [{ source: "ParentCustomerID", target: "CustomerID" }],
    },
    {
      id: "address-customer",
      name: "FK_Addresses_Customers",
      source: "address",
      target: "customers",
      columns: ["AddressID → CustomerID"],
      columnPairs: [{ source: "AddressID", target: "CustomerID" }],
    },
  ];
  await page.evaluate(
    (graph) => window.postMessage({ type: "GRAPH", graph }, "*"),
    { schema: "sales", tables, relationships },
  );
  await page.locator(".react-flow__node-table").nth(3).waitFor();
  await page.locator(".react-flow__edge").nth(4).waitFor();
  assert.equal(await page.locator(".react-flow__node-table").count(), 4);
  assert.equal(await page.locator(".schema-group").count(), 2);
  const schemaGap = await page.evaluate(() => {
    const [a, b] = [...document.querySelectorAll(".schema-group")].map((node) =>
      node.getBoundingClientRect(),
    );
    const scale =
      document.querySelector(".table").getBoundingClientRect().width / 260;
    return (
      Math.max(
        a.left - b.right,
        b.left - a.right,
        a.top - b.bottom,
        b.top - a.bottom,
      ) / scale
    );
  });
  assert.ok(
    schemaGap >= 600,
    `Rendered schema gap is only ${schemaGap} diagram pixels`,
  );
  const noOverlaps = await page
    .locator(".react-flow__node-table")
    .evaluateAll((nodes) => {
      const boxes = nodes.map((node) => node.getBoundingClientRect());
      return boxes.every((a, i) =>
        boxes.every(
          (b, j) =>
            i === j ||
            a.right <= b.left ||
            b.right <= a.left ||
            a.bottom <= b.top ||
            b.bottom <= a.top,
        ),
      );
    });
  assert.equal(
    noOverlaps,
    true,
    "Measured table boxes, including wrapped headers, must not overlap",
  );
  assert.equal(await page.locator(".react-flow__edge").count(), 5);
  const colors = await page
    .locator(".react-flow__edge-path")
    .evaluateAll((paths) => paths.map((path) => getComputedStyle(path).stroke));
  assert.equal(
    colors[0],
    colors[1],
    "Composite key lines share their schema color",
  );
  assert.equal(
    colors[0],
    colors[2],
    "Cross-schema lines retain their source schema color",
  );
  assert.notEqual(
    colors[0],
    colors[4],
    "Different source schemas have distinct line colors",
  );
  const patterns = await page
    .locator(".react-flow__edge-path")
    .evaluateAll((paths) =>
      paths.map((path) => getComputedStyle(path).strokeDasharray),
    );
  assert.equal(patterns[0], patterns[1]);
  assert.notEqual(
    patterns[0],
    patterns[4],
    "Schemas must also be distinguishable by line pattern",
  );
  const legendPatterns = await page
    .locator(".schema-label")
    .evaluateAll((labels) =>
      Object.fromEntries(
        labels.map((label) => [
          label.textContent,
          getComputedStyle(label.querySelector("line")).strokeDasharray,
        ]),
      ),
    );
  assert.equal(legendPatterns.sales, patterns[0]);
  assert.equal(legendPatterns.people, patterns[4]);
  const markerColorsMatch = await page
    .locator(".react-flow__edge-path")
    .evaluateAll((paths) =>
      paths.every((path) => {
        const markerId = path.getAttribute("marker-end").slice(6, -2);
        const marker = document
          .getElementById(markerId)
          ?.querySelector("polyline");
        return (
          marker &&
          getComputedStyle(marker).fill === getComputedStyle(path).stroke
        );
      }),
    );
  assert.ok(markerColorsMatch, "Arrowheads must match line colors");
  const anchored = await page.evaluate(() => {
    return ["CustomerID", "TenantID"].map((column, index) => {
      const path = document.querySelectorAll(".react-flow__edge-path")[index];
      const transform = path.getScreenCTM();
      const start = path.getPointAtLength(0).matrixTransform(transform);
      const end = path
        .getPointAtLength(path.getTotalLength())
        .matrixTransform(transform);
      const source = document
        .querySelector(
          `.react-flow__node[data-id="orders"] .column-row[data-column="${column}"]`,
        )
        .getBoundingClientRect();
      const target = document
        .querySelector(
          `.react-flow__node[data-id="customers"] .column-row[data-column="${column}"]`,
        )
        .getBoundingClientRect();
      return (
        Math.abs(start.y - (source.y + source.height / 2)) < 3 &&
        Math.abs(end.y - (target.y + target.height / 2)) < 3
      );
    });
  });
  assert.deepEqual(
    anchored,
    [true, true],
    "Composite key lines must anchor to their corresponding column rows",
  );
  assert.equal(
    await page
      .locator('.column-row[data-column="TenantID"]')
      .first()
      .evaluate((row) => getComputedStyle(row).borderTopWidth),
    "1px",
  );
  assert.ok(
    await page
      .locator(".external")
      .innerText()
      .then((text) => text.includes("referenced table")),
  );
  assert.equal(await page.locator(".table script").count(), 0);
  await page.locator(".react-flow__edge").first().dispatchEvent("click");
  await page.waitForFunction(() =>
    document
      .querySelector("footer")
      .textContent.includes("CustomerID → CustomerID"),
  );
  assert.equal(
    await page.locator(".relationship-highlight").count(),
    2,
    "Both composite key segments highlight together",
  );
  assert.equal(await page.locator(".relationship-dimmed").count(), 3);
  assert.equal(
    await page
      .locator(".relationship-highlight .react-flow__edge-path")
      .first()
      .evaluate((path) => getComputedStyle(path).stroke),
    colors[0],
    "Selection preserves the source schema color",
  );
  assert.equal(
    await page
      .locator(".relationship-dimmed .react-flow__edge-path")
      .first()
      .evaluate((path) => getComputedStyle(path).opacity),
    "0.14",
  );
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".relationship-dimmed").count(), 0);
  assert.equal(await page.locator(".relationship-highlight").count(), 0);
  await page.screenshot({ path: "work/relationships-preview.png" });
  const vision = await page.context().newCDPSession(page);
  await vision.send("Emulation.setEmulatedVisionDeficiency", {
    type: "deuteranopia",
  });
  await page.screenshot({ path: "work/relationships-deuteranopia.png" });
  await vision.send("Emulation.setEmulatedVisionDeficiency", { type: "none" });
  await vision.detach();
  const contrastRatios = await page.evaluate(() => {
    const luminance = (color) => {
      const hex = color.trim().replace("#", "");
      const values = [0, 2, 4]
        .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
    };
    const ratios = (background) => {
      const style = getComputedStyle(document.body),
        bg = luminance(background);
      return Array.from({ length: 7 }, (_, index) => {
        const fg = luminance(
          style.getPropertyValue(`--schema-palette-${index}`),
        );
        return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
      });
    };
    const dark = ratios("#181c25");
    document.body.classList.add("vscode-light");
    const light = ratios("#ffffff");
    document.body.classList.remove("vscode-light");
    return { dark, light };
  });
  assert.ok(
    [...contrastRatios.dark, ...contrastRatios.light].every(
      (ratio) => ratio >= 3,
    ),
    "Schema line colors must have 3:1 contrast against the reference dark and light backgrounds",
  );
  const title = await page
    .locator('.react-flow__node-table[data-id="orders"] strong')
    .boundingBox();
  await page.mouse.move(title.x + title.width / 2, title.y + title.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    title.x + title.width / 2 + 20,
    title.y + title.height / 2 + 20,
    { steps: 8 },
  );
  await page.mouse.up();
  const tablePositions = () =>
    page.locator(".react-flow__node-table").evaluateAll((nodes) =>
      nodes.map((node) => ({
        id: node.dataset.id,
        transform: node.style.transform,
      })),
    );
  const beforeReroute = await tablePositions();
  await page.getByRole("button", { name: "Reroute lines" }).click();
  await page.waitForFunction(() =>
    document.querySelector("header p").textContent.includes("line crossings"),
  );
  assert.deepEqual(
    await tablePositions(),
    beforeReroute,
    "Rerouting must preserve manually positioned tables",
  );
  await page.getByRole("button", { name: "Auto layout" }).click();
  await page.locator(".react-flow__edge").nth(3).waitFor();
  await page.evaluate(() =>
    window.postMessage(
      {
        type: "GRAPH",
        graph: { schema: "empty", tables: [], relationships: [] },
      },
      "*",
    ),
  );
  await page.getByText("No visible tables in this database.").waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "Relationship browser checks passed: tables, composite mapping display, cross-schema and self edges, safe text, empty schema.",
  );
} finally {
  await browser.close();
}
