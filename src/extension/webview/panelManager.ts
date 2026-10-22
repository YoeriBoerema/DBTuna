import { doomHtml } from "./doomHtml";
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
  private doomActive = false;
  private state?: ExtensionToWebview;
  plan?: QueryPlan;
  batch?: PlanBatch;
  get isOpen() {
    return !!this.panel && !this.doomActive;
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
    this.renderPlan(panel);
    panel.onDidDispose(() => {
      this.cancel();
      this.panel = undefined;
      this.ready = false;
      this.doomActive = false;
    });
    panel.webview.onDidReceiveMessage((m: unknown) => {
      const parsed = webviewMessageSchema.safeParse(m);
      if (!parsed.success) return;
      const message = parsed.data;
      if (this.doomActive) {
        if (message.type === "EXIT_DOOM") {
          this.doomActive = false;
          this.ready = false;
          this.renderPlan(panel);
        }
        return;
      }
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
  private renderPlan(panel: vscode.WebviewPanel) {
    const root = vscode.Uri.joinPath(this.context.extensionUri, "dist");
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
  }
  showDoom() {
    this.open();
    this.doomActive = true;
    this.ready = false;
    this.cancel();
    const disableRun = (plan: QueryPlan) => {
      plan.application.executionAvailable = false;
      plan.application.executionUnavailableReason =
        "Run Explain again to enable execution.";
    };
    if (this.plan) disableRun(this.plan);
    this.batch?.items.forEach((item) => {
      if (item.plan) disableRun(item.plan);
    });
    if (this.batch) {
      this.batch = {
        ...this.batch,
        items: this.batch.items.map((item) =>
          item.status === "pending" || item.status === "running"
            ? {
                index: item.index,
                sql: item.sql,
                status: "cancelled" as const,
                error: "Batch cancelled.",
              }
            : item,
        ),
      };
      this.state = { type: "BATCH_LOADED", payload: this.batch };
    } else if (this.plan)
      this.state = { type: "PLAN_LOADED", payload: this.plan };
    const panel = this.panel!;
    const root = vscode.Uri.joinPath(this.context.extensionUri, "dist");
    panel.webview.html = doomHtml({
      cspSource: panel.webview.cspSource,
      root: panel.webview
        .asWebviewUri(vscode.Uri.joinPath(root, "doom"))
        .toString(),
      script: panel.webview
        .asWebviewUri(vscode.Uri.joinPath(root, "doom.js"))
        .toString(),
      style: panel.webview
        .asWebviewUri(vscode.Uri.joinPath(root, "doom.css"))
        .toString(),
      nonce: randomBytes(24).toString("base64"),
    });
    panel.reveal(vscode.ViewColumn.Beside, false);
  }
  post(message: ExtensionToWebview) {
    if (this.ready && !this.doomActive)
      void this.panel?.webview.postMessage(message);
  }
  send(message: ExtensionToWebview) {
    if (!this.panel) this.open();
    if (this.doomActive) {
      this.doomActive = false;
      this.ready = false;
      this.renderPlan(this.panel!);
    }
    this.state = message;
    if (this.ready && !this.doomActive)
      void this.panel?.webview.postMessage(message);
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
