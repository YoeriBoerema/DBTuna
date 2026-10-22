import { planSchema } from "../../packages/plan-core/src/schema";
import type { QueryPlan } from "../../packages/plan-core/src/types";
import {
  batchSchema,
  type PlanBatch,
} from "../../packages/plan-core/src/batch";
import type { PlanView } from "./graphPresentation";
import type { WebviewToExtension } from "../../src/extension/webview/messages";
declare function acquireVsCodeApi(): {
  postMessage(m: WebviewToExtension): void;
  getState():
    { plan?: QueryPlan; batch?: PlanBatch; view?: PlanView } | undefined;
  setState(s: { plan?: QueryPlan; batch?: PlanBatch; view: PlanView }): void;
};
const vscode = acquireVsCodeApi();
// Restored snapshots have no live host binding after a window reload.
function restorePlan(plan?: QueryPlan): QueryPlan | undefined {
  if (!plan) return undefined;
  const parsed = planSchema.safeParse(plan);
  return parsed.success
    ? {
        ...parsed.data,
        application: { ...parsed.data.application, executionAvailable: false },
      }
    : undefined;
}
function restoreSavedBatch(batch?: PlanBatch): PlanBatch | undefined {
  if (!batch) return undefined;
  const parsed = batchSchema.safeParse(batch);
  if (!parsed.success) return undefined;
  return {
    ...parsed.data,
    items: parsed.data.items.map((item) => {
      if (item.status !== "complete") return item;
      const plan = restorePlan(item.plan);
      return plan
        ? { ...item, plan }
        : {
            index: item.index,
            sql: item.sql,
            status: "error" as const,
            error: "Saved plan could not be restored.",
          };
    }),
  };
}
export const api = {
  postMessage: vscode.postMessage.bind(vscode),
  setState: vscode.setState.bind(vscode),
  getState() {
    const state = vscode.getState();
    if (!state) return undefined;
    return {
      ...state,
      plan: restorePlan(state.plan),
      batch: restoreSavedBatch(state.batch),
    };
  },
};
