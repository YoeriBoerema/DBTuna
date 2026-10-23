import { packageInfo } from "./package-info.mjs";
import { verifyVsix } from "./verify-vsix.mjs";
import { runNode } from "./run.mjs";
const { manifest, output } = packageInfo();
runNode(["scripts/sync-build-info.mjs"]);
runNode(["build.mjs"]);
runNode([
  "node_modules/@vscode/vsce/vsce",
  "package",
  "--no-dependencies",
  "--no-rewrite-relative-links",
  "--out",
  output,
]);
const sha256 = await verifyVsix(output, manifest);
console.log(`Verified ${output}\nSHA-256: ${sha256}`);
