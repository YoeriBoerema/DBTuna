import * as vscode from "vscode";
import { AdapterRegistry } from "../../packages/adapter-sdk/src/registry";
import { PostgresAdapter } from "../../packages/adapter-postgres/src/postgresAdapter";
import { ConnectionManager } from "./connection/connectionManager";
import { collectPlan } from "./connection/postgresClient";
import { splitSqlBatch } from "./sql/batchSelection";
import { prepareBatch, explainBatch } from "./services/batchExplain";
import { bounded } from "../../packages/plan-core/src/schema";
import { restoreBatch } from "../../packages/plan-core/src/batch";
import { PanelManager } from "./webview/panelManager";
export function activate(context: vscode.ExtensionContext) {
  const registry = new AdapterRegistry([new PostgresAdapter()]);
  const connections = new ConnectionManager(context);
  let activeBatch: AbortController | undefined;
  const cancel = () => {
    activeBatch?.abort();
  };
  const panels = new PanelManager(context, cancel);
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
  command("loadSamplePlan", async () => {
    cancel();
    activeBatch = undefined;
    const data = await vscode.workspace.fs.readFile(
      vscode.Uri.joinPath(
        context.extensionUri,
        "fixtures",
        "postgres",
        "nested-loop.json",
      ),
    );
    panels.show(registry.parse(Buffer.from(data).toString("utf8")));
  });
  command("importPlan", async () => {
    const uris = await vscode.window.showOpenDialog({
      filters: { "Execution plan": ["json"] },
      canSelectMany: false,
    });
    if (!uris) return;
    const stat = await vscode.workspace.fs.stat(uris[0]);
    if (stat.size > 5 * 1024 * 1024) throw Error("Import exceeds 5 MiB.");
    const bytes = await vscode.workspace.fs.readFile(uris[0]);
    const value = bounded(Buffer.from(bytes).toString("utf8"));
    cancel();
    activeBatch = undefined;
    if (
      value &&
      typeof value === "object" &&
      "kind" in value &&
      value.kind === "dbtuna-batch"
    ) {
      panels.open();
      panels.showBatch(restoreBatch(value));
    } else panels.show(registry.parse(value));
  });
  command("exportPlan", async () => {
    const exportBatch =
      panels.batch &&
      !(panels.batch.items.length === 1 && panels.batch.items[0].plan);
    const data = exportBatch
      ? panels.batch
      : panels.batch?.items[0].plan || panels.plan;
    if (!data) throw Error("Load a plan before exporting.");
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(
        exportBatch ? "dbtuna-batch.json" : "dbtuna-plan.json",
      ),
      filters: { JSON: ["json"] },
    });
    if (uri)
      await vscode.workspace.fs.writeFile(
        uri,
        Buffer.from(JSON.stringify(data, null, 2)),
      );
  });
  command("addConnection", () => connections.edit());
  command("selectConnection", () => connections.choose());
  command("manageConnections", () => connections.manage());
  command("explainQuery", async () => {
    if (!vscode.workspace.isTrusted)
      throw Error("Trust this workspace to use live PostgreSQL connections.");
    const editor = vscode.window.activeTextEditor;
    if (!editor)
      throw Error(
        "Click your SQL editor, select a statement, and run DBTuna: Explain Query again.",
      );
    const statements = splitSqlBatch(
      editor.document.getText(),
      editor.selection.isEmpty
        ? undefined
        : editor.document.getText(editor.selection),
    );
    const previous = panels.batch;
    cancel();
    activeBatch = undefined;
    if (previous)
      panels.showBatch({
        ...previous,
        items: previous.items.map((item) =>
          ["pending", "running"].includes(item.status)
            ? {
                ...item,
                status: "cancelled",
                error: "Replaced by a new Explain request.",
              }
            : item,
        ),
      });
    const batch = prepareBatch(statements);
    if (!batch.items.some((item) => item.status === "pending")) {
      panels.showBatch(batch);
      return batch;
    }
    const profile = await connections.active();
    if (!profile) return;
    batch.connectionLabel = profile.name;
    const abort = new AbortController();
    activeBatch = abort;
    panels.open();
    panels.showBatch(batch);
    return await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `DBTuna: Planning ${statements.length} ${statements.length === 1 ? "query" : "queries"}`,
        cancellable: true,
      },
      async (progress, token) => {
        const sub = token.onCancellationRequested(() => abort.abort());
        if (token.isCancellationRequested) abort.abort();
        try {
          const config = await connections.config(profile);
          let previousCompleted = 0;
          return await explainBatch(
            batch,
            async (sql, signal) => {
              const result = await collectPlan(config, sql, signal);
              const plan = registry.parse(result.raw);
              plan.query = sql;
              plan.database.version = result.version;
              plan.source.capturedAt = new Date().toISOString();
              plan.metadata.connectionLabel = profile.name;
              return plan;
            },
            abort.signal,
            (update) => {
              if (activeBatch !== abort || !panels.isOpen) return;
              panels.showBatch(update);
              const completed = update.items.filter(
                (item) => !["pending", "running"].includes(item.status),
              ).length;
              progress.report({
                message: `${completed}/${update.items.length} finished`,
                increment:
                  (100 * (completed - previousCompleted)) / update.items.length,
              });
              previousCompleted = completed;
            },
          );
        } catch (error) {
          if (activeBatch === abort && panels.isOpen)
            panels.showBatch({
              ...batch,
              items: batch.items.map((item) =>
                item.status === "pending"
                  ? {
                      ...item,
                      status: abort.signal.aborted ? "cancelled" : "error",
                      error: abort.signal.aborted
                        ? "Batch cancelled."
                        : error instanceof Error
                          ? error.message
                          : "Could not prepare database connection.",
                    }
                  : item,
              ),
            });
        } finally {
          sub.dispose();
          if (activeBatch === abort) activeBatch = undefined;
        }
      },
    );
  });
}
export function deactivate() {}
