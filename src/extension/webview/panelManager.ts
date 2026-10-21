import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import type { QueryPlan } from "../../../packages/plan-core/src/types";
import type { PlanBatch } from "../../../packages/plan-core/src/batch";
import {
  webviewMessageSchema,
  type ExtensionToWebview,
  type WebviewToExtension,
} from "./messages";
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
    private assist: (message: WebviewToExtension) => void = () => {},
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
      const parsed = webviewMessageSchema.safeParse(m);
      if (!parsed.success) return;
      const message = parsed.data;
      if (
        message.type === "AI_ANALYZE" ||
        message.type === "AI_CANCEL" ||
        message.type === "RUN_ACTUAL" ||
        message.type === "CANCEL_ACTUAL" ||
        message.type === "EXPORT_ACTUAL"
      ) {
        this.assist(message);
        return;
      }
      if (message.type === "AI_SETTINGS") {
        void vscode.commands.executeCommand("dbtuna.aiAssistance");
        return;
      }
      if (message.type === "WEBVIEW_READY") {
        this.ready = true;
        if (this.state) void panel.webview.postMessage(this.state);
      } else if (message.type === "EXPORT_PLAN")
        void vscode.commands.executeCommand("dbtuna.exportPlan");
      else if (message.type === "IMPORT_PLAN")
        void vscode.commands.executeCommand("dbtuna.importPlan");
      else if (message.type === "LOAD_SAMPLE")
        void vscode.commands.executeCommand("dbtuna.loadSamplePlan");
      else if (message.type === "CANCEL_BATCH") this.cancel();
    });
  }
  post(message: ExtensionToWebview) {
    if (this.ready) void this.panel?.webview.postMessage(message);
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
