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
  ])
    assert.ok(commands.includes("dbtuna." + id));
  await vscode.commands.executeCommand("dbtuna.loadSamplePlan");
  const doc = await vscode.workspace.openTextDocument({
    language: "sql",
    content: "SELECT 1; SELECT 2;",
  });
  await vscode.window.showTextDocument(doc);
  assert.equal(doc.languageId, "sql");
  const batchDoc = await vscode.workspace.openTextDocument({
    language: "sql",
    content: "SELECT 1; DELETE FROM x; UPDATE x SET y=1;",
  });
  const editor = await vscode.window.showTextDocument(batchDoc);
  editor.selection = new vscode.Selection(
    batchDoc.positionAt(batchDoc.getText().indexOf("DELETE")),
    batchDoc.positionAt(batchDoc.getText().length),
  );
  const batch = await vscode.commands.executeCommand("dbtuna.explainQuery");
  assert.equal(batch.kind, "dbtuna-batch");
  assert.equal(batch.items.length, 2);
  assert.ok(batch.items.every((item) => item.status === "error"));
  assert.ok(batch.items[0].sql.startsWith("DELETE"));
  console.log(
    "DBTuna activation, seven commands, sample panel, SQL editor and exact-selection batch command verified.",
  );
};
