import { cp, mkdir } from "node:fs/promises";
import { build } from "esbuild";
await build({
  entryPoints: ["src/extension/extension.ts"],
  outfile: "dist/extension.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["vscode"],
  sourcemap: true,
});
await build({
  entryPoints: ["webview/src/App.tsx"],
  outfile: "dist/webview.js",
  bundle: true,
  platform: "browser",
  format: "iife",
  minify: true,
  sourcemap: true,
});

await mkdir("dist/doom", { recursive: true });
await cp("vendor/doom", "dist/doom", { recursive: true });
await cp("webview/doom/style.css", "dist/doom.css");
await build({
  entryPoints: ["webview/doom/boot.ts"],
  outfile: "dist/doom.js",
  bundle: true,
  platform: "browser",
  format: "iife",
  minify: true,
});
