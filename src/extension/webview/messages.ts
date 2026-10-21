import { z } from "zod";
import type { QueryPlan } from "../../../packages/plan-core/src/types";
import type { PlanBatch } from "../../../packages/plan-core/src/batch";
export const webviewMessageSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.enum([
        "WEBVIEW_READY",
        "EXPORT_PLAN",
        "IMPORT_PLAN",
        "LOAD_SAMPLE",
        "CANCEL_BATCH",
        "AI_SETTINGS",
      ]),
    })
    .strict(),
  z
    .object({
      type: z.literal("EXPORT_ACTUAL"),
      planId: z.string().min(1).max(200),
    })
    .strict(),
  z
    .object({
      type: z.literal("RUN_ACTUAL"),
      planId: z.string().min(1).max(200),
      requestId: z.string().min(1).max(100),
    })
    .strict(),
  z
    .object({
      type: z.literal("CANCEL_ACTUAL"),
      requestId: z.string().min(1).max(100),
    })
    .strict(),
  z
    .object({
      type: z.literal("AI_ANALYZE"),
      requestId: z.string().min(1).max(100),
      planId: z.string().min(1).max(200),
      nodeId: z.string().min(1).max(200),
      context: z.string().max(4000),
      query: z
        .string()
        .max(1024 * 1024)
        .optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("AI_CANCEL"),
      requestId: z.string().min(1).max(100),
    })
    .strict(),
]);
export type WebviewToExtension = z.infer<typeof webviewMessageSchema>;
export type AiRequest = Extract<WebviewToExtension, { type: "AI_ANALYZE" }>;
export type ExtensionToWebview =
  | {
      type: "EXECUTION_RESULT";
      planId: string;
      requestId: string;
      status: "running" | "complete" | "cancelled" | "error";
      actualPlan?: QueryPlan;
      elapsedMs?: number;
      error?: string;
    }
  | { type: "PLAN_LOADED"; payload: QueryPlan }
  | { type: "BATCH_LOADED"; payload: PlanBatch }
  | { type: "PLAN_ERROR"; message: string }
  | { type: "LOADING"; loading: boolean }
  | {
      type: "AI_RESULT";
      requestId: string;
      planId: string;
      nodeId: string;
      text?: string;
      model?: string;
      error?: string;
      incomplete?: boolean;
    };
