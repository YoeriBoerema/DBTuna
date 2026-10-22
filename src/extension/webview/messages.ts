import type { Advice } from "../../../packages/plan-core/src/advice";
import { SQL_LIMITS, AI_LIMITS } from "../../../packages/plan-core/src/limits";
import { z } from "zod";
import type { QueryPlan } from "../../../packages/plan-core/src/types";
import type { PlanBatch } from "../../../packages/plan-core/src/batch";
export const webviewMessageSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.enum([
        "WEBVIEW_READY",
        "EXIT_DOOM",
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
      context: z.string().max(AI_LIMITS.contextCharacters),
      query: z.string().max(SQL_LIMITS.characters).optional(),
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
export type ExecutionOutcome =
  | { status: "running"; actualPlan?: never; elapsedMs?: never; error?: never }
  | {
      status: "complete";
      actualPlan: QueryPlan;
      elapsedMs: number;
      error?: never;
    }
  | {
      status: "error" | "cancelled";
      error: string;
      actualPlan?: never;
      elapsedMs?: never;
    };
export type AiOutcome =
  | { status: "complete"; advice: Advice; model: string; error?: never }
  | {
      status: "error" | "cancelled";
      error: string;
      advice?: never;
      model?: never;
    };
export type ExecutionResult = {
  type: "EXECUTION_RESULT";
  planId: string;
  requestId: string;
} & ExecutionOutcome;
export type AiResult = {
  type: "AI_RESULT";
  requestId: string;
  planId: string;
  nodeId: string;
} & AiOutcome;
export type ExtensionToWebview =
  | ExecutionResult
  | AiResult
  | { type: "PLAN_LOADED"; payload: QueryPlan }
  | { type: "BATCH_LOADED"; payload: PlanBatch }
  | { type: "PLAN_ERROR"; message: string }
  | { type: "LOADING"; loading: boolean };
