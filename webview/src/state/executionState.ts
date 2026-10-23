import type { QueryPlan } from "../../../packages/plan-core/src/types";
import type { ExecutionResult } from "../../../src/extension/webview/messages";
type Measurements = {
  actual?: QueryPlan;
  elapsed: number;
  confirmation: "none" | "run" | "cancel";
  mode: "estimated" | "actual";
};
export type ExecutionState = Measurements &
  (
    | { status: "idle" }
    | { status: "preparing"; requestId: string }
    | { status: "running"; requestId: string; startedAt: number }
    | { status: "complete"; actual: QueryPlan }
    | { status: "error" | "cancelled"; error: string }
  );
export type ExecutionAction =
  | { type: "arm_run" | "arm_cancel" | "disarm" | "reset" }
  | { type: "select_mode"; mode: "estimated" | "actual" }
  | { type: "start"; requestId: string }
  | { type: "result"; message: ExecutionResult; now: number }
  | { type: "tick"; now: number };
export const initialExecutionState: ExecutionState = {
  status: "idle",
  elapsed: 0,
  confirmation: "none",
  mode: "estimated",
};
export function executionReducer(
  state: ExecutionState,
  action: ExecutionAction,
): ExecutionState {
  const pending = state.status === "preparing" || state.status === "running";
  switch (action.type) {
    case "reset":
      return initialExecutionState;
    case "arm_run":
      return pending ? state : { ...state, confirmation: "run" };
    case "arm_cancel":
      return pending ? { ...state, confirmation: "cancel" } : state;
    case "disarm":
      return { ...state, confirmation: "none" };
    case "select_mode":
      return action.mode === "actual" && !state.actual
        ? state
        : { ...state, mode: action.mode };
  }
  const measurements = {
    actual: state.actual,
    elapsed: state.elapsed,
    confirmation: "none" as const,
    mode: state.mode,
  };
  if (action.type === "start")
    return pending
      ? state
      : {
          ...measurements,
          mode: "estimated",
          status: "preparing",
          requestId: action.requestId,
        };
  if (action.type === "tick")
    return state.status === "running"
      ? { ...state, elapsed: Math.max(0, action.now - state.startedAt) }
      : state;
  if (
    (state.status !== "preparing" && state.status !== "running") ||
    state.requestId !== action.message.requestId
  )
    return state;
  const message = action.message;
  switch (message.status) {
    case "running":
      return {
        ...measurements,
        status: "running",
        requestId: message.requestId,
        startedAt: action.now,
        elapsed: 0,
      };
    case "complete":
      return {
        confirmation: "none",
        mode: "actual",
        status: "complete",
        actual: message.actualPlan,
        elapsed: message.elapsedMs,
      };
    case "cancelled":
    case "error":
      return { ...measurements, status: message.status, error: message.error };
  }
}
