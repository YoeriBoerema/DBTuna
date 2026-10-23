import { readdirSync } from "node:fs";
import { runNode } from "./helpers/run.mjs";
runNode(["scripts/sync-build-info.mjs", "--check"]);
runNode([
  "node_modules/prettier/bin/prettier.cjs",
  "--check",
  "src",
  "packages",
  "webview",
  "test",
  "scripts",
  "*.json",
  "*.mjs",
]);
runNode(["node_modules/typescript/bin/tsc", "--noEmit"]);
runNode([
  "node_modules/eslint/bin/eslint.js",
  "src",
  "packages",
  "webview",
  "test",
  "scripts",
  "*.mjs",
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
if (process.argv.includes("--databases"))
  runNode(["test/integration/databases.mjs"]);
else {
  if (process.argv.includes("--postgres"))
    runNode(["test/integration/postgres-docker.mjs"]);
  if (process.argv.includes("--sqlserver"))
    runNode(["test/integration/sqlserver-docker.mjs"]);
  if (process.argv.includes("--oracle"))
    runNode(["test/integration/oracle-docker.mjs"]);
}
if (process.argv.includes("--vscode")) runNode(["test/vscode/run.cjs"]);
console.log("DBTuna verification passed.");
