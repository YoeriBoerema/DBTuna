import { PLAN_LIMITS } from "../../../packages/plan-core/src/limits";
import * as vscode from "vscode";
import type { AdapterRegistry } from "../../../packages/adapter-sdk/src/registry";
import { bounded } from "../../../packages/plan-core/src/schema";
import { restoreBatch } from "../../../packages/plan-core/src/batch";
import type { PanelManager } from "../webview/panelManager";
import { decodePlan } from "./planText";
import { completedBatch } from "./batchExplain";
export class PlanFiles {
  constructor(
    private context: vscode.ExtensionContext,
    private registry: AdapterRegistry,
    private panels: PanelManager,
    private cancel: () => void,
  ) {}
  async loadSamplePlan() {
    const { context, registry, panels, cancel } = this;
    cancel();
    const data = await vscode.workspace.fs.readFile(
      vscode.Uri.joinPath(
        context.extensionUri,
        "fixtures",
        "postgres",
        "nested-loop.json",
      ),
    );
    panels.show(registry.parse(Buffer.from(data).toString("utf8")));
  }
  async importPlan() {
    const { registry, panels, cancel } = this;
    const uris = await vscode.window.showOpenDialog({
      filters: { "Execution plan": ["json", "sqlplan", "xml", "txt", "plan"] },
      canSelectMany: false,
    });
    if (!uris) return;
    const stat = await vscode.workspace.fs.stat(uris[0]);
    if (stat.size > PLAN_LIMITS.bytes) throw Error("Import exceeds 5 MiB.");
    const bytes = await vscode.workspace.fs.readFile(uris[0]);
    const text = decodePlan(bytes);
    const value =
      !/^[{[]/.test(text.trimStart()) &&
      (text.trimStart().startsWith("<") ||
        /\|\s*Id\s*\|\s*Operation\s*\|/i.test(text))
        ? text
        : bounded(text);
    const offline = (
      plan: import("../../../packages/plan-core/src/types").QueryPlan,
    ) => {
      plan.application.executionAvailable = false;
      return plan;
    };
    if (typeof value === "string") {
      const plans = registry.parseStatements(value).map(offline);
      cancel();
      panels.open();
      panels.showBatch(completedBatch(plans));
      return;
    }
    cancel();
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
  }
  async exportPlan() {
    const { panels } = this;
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
  }
}
