import React from "react";
import { createRoot } from "react-dom/client";
import { ReactFlowProvider } from "@xyflow/react";
import type { PlanView } from "./graphPresentation";
import { api } from "./vscodeApi";
import { ExecutablePlan } from "./components/ExecutablePlan";
import { BatchPlans } from "./components/BatchPlans";
import { usePlanContent } from "./hooks/usePlanContent";
import "@xyflow/react/dist/style.css";
import "./style.css";
function App() {
  const {
    plan,
    batch,
    firstPlan,
    running,
    view,
    setView,
    error,
    busy,
    revision,
    setRevision,
  } = usePlanContent();
  return (
    <main>
      <header>
        <div className="brand">
          <b className="brand-icon">⌘</b>
          <div>
            <h1>
              DBTuna{" "}
              <span>
                /{" "}
                {batch && batch.items.length > 1
                  ? "Query batch"
                  : "Execution plan"}
              </span>
            </h1>
            <div className="subtitle">
              {firstPlan
                ? `${firstPlan.database.engine.toUpperCase()} ${firstPlan.database.version || ""} · ${String(firstPlan.application.connectionLabel || batch?.connectionLabel || "Local plan")}`
                : batch?.connectionLabel || "Database plan visualizer"}
            </div>
          </div>
        </div>
        <div className="actions">
          <select
            aria-label="Plan view"
            value={view}
            onChange={(event) => setView(event.target.value as PlanView)}
          >
            <option value="compact">Compact horizontal</option>
            <option value="cards">Cards · top down</option>
          </select>
          <button
            disabled={!firstPlan}
            onClick={() => setRevision((v) => v + 1)}
          >
            Auto layout
          </button>
          {running && (
            <button onClick={() => api.postMessage({ type: "CANCEL_BATCH" })}>
              Cancel batch
            </button>
          )}
          {(!batch || batch.items.length <= 1) && (
            <button
              className="primary"
              disabled={!plan && !batch}
              onClick={() => api.postMessage({ type: "EXPORT_PLAN" })}
            >
              Export ↗
            </button>
          )}
        </div>
      </header>
      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}
      {busy && (
        <div role="status" className="loading">
          Preparing execution plan…
        </div>
      )}
      {batch ? (
        <BatchPlans batch={batch} view={view} revision={revision} />
      ) : plan ? (
        <div className="single-plan">
          <ReactFlowProvider>
            <ExecutablePlan
              key={plan.id}
              plan={plan}
              view={view}
              revision={revision}
            />
          </ReactFlowProvider>
        </div>
      ) : (
        <div className="empty">
          <div className="empty-mark">⌘</div>
          <div className="eyebrow">A CLEARER VIEW OF YOUR QUERY</div>
          <h2>
            See how your database
            <br />
            plans your SQL.
          </h2>
          <p>
            Explore operations, follow relationships, and inspect estimates.
            <br />
            Start with a local plan. No database connection needed.
          </p>
          <div>
            <button
              className="primary"
              onClick={() => api.postMessage({ type: "LOAD_SAMPLE" })}
            >
              Explore sample plan →
            </button>
          </div>
          <small>Or select SQL and run “DBTuna: Explain Query”</small>
        </div>
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
