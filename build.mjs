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
