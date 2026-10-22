import { readdirSync } from "node:fs";
import { runNode } from "./helpers/run.mjs";
runNode(["node_modules/typescript/bin/tsc", "--noEmit"]);
runNode([
  "node_modules/eslint/bin/eslint.js",
  "src",
  "packages",
  "webview",
  "test",
]);
runNode([
  "--import",
  "tsx",
  "--test",
  ...readdirSync("test/unit")
    .filter((file) => file.endsWith(".test.ts"))
    .map((file) => `test/unit/${file}`),
]);
runNode(["build.mjs"]);
runNode(["test/browser.mjs"]);
if (process.argv.includes("--postgres"))
  runNode(["test/integration/embedded.mjs"]);
if (process.argv.includes("--vscode")) runNode(["test/vscode/run.cjs"]);
console.log("DBTuna verification passed.");
