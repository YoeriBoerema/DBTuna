import * as vscode from "vscode";
import type { ConnectionManager } from "../connection/connectionManager";
import type { PanelManager } from "../webview/panelManager";
import type { ExecutionManager } from "./executionManager";
import { prepareBatch, explainBatch } from "./batchExplain";
import { databaseConnector } from "../connectors/registry";
export class ExplainCoordinator {
  private activeBatch?: AbortController;
  constructor(
    private connections: ConnectionManager,
    private panels: PanelManager,
    private execution: ExecutionManager,
    private cancelAll: () => void,
  ) {}
  cancel() {
    this.activeBatch?.abort();
  }
  async explain() {
    const { connections, panels, execution } = this;
    const cancel = this.cancelAll;

    if (!vscode.workspace.isTrusted)
      throw Error("Trust this workspace to use live database connections.");
    const editor = vscode.window.activeTextEditor;
    if (!editor)
      throw Error(
        "Click your SQL editor, select a statement, and run DBTuna: Explain Query again.",
      );
    const profile = await connections.active();
    if (!profile) return;
    const connector = databaseConnector(profile.type);
    const statements = connector.split(
      editor.document.getText(),
      editor.selection.isEmpty
        ? undefined
        : editor.document.getText(editor.selection),
    );
    const previous = panels.batch;
    cancel();
    this.activeBatch = undefined;
    if (previous)
      panels.showBatch({
        ...previous,
        items: previous.items.map((item) =>
          item.status === "pending" || item.status === "running"
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
    this.activeBatch = abort;
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
          const password = await connections.password(profile);
          let previousCompleted = 0;
          return await explainBatch(
            batch,
            async (sql, signal) => {
              const result = await connector.collectEstimated(
                profile,
                password,
                sql,
                signal,
              );
              const plans = connector.parse(result.raw);
              for (const plan of plans) {
                plan.query ||= sql;
                if (result.version) plan.database.version = result.version;
                plan.source.capturedAt = new Date().toISOString();
                plan.application.connectionLabel = profile.name;
              }
              return plans;
            },
            abort.signal,
            (update) => {
              if (this.activeBatch !== abort || !panels.isOpen) return;
              panels.showBatch(update);
              const completed = update.items.filter(
                (item) =>
                  !(item.status === "pending" || item.status === "running"),
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
            (plan, sourceSql) => {
              if (this.activeBatch === abort && panels.isOpen)
                execution.register(plan, profile, sourceSql);
            },
          );
        } catch (error) {
          if (this.activeBatch === abort && panels.isOpen)
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
          if (this.activeBatch === abort) this.activeBatch = undefined;
        }
      },
    );
  }
}
