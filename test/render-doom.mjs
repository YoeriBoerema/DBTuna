import { build } from "esbuild";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
await build({
  entryPoints: ["src/extension/webview/doomHtml.ts"],
  outfile: "work/doom-html.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
});
const require = createRequire(import.meta.url);
const { doomHtml } = require("../work/doom-html.cjs");
let origin;
const assets = new Map([
  ["/doom.js", ["dist/doom.js", "text/javascript"]],
  ["/doom.css", ["dist/doom.css", "text/css"]],
  [
    "/doom/websockets-doom.js",
    ["dist/doom/websockets-doom.js", "text/javascript"],
  ],
  [
    "/doom/websockets-doom.wasm",
    ["dist/doom/websockets-doom.wasm", "application/wasm"],
  ],
  [
    "/doom/freedoom1.wad",
    ["dist/doom/freedoom1.wad", "application/octet-stream"],
  ],
  ["/doom/default.cfg", ["dist/doom/default.cfg", "text/plain"]],
]);
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (pathname === "/") {
    response.setHeader("Content-Type", "text/html");
    response.end(
      doomHtml({
        cspSource: origin,
        root: origin + "/doom",
        script: origin + "/doom.js",
        style: origin + "/doom.css",
        nonce: "local-runtime-test",
      }),
    );
    return;
  }
  const asset = assets.get(pathname);
  if (!asset) {
    response.writeHead(404);
    response.end();
    return;
  }
  try {
    response.setHeader("Content-Type", asset[1]);
    response.end(await readFile(resolve(asset[0])));
  } catch {
    response.writeHead(500);
    response.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
origin = "http://127.0.0.1:" + server.address().port;
let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.DBTUNA_BROWSER,
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1000, height: 800 },
  });
  const errors = [],
    external = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("websocket", (socket) => external.push(socket.url()));
  page.on("request", (request) => {
    if (!request.url().startsWith(origin + "/")) external.push(request.url());
  });
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.addInitScript(() => {
    window.__messages = [];
    window.__gameOutput = [];
    window.acquireVsCodeApi = () => ({
      postMessage: (message) => window.__messages.push(message),
    });
    let module;
    Object.defineProperty(window, "Module", {
      configurable: true,
      get: () => module,
      set: (value) => {
        module = value;
        module.print = module.printErr = (text) => {
          if (window.__gameOutput.length < 60)
            window.__gameOutput.push(String(text));
        };
      },
    });
  });
  await page.goto(origin);
  await page
    .waitForFunction(
      () =>
        document.getElementById("status").hidden ||
        document.getElementById("status").textContent.includes("Unable"),
      undefined,
      { timeout: 60000 },
    )
    .catch(async (error) => {
      console.log(
        JSON.stringify({
          errors,
          status: await page.locator("#status").textContent(),
        }),
      );
      throw error;
    });
  if (!(await page.locator("#status").evaluate((element) => element.hidden))) {
    console.log(
      JSON.stringify({
        errors,
        output: await page.evaluate(() => window.__gameOutput),
        runtime: await page.evaluate(() => ({
          module: typeof window.Module,
          fs: typeof window.Module?.FS,
          callMain: typeof window.callMain,
          canvas: [
            document.querySelector("canvas").width,
            document.querySelector("canvas").height,
          ],
        })),
      }),
    );
    throw Error("Game startup failed");
  }
  await page.waitForTimeout(1000);
  const footerVisible = await page
    .locator("footer")
    .evaluate(
      (element) => element.getBoundingClientRect().bottom <= window.innerHeight,
    );
  if (!footerVisible) throw Error("Game controls are clipped");
  const frame = await page.locator("canvas").screenshot();
  if (frame.length < 10000) throw Error("No rendered game frame");
  await page.locator("canvas").click();
  await page.keyboard.down("ArrowUp");
  await page.waitForTimeout(600);
  await page.keyboard.up("ArrowUp");
  await page.keyboard.press("Control");
  await page.keyboard.press("Escape");
  await page.screenshot({ path: "work/doom-preview.png" });
  await page
    .getByRole("button", { name: "Back to plans", exact: true })
    .click();
  if (
    !(await page.evaluate(() =>
      window.__messages.some((message) => message.type === "EXIT_DOOM"),
    ))
  )
    throw Error("Exit action not sent");
  if (external.length)
    throw Error("External game requests: " + external.join(", "));
  if (errors.length) throw Error(errors.join("\n"));
  console.log(
    "Local WASM game boot, rendered frames, keyboard input, exit action and offline-only requests verified.",
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
