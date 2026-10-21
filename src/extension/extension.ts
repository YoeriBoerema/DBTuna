import * as vscode from "vscode";
import { ExecutionManager } from "./services/executionManager";
import { AiAssistance } from "./ai/aiAssistance";
import { AdapterRegistry } from "../../packages/adapter-sdk/src/registry";
import { PostgresAdapter } from "../../packages/adapter-postgres/src/postgresAdapter";
import { SqlServerAdapter } from "../../packages/adapter-sqlserver/src/sqlServerAdapter";
import { collectSqlServerPlan } from "./connection/sqlServerClient";
import { splitTsqlBatch } from "./sql/sqlServerSelection";
import { ConnectionManager } from "./connection/connectionManager";
import { collectPlan } from "./connection/postgresClient";
import { splitSqlBatch } from "./sql/batchSelection";
import {
  prepareBatch,
  explainBatch,
  completedBatch,
} from "./services/batchExplain";
import { bounded } from "../../packages/plan-core/src/schema";
import { decodePlan } from "./services/planText";
import { restoreBatch } from "../../packages/plan-core/src/batch";
import { PanelManager } from "./webview/panelManager";
export async function activate(context: vscode.ExtensionContext) {
  const registry = new AdapterRegistry([
    new PostgresAdapter(),
    new SqlServerAdapter(),
  ]);
  const connections = new ConnectionManager(context);
  await connections.initialize();
  let activeBatch: AbortController | undefined;
  const cancel = () => {
    activeBatch?.abort();
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
      confirm: async (title, detail) =>
        (await vscode.window.showWarningMessage(
          title,
          { modal: true, detail },
          "Run query",
        )) === "Run query",
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
  command("aiAssistance", () => ai.menu());
  command("aiSetApiKey", () => ai.setKey());
  command("aiSelectModel", () => ai.selectModel());
  command("aiRemoveApiKey", () => ai.removeKey());
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
      filters: { "Execution plan": ["json", "sqlplan", "xml"] },
      canSelectMany: false,
    });
    if (!uris) return;
    const stat = await vscode.workspace.fs.stat(uris[0]);
    if (stat.size > 5 * 1024 * 1024) throw Error("Import exceeds 5 MiB.");
    const bytes = await vscode.workspace.fs.readFile(uris[0]);
    const text = decodePlan(bytes);
    const value = text.trimStart().startsWith("<") ? text : bounded(text);
    const offline = (
      plan: import("../../packages/plan-core/src/types").QueryPlan,
    ) => {
      plan.metadata.executionAvailable = false;
      return plan;
    };
    if (typeof value === "string" && new SqlServerAdapter().canParse(value)) {
      const plans = new SqlServerAdapter().parseStatements(value).map(offline);
      cancel();
      activeBatch = undefined;
      panels.open();
      panels.showBatch(completedBatch(plans));
      return;
    }
    cancel();
    activeBatch = undefined;
    if (
      value &&
      typeof value === "object" &&
      "kind" in value &&
      value.kind === "dbtuna-batch"
    ) {
      panels.open();
      const restored = restoreBatch(value);
      restored.items.forEach((item) => {
        if (item.plan) offline(item.plan);
      });
      panels.showBatch(restored);
    } else panels.show(offline(registry.parse(value)));
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
      throw Error("Trust this workspace to use live database connections.");
    const editor = vscode.window.activeTextEditor;
    if (!editor)
      throw Error(
        "Click your SQL editor, select a statement, and run DBTuna: Explain Query again.",
      );
    const profile = await connections.active();
    if (!profile) return;
    const statements = (
      profile.type === "sqlserver" ? splitTsqlBatch : splitSqlBatch
    )(
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
    const batch = prepareBatch(statements, profile.type);
    if (!batch.items.some((item) => item.status === "pending")) {
      panels.showBatch(batch);
      return batch;
    }
    batch.connectionLabel = profile.name;
    const abort = new AbortController();
    activeBatch = abort;
    panels.open();
    panels.showBatch(batch);
    return await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "DBTuna: Planning queries",
        cancellable: true,
      },
      async (progress, token) => {
        const sub = token.onCancellationRequested(() => abort.abort());
        if (token.isCancellationRequested) abort.abort();
        try {
          const config = await connections.config(profile);
          const password = await connections.password(profile);
          let previousCompleted = 0;
          return await explainBatch(
            batch,
            async (sql, signal) => {
              const result =
                profile.type === "sqlserver"
                  ? await collectSqlServerPlan(profile, password, sql, signal)
                  : await collectPlan(config, sql, signal);
              const plans =
                profile.type === "sqlserver"
                  ? new SqlServerAdapter().parseStatements(result.raw)
                  : [registry.parse(result.raw)];
              for (const plan of plans) {
                plan.query ||= sql;
                if (profile.type === "sqlserver") plan.metadata.batchSql = sql;
                if (result.version) plan.database.version = result.version;
                plan.source.capturedAt = new Date().toISOString();
                plan.metadata.connectionLabel = profile.name;
              }
              return plans;
            },
            abort.signal,
            (update) => {
              if (activeBatch !== abort || !panels.isOpen) return;
              for (const item of update.items)
                if (item.plan) execution.register(item.plan, profile);
              panels.showBatch(update);
              const completed = update.items.filter(
                (item) => !["pending", "running"].includes(item.status),
              ).length;
              progress.report({
                message: `${completed}/${update.items.length} queries finished`,
                increment: Math.max(
                  0,
                  (100 * completed) / update.items.length - previousCompleted,
                ),
              });
              previousCompleted = (100 * completed) / update.items.length;
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
