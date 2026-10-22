import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ReactFlowProvider } from "@xyflow/react";
import { estimatedPlanCost } from "../../packages/plan-core/src/metrics";
import type { PlanBatch } from "../../packages/plan-core/src/batch";
import type { QueryPlan } from "../../packages/plan-core/src/types";
import type { ExtensionToWebview } from "../../src/extension/webview/messages";
import type { PlanView } from "./graphPresentation";
import { api } from "./vscodeApi";
import { fmt } from "./format";
import { ExecutablePlan } from "./components/ExecutablePlan";
import { LazyPlan } from "./components/LazyPlan";
import "@xyflow/react/dist/style.css";
import "./style.css";
function App() {
  const [saved] = useState(() => api.getState());
  const [view, setView] = useState<PlanView>(
    saved?.view === "cards" ? "cards" : "compact",
  );
  const [content, setContent] = useState<{
    plan?: QueryPlan;
    batch?: PlanBatch;
  }>(saved?.batch ? { batch: saved.batch } : { plan: saved?.plan });
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0),
    [fitRevision] = useState(0);
  const { plan, batch } = content;
  const firstPlan = plan || batch?.items.find((item) => item.plan)?.plan;
  const running = !!batch?.items.some(
    (item) => item.status === "pending" || item.status === "running",
  );
  const completed =
    batch?.items.filter((item) => item.status === "complete").length || 0;
  const failed =
    batch?.items.filter((item) => item.status === "error").length || 0;
  useEffect(() => {
    const listener = (event: MessageEvent<ExtensionToWebview>) => {
      const m = event.data;
      if (m.type === "PLAN_LOADED") {
        setContent({ plan: m.payload });
        setError("");
        setBusy(false);
      } else if (m.type === "BATCH_LOADED") {
        setContent((current) => {
          const previous = current.batch;
          const next = m.payload;
          if (previous?.id !== next.id) return { batch: next };
          return {
            batch: {
              ...next,
              items: next.items.map((item, i) => {
                const before = previous.items[i];
                return before?.plan &&
                  item.plan &&
                  before.plan.id === item.plan.id &&
                  JSON.stringify(before.plan) === JSON.stringify(item.plan)
                  ? { ...item, plan: before.plan }
                  : item;
              }),
            },
          };
        });
        setError("");
        setBusy(false);
      } else if (m.type === "PLAN_ERROR") {
        setError(m.message);
        setBusy(false);
      } else if (m.type === "LOADING") setBusy(m.loading);
    };
    window.addEventListener("message", listener);
    api.postMessage({ type: "WEBVIEW_READY" });
    return () => window.removeEventListener("message", listener);
  }, []);
  useEffect(() => {
    api.setState({ ...content, view });
  }, [content, view]);
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
          <button onClick={() => api.postMessage({ type: "AI_SETTINGS" })}>
            AI Assistance
          </button>
          <span className="estimated">Plans</span>
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
        <>
          <div className="batch-summary" role="status">
            {batch.items.length}{" "}
            {batch.items.length === 1 ? "query" : "queries"} · {completed}{" "}
            planned{failed ? ` · ${failed} failed` : ""}
            {running
              ? " · planning…"
              : batch.items.some((item) => item.status === "cancelled")
                ? " · cancelled"
                : " · finished"}
            <small>
              Explain collects estimates only. Use a query's Run action to
              execute it and collect an actual plan; INSERT changes persist.
            </small>
          </div>
          <div className="batch-list">
            {batch.items.map((item) => (
              <section
                key={batch.id + ":" + item.index}
                className="query-section"
                aria-label={"Query " + item.index}
              >
                <div className="query-heading">
                  <h2>Query {item.index}</h2>
                  <span className={"query-status " + item.status}>
                    {item.status === "complete"
                      ? "Planned"
                      : item.status === "pending"
                        ? "Queued"
                        : item.status === "running"
                          ? "Planning…"
                          : item.status === "error"
                            ? "Failed"
                            : "Cancelled"}
                  </span>
                  {item.plan && (
                    <span className="query-cost">
                      Plan cost: {fmt(estimatedPlanCost(item.plan))}
                    </span>
                  )}
                </div>
                <details className="query-sql">
                  <summary aria-label={"SQL for query " + item.index}>
                    {item.sql.replace(/\s+/g, " ").slice(0, 180)}
                    {item.sql.length > 180 ? "…" : ""}
                  </summary>
                  <pre>{item.sql}</pre>
                </details>
                {item.plan ? (
                  <LazyPlan
                    plan={item.plan}
                    view={view}
                    revision={revision}
                    fitRevision={fitRevision}
                  />
                ) : item.error ? (
                  <div
                    role={item.status === "error" ? "alert" : "status"}
                    className="query-error"
                  >
                    {item.error}
                  </div>
                ) : (
                  <div className="query-pending">
                    {item.status === "running"
                      ? "Requesting estimated query plan…"
                      : "Waiting for earlier queries…"}
                  </div>
                )}
              </section>
            ))}
          </div>
        </>
      ) : plan ? (
        <div className="single-plan">
          <ReactFlowProvider>
            <ExecutablePlan
              key={plan.id}
              plan={plan}
              view={view}
              revision={revision}
              fitRevision={fitRevision}
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
