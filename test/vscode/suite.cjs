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
  ])
    assert.ok(commands.includes("dbtuna." + id));
  assert.ok(commands.includes("dbtuna.doom"));
  assert.ok(
    ext.packageJSON.contributes.views.explorer.some(
      (view) => view.id === "dbtuna.databaseExplorer",
    ),
  );
  await vscode.commands.executeCommand("dbtuna.refreshExplorer");
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
