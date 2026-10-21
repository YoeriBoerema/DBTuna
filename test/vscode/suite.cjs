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
  ])
    assert.ok(commands.includes("dbtuna." + id));
  await vscode.commands.executeCommand("dbtuna.loadSamplePlan");
  const doc = await vscode.workspace.openTextDocument({
    language: "sql",
    content: "SELECT 1; SELECT 2;",
  });
  await vscode.window.showTextDocument(doc);
  assert.equal(doc.languageId, "sql");
  console.log(
    "DBTuna activation, eleven commands including AI Assistance, sample panel, SQL editor verified.",
  );
};
