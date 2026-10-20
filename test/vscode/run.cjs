const { runTests } = require("@vscode/test-electron");
const path = require("node:path");
runTests({
  vscodeExecutablePath: process.env.VSCODE_EXECUTABLE,
  extensionDevelopmentPath: path.resolve(__dirname, "../.."),
  extensionTestsPath: path.resolve(__dirname, "suite.cjs"),
  launchArgs: [
    "--disable-extensions",
    "--skip-welcome",
    "--skip-release-notes",
    "--user-data-dir=" + path.resolve(__dirname, "../../work/vscode-profile"),
  ],
}).catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
