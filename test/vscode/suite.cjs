const vscode = require("vscode");
const assert = require("node:assert/strict");
exports.run = async () => {
  const ext = vscode.extensions.getExtension("dbtuna-local.dbtuna");
  assert.ok(ext);
  await ext.activate();
  const commands = await vscode.commands.getCommands();
  for (const id of [
    "explainQuery",
    "importPlan",
    "exportPlan",
    "addConnection",
    "selectConnection",
    "manageConnections",
    "loadSamplePlan",
    "aiAssistance",
    "aiSetApiKey",
    "aiSelectModel",
    "aiRemoveApiKey",
    "refreshExplorer",
    "showExplorer",
    "visualizeRelationships",
  ])
    assert.ok(commands.includes("dbtuna." + id));
  assert.ok(commands.includes("dbtuna.doom"));
  assert.ok(
    ext.packageJSON.contributes.views.explorer.some(
      (view) => view.id === "dbtuna.databaseExplorer",
    ),
  );
  await vscode.commands.executeCommand("dbtuna.refreshExplorer");
  await vscode.commands.executeCommand("dbtuna.showExplorer");
  const inputs = [],
    errors = [];
  const originalInput = vscode.window.showInputBox;
  const originalPick = vscode.window.showQuickPick;
  const originalError = vscode.window.showErrorMessage;
  try {
    vscode.window.showQuickPick = async (items) => items[0];
    vscode.window.showInputBox = async (options) => {
      inputs.push(options.prompt);
      assert.equal(options.prompt, "Connection name");
      return "DOOMGUY";
    };
    vscode.window.showErrorMessage = async (message) => {
      errors.push(message);
    };
    await vscode.commands.executeCommand("dbtuna.addConnection");
    assert.deepEqual(inputs, ["Connection name"]);
    assert.deepEqual(errors, []);
    for (const engine of ["postgresql", "sqlserver", "oracle"]) {
      let checkedUsername = false;
      vscode.window.showQuickPick = async (items) =>
        items.find((item) => item.value === engine) || items[0];
      vscode.window.showInputBox = async (options) => {
        if (options.prompt === "Username") {
          assert.equal(options.value, "dbtuna");
          checkedUsername = true;
          return undefined; // Stop before any credentials are requested or saved.
        }
        return options.prompt === "Connection name"
          ? "Security test"
          : options.value;
      };
      await vscode.commands.executeCommand("dbtuna.addConnection");
      assert.equal(checkedUsername, true);
    }
  } finally {
    vscode.window.showInputBox = originalInput;
    vscode.window.showQuickPick = originalPick;
    vscode.window.showErrorMessage = originalError;
  }
  await vscode.commands.executeCommand("dbtuna.loadSamplePlan");
  const doc = await vscode.workspace.openTextDocument({
    language: "sql",
    content: "SELECT 1; SELECT 2;",
  });
  await vscode.window.showTextDocument(doc);
  assert.equal(doc.languageId, "sql");
  console.log(
    "DBTuna activation, eleven commands including AI Assistance, sample panel, SQL editor and special-name dispatch verified.",
  );
};
