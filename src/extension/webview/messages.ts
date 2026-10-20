import type { QueryPlan } from "../../../packages/plan-core/src/types";
import type { PlanBatch } from "../../../packages/plan-core/src/batch";
export type ExtensionToWebview =
  | { type: "PLAN_LOADED"; payload: QueryPlan }
  | { type: "BATCH_LOADED"; payload: PlanBatch }
  | { type: "PLAN_ERROR"; message: string }
  | { type: "LOADING"; loading: boolean };
export type WebviewToExtension =
  | { type: "WEBVIEW_READY" }
  | { type: "EXPORT_PLAN" }
  | { type: "IMPORT_PLAN" }
  | { type: "LOAD_SAMPLE" }
  | { type: "CANCEL_BATCH" };
