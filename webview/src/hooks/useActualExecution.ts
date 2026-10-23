import {
  executionReducer,
  initialExecutionState,
} from "../state/executionState";
import { useEffect, useRef, useReducer } from "react";
import type { QueryPlan } from "../../../packages/plan-core/src/types";
import type { ExtensionToWebview } from "../../../src/extension/webview/messages";
import { api } from "../vscodeApi";
export function useActualExecution(plan: QueryPlan) {
  const [state, dispatch] = useReducer(executionReducer, initialExecutionState);
  const { actual, status, elapsed } = state;
  const error = "error" in state ? state.error : "";
  const { mode, confirmation } = state;
  const armed = confirmation === "run";
  const cancelArmed = confirmation === "cancel";
  const setMode = (mode: "estimated" | "actual") =>
    dispatch({ type: "select_mode", mode });
  const active = useRef<string | undefined>(undefined);
  const pending = status === "preparing" || status === "running";
  useEffect(() => {
    dispatch({ type: "disarm" });
  }, [plan]);
  useEffect(() => {
    dispatch({ type: "reset" });
    const listener = (event: MessageEvent<ExtensionToWebview>) => {
      const message = event.data;
      if (
        message.type !== "EXECUTION_RESULT" ||
        message.planId !== plan.id ||
        message.requestId !== active.current
      )
        return;
      dispatch({ type: "result", message, now: Date.now() });
      if (message.status !== "running") {
        active.current = undefined;
      }
    };
    window.addEventListener("message", listener);
    return () => {
      window.removeEventListener("message", listener);
      if (active.current)
        api.postMessage({ type: "CANCEL_ACTUAL", requestId: active.current });
      active.current = undefined;
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
    if (active.current || plan.application.executionAvailable !== true) return;
    if (!armed) {
      dispatch({ type: "arm_run" });
      return;
    }
    const requestId = crypto.randomUUID();
    active.current = requestId;
    dispatch({ type: "start", requestId });
    api.postMessage({ type: "RUN_ACTUAL", planId: plan.id, requestId });
  };
  const cancel = () => {
    if (!active.current) return;
    if (!cancelArmed) {
      dispatch({ type: "arm_cancel" });
      return;
    }
    dispatch({ type: "disarm" });
    api.postMessage({ type: "CANCEL_ACTUAL", requestId: active.current });
  };
  return {
    actual,
    armed,
    cancelArmed,
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
