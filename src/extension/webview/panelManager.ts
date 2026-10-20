import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import type { QueryPlan } from "../../../packages/plan-core/src/types";
import type { PlanBatch } from "../../../packages/plan-core/src/batch";
import type { ExtensionToWebview } from "./messages";
export class PanelManager implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  private ready = false;
  private state?: ExtensionToWebview;
  plan?: QueryPlan;
  batch?: PlanBatch;
  get isOpen() {
    return !!this.panel;
  }
  constructor(
    private context: vscode.ExtensionContext,
    private cancel: () => void = () => {},
  ) {}
  open() {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside, true);
      return;
    }
    const root = vscode.Uri.joinPath(this.context.extensionUri, "dist");
    const panel = vscode.window.createWebviewPanel(
      "dbtuna.plan",
      "DBTuna · Execution plan",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        localResourceRoots: [root],
        retainContextWhenHidden: true,
      },
    );
    this.panel = panel;
    this.ready = false;
    const js = panel.webview.asWebviewUri(
      vscode.Uri.joinPath(root, "webview.js"),
    );
    const css = panel.webview.asWebviewUri(
      vscode.Uri.joinPath(root, "webview.css"),
    );
    const nonce = randomBytes(24).toString("base64");
    panel.iconPath = vscode.Uri.joinPath(
      this.context.extensionUri,
      "media",
      "icon.svg",
    );
    panel.webview.html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${panel.webview.cspSource} 'unsafe-inline'; img-src ${panel.webview.cspSource} data:; font-src ${panel.webview.cspSource};"><link rel="stylesheet" href="${css}"><title>DBTuna</title></head><body><div id="root"></div><script nonce="${nonce}" src="${js}"></script></body></html>`;
    panel.onDidDispose(() => {
      this.cancel();
      this.panel = undefined;
      this.ready = false;
    });
    panel.webview.onDidReceiveMessage((m: unknown) => {
      if (
        !m ||
        typeof m !== "object" ||
        !("type" in m) ||
        Object.keys(m).length !== 1
      )
        return;
      if (m.type === "WEBVIEW_READY") {
        this.ready = true;
        if (this.state) void panel.webview.postMessage(this.state);
      } else if (m.type === "EXPORT_PLAN")
        void vscode.commands.executeCommand("dbtuna.exportPlan");
      else if (m.type === "IMPORT_PLAN")
        void vscode.commands.executeCommand("dbtuna.importPlan");
      else if (m.type === "LOAD_SAMPLE")
        void vscode.commands.executeCommand("dbtuna.loadSamplePlan");
      else if (m.type === "CANCEL_BATCH") this.cancel();
    });
  }
  send(message: ExtensionToWebview) {
    if (!this.panel) this.open();
    this.state = message;
    if (this.ready) void this.panel?.webview.postMessage(message);
  }
  show(plan: QueryPlan) {
    this.batch = undefined;
    this.plan = plan;
    this.open();
    this.send({ type: "PLAN_LOADED", payload: plan });
  }
  showBatch(batch: PlanBatch) {
    this.plan = undefined;
    this.batch = batch;
    this.send({ type: "BATCH_LOADED", payload: batch });
  }
  dispose() {
    this.panel?.dispose();
  }
}
