import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
const require = createRequire(import.meta.url);
export async function loadAdapter(name) {
  const outfile = resolve(`work/browser-${name}-adapter.cjs`);
  await build({
    entryPoints: [
      `packages/adapter-${name}/src/${name === "postgres" ? "postgres" : name === "oracle" ? "oracle" : "sqlServer"}Adapter.ts`,
    ],
    outfile,
    bundle: true,
    platform: "node",
    format: "cjs",
  });
  return require(outfile);
}
export async function openPreview({ name, state, viewport }) {
  mkdirSync("work", { recursive: true });
  const path = resolve(`work/${name}-preview.html`);
  const serialized = JSON.stringify(state).replaceAll("<", "\\u003c");
  writeFileSync(
    path,
    `<html><head><link rel="stylesheet" href="../dist/webview.css"></head><body><div id="root"></div><script>window.__messages=[];window.__state=${serialized};window.acquireVsCodeApi=()=>({getState:()=>window.__state,setState:s=>window.__state=s,postMessage:m=>window.__messages.push(m)})</script><script src="../dist/webview.js"></script></body></html>`,
  );
  const browser = await chromium.launch({
    executablePath: process.env.DBTUNA_BROWSER,
    headless: true,
  });
  try {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(pathToFileURL(path).href);
    return { browser, page, errors };
  } catch (error) {
    await browser.close();
    throw error;
  }
}
// Verification is read-only for tracked screenshots. Updating them is explicit.
export async function screenshot(page, options) {
  if (process.env.DBTUNA_UPDATE_SCREENSHOTS !== "1") return;
  mkdirSync(dirname(options.path), { recursive: true });
  await page.screenshot(options);
}
