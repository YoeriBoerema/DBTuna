import { DatabaseExplorer } from "./metadata/databaseExplorer";
import { openRelationships } from "./metadata/relationshipPanel";
import * as vscode from "vscode";
import { ExecutionManager } from "./services/executionManager";
import { ExplainCoordinator } from "./services/explainCoordinator";
import { PlanFiles } from "./services/planFiles";
import { AiAssistance } from "./ai/aiAssistance";
import { AdapterRegistry } from "../../packages/adapter-sdk/src/registry";
import { PostgresAdapter } from "../../packages/adapter-postgres/src/postgresAdapter";
import { SqlServerAdapter } from "../../packages/adapter-sqlserver/src/sqlServerAdapter";
import { OracleAdapter } from "../../packages/adapter-oracle/src/oracleAdapter";
import { ConnectionManager } from "./connection/connectionManager";
import { PanelManager } from "./webview/panelManager";
export async function activate(context: vscode.ExtensionContext) {
  const registry = new AdapterRegistry([
    new PostgresAdapter(),
    new SqlServerAdapter(),
    new OracleAdapter(),
  ]);
  const connections = new ConnectionManager(context, async (name) => {
    if (name.trim() !== "DOOMGUY") return false;
    await vscode.commands.executeCommand("dbtuna.doom");
    return true;
  });
  await connections.initialize();
  const explorer = new DatabaseExplorer(connections);
  context.subscriptions.push(
    explorer,
    vscode.commands.registerCommand("dbtuna.showExplorer", () =>
      vscode.commands.executeCommand("dbtuna.databaseExplorer.focus"),
    ),
    vscode.commands.registerCommand(
      "dbtuna.visualizeRelationships",
      (node: unknown) => openRelationships(context, connections, node),
    ),
    vscode.window.registerTreeDataProvider("dbtuna.databaseExplorer", explorer),
    vscode.commands.registerCommand("dbtuna.refreshExplorer", () =>
      explorer.refresh(),
    ),
    connections.onDidChange(() => explorer.refresh()),
    vscode.workspace.onDidGrantWorkspaceTrust(() => explorer.refresh()),
  );
  const cancel = () => {
    explain?.cancel();
    assistance?.cancel();
    execution?.reset();
  };
  const panels = new PanelManager(context, cancel, (message) => {
    if (message.type === "EXPORT_ACTUAL")
      void execution
        .export(message.planId)
        .catch(() =>
          vscode.window.showErrorMessage(
            "DBTuna: Could not export actual plan.",
          ),
        );
    if (message.type === "RUN_ACTUAL")
      void execution.run(message.planId, message.requestId);
    if (message.type === "CANCEL_ACTUAL") execution.cancel(message.requestId);
    if (message.type === "AI_ANALYZE") void assistance?.analyze(message);
    if (message.type === "AI_CANCEL") assistance?.cancel(message.requestId);
  });
  const execution = new ExecutionManager(
    connections,
    (message) => panels.post(message),
    (id) =>
      panels.plan?.id === id ||
      !!panels.batch?.items.some((item) => item.plan?.id === id),
    {
      trusted: () => vscode.workspace.isTrusted,
      exportPlan: async (plan) => {
        const uri = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file("dbtuna-actual-plan.json"),
          filters: { JSON: ["json"] },
        });
        if (uri)
          await vscode.workspace.fs.writeFile(
            uri,
            Buffer.from(JSON.stringify(plan, null, 2)),
          );
      },
    },
  );
  context.subscriptions.push(execution);
  const ai = new AiAssistance(
    context,
    (id) =>
      panels.plan?.id === id
        ? panels.plan
        : panels.batch?.items.find((item) => item.plan?.id === id)?.plan ||
          execution.findActual(id),
    (message) => panels.post(message),
  );
  const assistance = ai;
  context.subscriptions.push(ai);
  context.subscriptions.push({ dispose: cancel });
  context.subscriptions.push(panels);
  const command = (id: string, fn: () => unknown) =>
    context.subscriptions.push(
      vscode.commands.registerCommand("dbtuna." + id, async () => {
        try {
          return await fn();
        } catch (e) {
          const message = e instanceof Error ? e.message : "Unexpected error";
          void vscode.window.showErrorMessage("DBTuna: " + message);
          if (id === "explainQuery")
            panels.send({ type: "PLAN_ERROR", message });
        }
      }),
    );
  command("doom", () => panels.showDoom());
  command("aiAssistance", () => ai.menu());
  command("aiSetApiKey", () => ai.setKey());
  command("aiSelectModel", () => ai.selectModel());
  command("aiRemoveApiKey", () => ai.removeKey());
  const files = new PlanFiles(context, registry, panels, cancel);
  command("loadSamplePlan", () => files.loadSamplePlan());
  command("importPlan", () => files.importPlan());
  command("exportPlan", () => files.exportPlan());
  command("addConnection", () => connections.edit());
  command("selectConnection", () => connections.choose());
  command("manageConnections", () => connections.manage());
  const explain = new ExplainCoordinator(
    connections,
    panels,
    execution,
    cancel,
  );
  command("explainQuery", () => explain.explain());
  const revealExplorer = () => {
    if (
      vscode.workspace
        .getConfiguration("dbtuna")
        .get<boolean>("alwaysShowDatabaseExplorer", true)
    )
      void vscode.commands
        .executeCommand("dbtuna.databaseExplorer.focus", {
          preserveFocus: true,
        })
        .then(undefined, () => {
          // A closing window may dispose the view while it is being revealed.
        });
  };
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("dbtuna.alwaysShowDatabaseExplorer"))
        revealExplorer();
    }),
  );
  revealExplorer();
}
export function deactivate() {}
