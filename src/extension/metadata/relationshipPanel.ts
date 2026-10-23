import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import type { ConnectionManager } from "../connection/connectionManager";
import type { RelationshipGraph } from "./relationshipGraph";
import { readDatabaseRelationships } from "./readRelationships";

export async function openRelationships(
  context: vscode.ExtensionContext,
  connections: ConnectionManager,
  node: unknown,
) {
  if (!vscode.workspace.isTrusted) {
    void vscode.window.showWarningMessage(
      "Trust the workspace to visualize database metadata.",
    );
    return;
  }
  const candidate = node as
    { profile?: { id?: unknown }; kind?: unknown } | undefined;
  const profile =
    candidate?.kind === "schemas"
      ? connections.profiles().find((p) => p.id === candidate.profile?.id)
      : undefined;
  if (!profile) {
    void vscode.window.showInformationMessage(
      "Use Visualize Table Relationships on a database connection in the Database Explorer.",
    );
    return;
  }
  const controller = new AbortController();
  try {
    const graph = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Reading database relationships · ${profile.name}…`,
        cancellable: true,
      },
      async (_, token) => {
        const cancel = token.onCancellationRequested(() => controller.abort());
        try {
          const password = await connections.password(profile);
          if (controller.signal.aborted || !vscode.workspace.isTrusted) return;
          const graph = await readDatabaseRelationships(
            profile,
            password,
            controller.signal,
          );
          if (controller.signal.aborted || !vscode.workspace.isTrusted) return;
          return graph;
        } finally {
          cancel.dispose();
        }
      },
    );
    if (graph) showRelationshipPanel(context, graph);
  } catch {
    if (!controller.signal.aborted)
      void vscode.window.showErrorMessage(
        "DBTuna: Could not visualize the database. Check connection permissions. Diagrams support up to 2,000 tables and 10,000 foreign-key column mappings (up to 2,000 per schema).",
      );
  } finally {
    controller.abort();
  }
}
function showRelationshipPanel(
  context: vscode.ExtensionContext,
  graph: RelationshipGraph,
) {
  const root = vscode.Uri.joinPath(context.extensionUri, "dist");
  const panel = vscode.window.createWebviewPanel(
    "dbtuna.relationships",
    `DBTuna · ${graph.schema} relationships`,
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      localResourceRoots: [root],
      retainContextWhenHidden: true,
    },
  );
  const nonce = randomBytes(16).toString("hex");
  const script = panel.webview.asWebviewUri(
    vscode.Uri.joinPath(root, "relationships.js"),
  );
  const css = panel.webview.asWebviewUri(
    vscode.Uri.joinPath(root, "relationships.css"),
  );
  const listener = panel.webview.onDidReceiveMessage((message: unknown) => {
    if (
      message &&
      typeof message === "object" &&
      "type" in message &&
      message.type === "READY"
    )
      void panel.webview.postMessage({ type: "GRAPH", graph });
  });
  panel.onDidDispose(() => listener.dispose());
  context.subscriptions.push(panel);
  panel.webview.html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${panel.webview.cspSource} 'unsafe-inline'; font-src ${panel.webview.cspSource};"><link rel="stylesheet" href="${css}"></head><body><div id="root"></div><script nonce="${nonce}" src="${script}"></script></body></html>`;
}
