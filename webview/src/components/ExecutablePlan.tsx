import React from "react";
import { PlanWorkspace } from "./PlanWorkspace";
import { fmt } from "../format";
import { useActualExecution } from "../hooks/useActualExecution";
export function ExecutablePlan(
  props: React.ComponentProps<typeof PlanWorkspace>,
) {
  const { plan } = props;
  const {
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
  } = useActualExecution(plan);
  return (
    <div className="executable-plan">
      <div className="execution-controls">
        <div role="tablist" aria-label="Plan measurements">
          <button
            role="tab"
            aria-selected={mode === "estimated"}
            onClick={() => setMode("estimated")}
          >
            Estimated
          </button>
          <button
            role="tab"
            aria-selected={mode === "actual"}
            disabled={!actual}
            onClick={() => setMode("actual")}
          >
            Actual
          </button>
        </div>
        <button
          disabled={pending || plan.application.executionAvailable !== true}
          title={
            plan.application.executionAvailable === true
              ? "Executes the displayed query on its original connection; INSERT changes persist."
              : String(
                  plan.application.executionUnavailableReason ||
                    "Run Explain on a live SELECT or INSERT first.",
                )
          }
          onClick={run}
        >
          {armed
            ? "Are you sure?"
            : actual
              ? "Run again and collect actual plan"
              : "Run query and collect actual plan"}
        </button>
        {pending && (
          <button onClick={cancel}>
            {cancelArmed ? "Are you sure?" : "Cancel execution"}
          </button>
        )}
        <span role="status">
          {status === "preparing"
            ? "Preparing execution..."
            : status === "running"
              ? `Executing: ${(elapsed / 1000).toFixed(1)} s`
              : status === "complete"
                ? `Completed - client elapsed ${fmt(elapsed)} ms`
                : ""}
        </span>
      </div>
      {error && (
        <div role="alert" className="execution-error">
          {error}
        </div>
      )}
      <PlanWorkspace
        {...props}
        key={mode}
        plan={mode === "actual" && actual ? actual : plan}
      />
    </div>
  );
}
