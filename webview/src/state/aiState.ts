import type { AiResult } from "../../../src/extension/webview/messages";
export type AiState =
  | { status: "idle" }
  | { status: "pending"; requestId: string }
  | { status: "complete"; result: Extract<AiResult, { status: "complete" }> }
  | {
      status: "error" | "cancelled";
      result: Extract<AiResult, { status: "error" | "cancelled" }>;
    };
export type AiAction =
  { type: "start"; requestId: string } | { type: "result"; message: AiResult };
export function aiReducer(state: AiState, action: AiAction): AiState {
  if (action.type === "start")
    return { status: "pending", requestId: action.requestId };
  if (
    state.status !== "pending" ||
    state.requestId !== action.message.requestId
  )
    return state;
  const message = action.message;
  return message.status === "complete"
    ? { status: "complete", result: message }
    : { status: message.status, result: message };
}
