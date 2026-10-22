import { aiReducer } from "../state/aiState";
import { useEffect, useState, useRef, useId, useReducer } from "react";
import type {
  QueryPlan,
  PlanNode,
} from "../../../packages/plan-core/src/types";
import type { ExtensionToWebview } from "../../../src/extension/webview/messages";
import { api } from "../vscodeApi";
export function useAiAdvice(plan: QueryPlan, node: PlanNode) {
  const [context, setContext] = useState("");
  const [query, setQuery] = useState("");
  const [state, dispatch] = useReducer(aiReducer, { status: "idle" });
  const pending = state.status === "pending";
  const result = "result" in state ? state.result : undefined;
  const active = useRef<string | undefined>(undefined);
  const contextId = useId(),
    queryId = useId();
  useEffect(() => {
    const listener = (event: MessageEvent<ExtensionToWebview>) => {
      const message = event.data;
      if (
        message.type !== "AI_RESULT" ||
        message.requestId !== active.current ||
        message.planId !== plan.id ||
        message.nodeId !== node.id
      )
        return;
      active.current = undefined;
      dispatch({ type: "result", message });
    };
    window.addEventListener("message", listener);
    return () => {
      window.removeEventListener("message", listener);
      if (active.current)
        api.postMessage({ type: "AI_CANCEL", requestId: active.current });
    };
  }, [plan.id, node.id]);
  const analyze = () => {
    if (active.current) return;
    const requestId = crypto.randomUUID();
    active.current = requestId;
    dispatch({ type: "start", requestId });
    api.postMessage({
      type: "AI_ANALYZE",
      requestId,
      planId: plan.id,
      nodeId: node.id,
      context,
      ...(!plan.query?.trim() ? { query } : {}),
    });
  };
  const cancel = () => {
    if (active.current)
      api.postMessage({ type: "AI_CANCEL", requestId: active.current });
  };
  return {
    context,
    setContext,
    query,
    setQuery,
    pending,
    result,
    contextId,
    queryId,
    analyze,
    cancel,
  };
}
