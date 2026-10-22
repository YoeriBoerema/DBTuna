import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { doomHtml } from "../../src/extension/webview/doomHtml";
test("bundled game runtime and source assets match their integrity manifest", () => {
  const base = "vendor/doom/";
  const manifest = JSON.parse(
    readFileSync(base + "integrity.json", "utf8"),
  ) as Record<string, string>;
  for (const [name, digest] of Object.entries(manifest))
    assert.equal(
      createHash("sha256")
        .update(readFileSync(base + name))
        .digest("hex"),
      digest,
      name,
    );
  assert.equal(
    readFileSync(base + "freedoom1.wad")
      .subarray(0, 4)
      .toString(),
    "IWAD",
  );
  assert.deepEqual(
    [...readFileSync(base + "websockets-doom.wasm").subarray(0, 4)],
    [0, 97, 115, 109],
  );
  assert.ok(
    manifest["engine-source.zip"] &&
      manifest.COPYING &&
      manifest["FREEDOOM-COPYING"],
  );
});
test("game HTML limits asset requests to local resources and preserves the exit action", () => {
  const html = doomHtml({
    cspSource: "https://local.vscode-resource.invalid",
    root: "https://local.vscode-resource.invalid/doom",
    script: "https://local.vscode-resource.invalid/doom.js",
    style: "https://local.vscode-resource.invalid/doom.css",
    nonce: "test-nonce",
  });
  assert.ok(html.includes("'wasm-unsafe-eval'"));
  assert.equal(html.includes("'unsafe-eval'"), false);
  assert.ok(
    html.includes("connect-src https://local.vscode-resource.invalid;"),
  );
  assert.ok(html.includes('id="canvas"'));
  assert.ok(html.includes('id="back"'));
  assert.equal(html.includes("api.openai.com"), false);
});
