import type { QueryPlan } from "../../../packages/plan-core/src/types";
import type { ExecutionResult } from "../../../src/extension/webview/messages";
type Measurements = { actual?: QueryPlan; elapsed: number };
export type ExecutionState = Measurements &
  (
    | { status: "idle" }
    | { status: "confirming"; requestId: string }
    | { status: "running"; requestId: string; startedAt: number }
    | { status: "complete"; actual: QueryPlan }
    | { status: "error" | "cancelled"; error: string }
  );
export type ExecutionAction =
  | { type: "start"; requestId: string }
  | { type: "result"; message: ExecutionResult; now: number }
  | { type: "tick"; now: number };
export const initialExecutionState: ExecutionState = {
  status: "idle",
  elapsed: 0,
};
export function executionReducer(
  state: ExecutionState,
  action: ExecutionAction,
): ExecutionState {
  const measurements = { actual: state.actual, elapsed: state.elapsed };
  if (action.type === "start")
    return {
      ...measurements,
      status: "confirming",
      requestId: action.requestId,
    };
  if (action.type === "tick")
    return state.status === "running"
      ? { ...state, elapsed: Math.max(0, action.now - state.startedAt) }
      : state;
  if (
    (state.status !== "confirming" && state.status !== "running") ||
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
        status: "complete",
        actual: message.actualPlan,
        elapsed: message.elapsedMs,
      };
    case "cancelled":
    case "error":
      return { ...measurements, status: message.status, error: message.error };
  }
}
