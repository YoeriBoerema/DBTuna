import {
  executionReducer,
  initialExecutionState,
} from "../state/executionState";
import { useEffect, useState, useRef, useReducer } from "react";
import type { QueryPlan } from "../../../packages/plan-core/src/types";
import type { ExtensionToWebview } from "../../../src/extension/webview/messages";
import { api } from "../vscodeApi";
export function useActualExecution(plan: QueryPlan) {
  const [state, dispatch] = useReducer(executionReducer, initialExecutionState);
  const { actual, status, elapsed } = state;
  const error = "error" in state ? state.error : "";
  const [mode, setMode] = useState<"estimated" | "actual">("estimated");
  const active = useRef<string | undefined>(undefined);
  const pending = status === "confirming" || status === "running";
  useEffect(() => {
    const listener = (event: MessageEvent<ExtensionToWebview>) => {
      const message = event.data;
      if (
        message.type !== "EXECUTION_RESULT" ||
        message.planId !== plan.id ||
        message.requestId !== active.current
      )
        return;
      dispatch({ type: "result", message, now: Date.now() });
      if (message.status !== "running") active.current = undefined;
      if (message.status === "complete") setMode("actual");
    };
    window.addEventListener("message", listener);
    return () => {
      window.removeEventListener("message", listener);
      if (active.current)
        api.postMessage({ type: "CANCEL_ACTUAL", requestId: active.current });
    };
  }, [plan.id]);
  useEffect(() => {
    if (status !== "running") return;
    const timer = setInterval(
      () => dispatch({ type: "tick", now: Date.now() }),
      250,
    );
    return () => clearInterval(timer);
  }, [status]);
  const run = () => {
    if (active.current) return;
    const requestId = crypto.randomUUID();
    active.current = requestId;
    dispatch({ type: "start", requestId });
    setMode("estimated");
    api.postMessage({ type: "RUN_ACTUAL", planId: plan.id, requestId });
  };
  const cancel = () => {
    if (active.current)
      api.postMessage({ type: "CANCEL_ACTUAL", requestId: active.current });
  };
  return {
    actual,
    mode,
    setMode,
    status,
    error,
    elapsed,
    pending,
    run,
    cancel,
  };
}
