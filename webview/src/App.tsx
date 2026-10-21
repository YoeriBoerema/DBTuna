import React, { useEffect, useState, useCallback, useRef, useId } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  MarkerType,
  useReactFlow,
  useUpdateNodeInternals,
  useNodesInitialized,
  type NodeProps,
  type Node,
  type Edge,
} from "@xyflow/react";
import ELK from "elkjs/lib/elk.bundled.js";
import { OperatorIcon } from "./OperatorIcon";
import { nodeSize, presentEdges, type PlanView } from "./graphPresentation";
import { estimatedPlanCost } from "../../packages/plan-core/src/metrics";
import type { PlanBatch } from "../../packages/plan-core/src/batch";
import type { PlanNode, QueryPlan } from "../../packages/plan-core/src/types";
import type {
  ExtensionToWebview,
  WebviewToExtension,
} from "../../src/extension/webview/messages";
import "@xyflow/react/dist/style.css";
import "./style.css";
declare function acquireVsCodeApi(): {
  postMessage(m: WebviewToExtension): void;
  getState():
    { plan?: QueryPlan; batch?: PlanBatch; view?: PlanView } | undefined;
  setState(s: { plan?: QueryPlan; batch?: PlanBatch; view: PlanView }): void;
};
const api = acquireVsCodeApi();
const elk = new ELK();
const fmt = (v: unknown) =>
  v === undefined
    ? "Not available"
    : typeof v === "number"
      ? v.toLocaleString()
      : String(v);
type FlowNode = Node<{ operator: PlanNode; view: PlanView }, "operator">;
function Operator({ id, data, selected }: NodeProps<FlowNode>) {
  const n = data.operator;
  const compact = data.view === "compact";
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    const frame = requestAnimationFrame(() => updateNodeInternals(id));
    return () => cancelAnimationFrame(frame);
  }, [id, data.view, updateNodeInternals]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [tooltip, setTooltip] = useState<{ left: number; top: number }>();
  const tooltipId = useId();
  const dismiss = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
    setTooltip(undefined);
  }, []);
  useEffect(() => {
    dismiss();
    return () => clearTimeout(timer.current);
  }, [n, data.view, dismiss]);
  useEffect(() => {
    if (!tooltip) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", escape);
    window.addEventListener("wheel", dismiss, true);
    return () => {
      window.removeEventListener("keydown", escape);
      window.removeEventListener("wheel", dismiss, true);
    };
  }, [tooltip, dismiss]);
  return (
    <div
      className={
        "operator " +
        n.category +
        (compact ? " compact" : "") +
        (selected ? " selected" : "")
      }
      aria-describedby={tooltip ? tooltipId : undefined}
      onPointerEnter={(event) => {
        const element = event.currentTarget;
        clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          const rect = element.getBoundingClientRect();
          setTooltip({
            left: Math.max(8, Math.min(rect.left, window.innerWidth - 276)),
            top: Math.max(
              8,
              Math.min(
                rect.bottom + 10,
                window.innerHeight - (n.actuals ? 330 : 260),
              ),
            ),
          });
        }, 500);
      }}
      onPointerLeave={dismiss}
      onPointerDown={dismiss}
    >
      <Handle
        type="target"
        position={compact ? Position.Right : Position.Top}
      />
      {compact ? (
        <div className="operator-icon">
          <OperatorIcon node={n} />
        </div>
      ) : (
        <div className="node-category">
          {n.category.replace("_", " ")}
          <span>↗</span>
        </div>
      )}
      <strong>{n.label}</strong>
      <div className="relation">
        {n.object?.relation || n.object?.index || "Plan operation"}
      </div>
      {compact ? (
        <div className="compact-metrics">
          <span>Cost: {fmt(n.estimates?.totalCost)}</span>
          <span>
            {n.actuals
              ? "Actual rows: " + fmt(n.actuals.rows)
              : "Est. rows: " + fmt(n.estimates?.rows)}
          </span>
        </div>
      ) : (
        <div className="node-metrics">
          <span>
            {fmt(n.actuals ? n.actuals.rows : n.estimates?.rows)}
            <small>{n.actuals ? "actual rows" : "est. rows"}</small>
          </span>
          <span>
            {fmt(n.estimates?.totalCost)}
            <small>total cost</small>
          </span>
        </div>
      )}
      <Handle
        type="source"
        position={compact ? Position.Left : Position.Bottom}
      />
      {tooltip &&
        createPortal(
          <div
            id={tooltipId}
            role="tooltip"
            className="cost-tooltip"
            style={tooltip}
          >
            <strong>Cost estimates</strong>
            <div className="tooltip-operation">{n.label}</div>
            <dl>
              {Object.entries({
                ...(n.estimates?.costScope === "subtree"
                  ? {}
                  : { "Startup cost": n.estimates?.startupCost }),
                [n.estimates?.costScope === "subtree"
                  ? "Subtree cost"
                  : "Total cost"]: n.estimates?.totalCost,
                "Estimated CPU cost": n.estimates?.cpuCost,
                "Estimated I/O cost": n.estimates?.ioCost,
                "Estimated rows": n.estimates?.rows,
                "Row width (bytes)": n.estimates?.rowWidth,
                ...(n.actuals
                  ? {
                      "Actual rows": n.actuals.rows,
                      "Actual executions": n.actuals.loops,
                    }
                  : {}),
              }).map(([key, value]) => (
                <React.Fragment key={key}>
                  <dt>{key}</dt>
                  <dd>{fmt(value)}</dd>
                </React.Fragment>
              ))}
            </dl>
            <small>Optimizer cost units · not milliseconds</small>
          </div>,
          document.body,
        )}
    </div>
  );
}
const nodeTypes = { operator: Operator };
function AiAdvice({ plan, node }: { plan: QueryPlan; node: PlanNode }) {
  const [context, setContext] = useState("");
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] =
    useState<Extract<ExtensionToWebview, { type: "AI_RESULT" }>>();
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
      setPending(false);
      setResult(message);
    };
    window.addEventListener("message", listener);
    return () => {
      window.removeEventListener("message", listener);
      if (active.current)
        api.postMessage({ type: "AI_CANCEL", requestId: active.current });
    };
  }, [plan.id, node.id]);
  return (
    <section className="ai-assistance" aria-label="AI Assistance">
      <h3>AI Assistance</h3>
      <p className="ai-disclosure">
        Sends this query, its plan, the selected operator and your context to
        OpenAI. API usage charges apply.
      </p>
      {!plan.query?.trim() && (
        <>
          <label htmlFor={queryId}>SQL query</label>
          <textarea
            id={queryId}
            value={query}
            maxLength={1024 * 1024}
            rows={4}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Paste the SQL for this imported plan"
          />
        </>
      )}
      <label htmlFor={contextId}>Additional context (optional)</label>
      <textarea
        id={contextId}
        value={context}
        maxLength={4000}
        rows={3}
        onChange={(e) => setContext(e.target.value)}
        placeholder="What should the advice focus on?"
      />
      <div className="ai-controls">
        <button
          className="primary"
          disabled={pending || !(plan.query?.trim() || query.trim())}
          onClick={() => {
            const requestId = crypto.randomUUID();
            active.current = requestId;
            setPending(true);
            setResult(undefined);
            api.postMessage({
              type: "AI_ANALYZE",
              requestId,
              planId: plan.id,
              nodeId: node.id,
              context,
              ...(!plan.query?.trim() ? { query } : {}),
            });
          }}
        >
          {pending ? "Analyzing..." : "Get AI advice"}
        </button>
        {pending && (
          <button
            onClick={() => {
              if (active.current)
                api.postMessage({
                  type: "AI_CANCEL",
                  requestId: active.current,
                });
            }}
          >
            Cancel
          </button>
        )}
        <button onClick={() => api.postMessage({ type: "AI_SETTINGS" })}>
          Settings
        </button>
      </div>
      <div aria-live="polite" aria-busy={pending}>
        {pending && <p>Waiting for OpenAI...</p>}
        {result?.error && (
          <p role="alert" className="ai-error">
            {result.error}
          </p>
        )}
        {result?.text && (
          <>
            <div className="ai-output">{result.text}</div>
            <small>
              Model: {result.model} - review proposed SQL before use
            </small>
            {result.incomplete && (
              <p className="ai-error">
                Response reached its output limit; advice may be incomplete.
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
function Details({ node, plan }: { node?: PlanNode; plan: QueryPlan }) {
  if (!node)
    return (
      <aside>
        <h2>Operator details</h2>
        <p>Select an operation to inspect its estimates and properties.</p>
      </aside>
    );
  return (
    <aside>
      <div className="eyebrow">OPERATOR DETAILS</div>
      <h2>{node.label}</h2>
      <span className="tag">{node.category}</span>
      <h3>Identification</h3>
      <dl>
        {Object.entries({
          "Native operator": node.nativeType,
          Relation: node.object?.relation,
          Schema: node.object?.schema,
          Alias: node.object?.alias,
          Index: node.object?.index,
        }).map(([k, v]) => (
          <React.Fragment key={k}>
            <dt>{k}</dt>
            <dd>{fmt(v)}</dd>
          </React.Fragment>
        ))}
      </dl>
      <h3>
        Cost estimates <span>optimizer units</span>
      </h3>
      <dl>
        {Object.entries({
          ...(node.estimates?.costScope === "subtree"
            ? {}
            : { "Startup cost": node.estimates?.startupCost }),
          [node.estimates?.costScope === "subtree"
            ? "Subtree cost"
            : "Total cost"]: node.estimates?.totalCost,
          "Estimated CPU cost": node.estimates?.cpuCost,
          "Estimated I/O cost": node.estimates?.ioCost,
          "Estimated rows": node.estimates?.rows,
          "Row width (bytes)": node.estimates?.rowWidth,
        }).map(([k, v]) => (
          <React.Fragment key={k}>
            <dt>{k}</dt>
            <dd>{fmt(v)}</dd>
          </React.Fragment>
        ))}
      </dl>
      <h3>
        Actual execution{" "}
        <span>{node.actuals ? "measured metrics" : "not measured"}</span>
      </h3>
      <dl>
        {Object.entries({
          [node.actuals?.rowsScope === "total"
            ? "Actual rows (total)"
            : "Actual rows (per loop)"]: node.actuals?.rows,
          ...(node.actuals?.elapsedTimeMs !== undefined
            ? { "Max thread elapsed (ms)": node.actuals.elapsedTimeMs }
            : {}),
          ...(node.actuals?.cpuTimeMs !== undefined
            ? { "CPU across threads (ms)": node.actuals.cpuTimeMs }
            : {}),
          [node.actuals?.rowsScope === "total" ? "Executions (sum)" : "Loops"]:
            node.actuals?.loops,
          ...(node.actuals?.rowsScope === "total"
            ? {}
            : {
                "Startup per loop (ms)": node.actuals?.startupTimeMs,
                "Total per loop (ms)": node.actuals?.totalTimeMs,
              }),
        }).map(([k, v]) => (
          <React.Fragment key={k}>
            <dt>{k}</dt>
            <dd>{fmt(v)}</dd>
          </React.Fragment>
        ))}
      </dl>
      <h3>Native attributes</h3>
      {Object.entries(node.properties).map(([k, v]) => (
        <details key={k}>
          <summary>{k}</summary>
          <pre>{JSON.stringify(v, null, 2)}</pre>
        </details>
      ))}
      <AiAdvice key={plan.id + ":" + node.id} plan={plan} node={node} />
    </aside>
  );
}
function PlanWorkspace({
  plan,
  view,
  revision,
  fitRevision,
}: {
  plan: QueryPlan;
  view: PlanView;
  revision: number;
  fitRevision: number;
}) {
  const [nodes, setNodes] = useState<FlowNode[]>([]),
    [edges, setEdges] = useState<Edge[]>([]),
    [selected, setSelected] = useState<string>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const canvasId = "plan-" + useId().replace(/:/g, "");
  const flow = useReactFlow();
  const initialized = useNodesInitialized();
  const [layoutReady, setLayoutReady] = useState(0);
  useEffect(() => {
    if (!initialized || !layoutReady) return;
    let nextFrame = 0;
    const frame = requestAnimationFrame(() => {
      nextFrame = requestAnimationFrame(
        () =>
          void flow.fitView({
            padding: 0.2,
            maxZoom: view === "compact" ? 1.25 : 2,
          }),
      );
    });
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(nextFrame);
    };
  }, [initialized, layoutReady, view]);
  useEffect(() => {
    void flow.fitView({ padding: 0.2, maxZoom: view === "compact" ? 1.25 : 2 });
  }, [fitRevision]);
  useEffect(() => {
    if (!plan) return;
    let stale = false;
    setBusy(true);
    const selection = plan.nodes.some((n) => n.id === selected)
      ? selected
      : plan.rootNodeIds[0];
    setSelected(selection);
    elk
      .layout({
        id: "plan",
        layoutOptions: {
          "elk.algorithm": "layered",
          "elk.direction": view === "compact" ? "RIGHT" : "DOWN",
          "elk.spacing.nodeNode": view === "compact" ? "36" : "45",
          "elk.layered.spacing.nodeNodeBetweenLayers":
            view === "compact" ? "86" : "65",
          "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
          "elk.layered.crossingMinimization.forceNodeModelOrder": "true",
        },
        children: plan.nodes.map((n) => ({
          id: n.id,
          ...nodeSize(view),
        })),
        edges: plan.edges.map((e) => ({
          id: e.id,
          sources: [e.source],
          targets: [e.target],
        })),
      })
      .then((layout) => {
        if (stale) return;
        setNodes(
          plan.nodes.map((n) => {
            const p = layout.children?.find((c) => c.id === n.id);
            return {
              id: n.id,
              type: "operator",
              position: { x: p?.x || 0, y: p?.y || 0 },
              data: { operator: n, view },
              selected: n.id === selection,
            };
          }),
        );
        setEdges(
          presentEdges(plan, view).map((e) => ({
            ...e,
            markerEnd:
              view === "compact"
                ? {
                    type: MarkerType.ArrowClosed,
                    width: 18,
                    height: 18,
                    color: "currentColor",
                    markerUnits: "userSpaceOnUse",
                  }
                : undefined,
          })),
        );
        setBusy(false);
        setLayoutReady((value) => value + 1);
      })
      .catch((e) => {
        if (!stale) {
          setError(String(e));
          setBusy(false);
        }
      });
    return () => {
      stale = true;
    };
  }, [plan, revision, view]);
  const pick = useCallback((id: string) => {
    setSelected(id);
    setNodes((current) =>
      current.map((n) => ({ ...n, selected: n.id === id })),
    );
  }, []);
  return (
    <div className="plan-workspace">
      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}
      {busy && (
        <div className="layout-status" role="status">
          Laying out plan…
        </div>
      )}
      <div className="workspace">
        <section className="canvas">
          <div className="canvas-caption">
            <span>EXECUTION GRAPH</span>
            <small>
              {view === "compact"
                ? "← Data flow · thicker lines = more estimated rows"
                : "Parent → child · optimizer cost units"}
            </small>
          </div>
          <ReactFlow
            id={canvasId}
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodeClick={(_, n) => pick(n.id)}
            onNodesChange={(changes) => {
              setNodes((current) =>
                current.map((n) => {
                  const c = changes.find(
                    (c) => c.type === "position" && c.id === n.id,
                  );
                  return c && c.type === "position" && c.position
                    ? { ...n, position: c.position }
                    : n;
                }),
              );
            }}
            fitView
            minZoom={0.08}
            maxZoom={2}
            nodesDraggable
            nodesConnectable={false}
          >
            <Background gap={22} size={1} />
            <Controls showInteractive={false} />
            {view === "cards" && (
              <MiniMap
                pannable
                zoomable
                nodeColor="var(--vscode-charts-blue, #6296df)"
              />
            )}
          </ReactFlow>
        </section>
        <Details plan={plan} node={plan.nodes.find((n) => n.id === selected)} />
      </div>
      <footer>
        <span>
          <i /> {plan.nodes.length} operators · {plan.edges.length}{" "}
          relationships
        </span>
        <label>
          Navigate{" "}
          <select
            aria-label="Select operator"
            value={selected || ""}
            onChange={(e) => {
              pick(e.target.value);
              const n = nodes.find((n) => n.id === e.target.value);
              if (n)
                void flow.setCenter(
                  n.position.x + nodeSize(view).width / 2,
                  n.position.y + nodeSize(view).height / 2,
                  {
                    zoom: 1,
                    duration: 250,
                  },
                );
            }}
          >
            {plan.nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.id} · {n.label}
              </option>
            ))}
          </select>
        </label>
        <span>
          {plan.source.synthetic ? "Synthetic sample" : plan.source.format} ·{" "}
          {selected ? "Selected " + selected : "No selection"}
        </span>
      </footer>
    </div>
  );
}
function ExecutablePlan(props: React.ComponentProps<typeof PlanWorkspace>) {
  const { plan } = props;
  const [actual, setActual] = useState<QueryPlan>();
  const [mode, setMode] = useState<"estimated" | "actual">("estimated");
  const [status, setStatus] = useState<
    "idle" | "confirming" | "running" | "complete" | "error" | "cancelled"
  >("idle");
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const active = useRef<string | undefined>(undefined);
  const started = useRef(0);
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
      setStatus(message.status);
      setError(message.error || "");
      if (message.status === "running") {
        started.current = Date.now();
        setElapsed(0);
      } else {
        active.current = undefined;
        if (message.actualPlan) {
          setActual(message.actualPlan);
          setMode("actual");
        }
        if (message.elapsedMs !== undefined) setElapsed(message.elapsedMs);
      }
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
      () => setElapsed(Date.now() - started.current),
      250,
    );
    return () => clearInterval(timer);
  }, [status]);
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
          disabled={pending || plan.metadata.executionAvailable !== true}
          title={
            plan.metadata.executionAvailable === true
              ? "Executes the displayed query on its original connection; INSERT changes persist."
              : String(
                  plan.metadata.executionUnavailableReason ||
                    "Run Explain on a live SELECT or INSERT first.",
                )
          }
          onClick={() => {
            const requestId = crypto.randomUUID();
            active.current = requestId;
            setStatus("confirming");
            setError("");
            setMode("estimated");
            api.postMessage({ type: "RUN_ACTUAL", planId: plan.id, requestId });
          }}
        >
          {actual
            ? "Run again and collect actual plan"
            : "Run query and collect actual plan"}
        </button>
        {pending && (
          <button
            onClick={() => {
              if (active.current)
                api.postMessage({
                  type: "CANCEL_ACTUAL",
                  requestId: active.current,
                });
            }}
          >
            Cancel execution
          </button>
        )}
        <span role="status">
          {status === "confirming"
            ? "Awaiting confirmation..."
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
function LazyPlan({
  plan,
  view,
  revision,
  fitRevision,
}: {
  plan: QueryPlan;
  view: PlanView;
  revision: number;
  fitRevision: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "400px" },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} className="lazy-plan">
      {visible ? (
        <ReactFlowProvider>
          <ExecutablePlan
            plan={plan}
            view={view}
            revision={revision}
            fitRevision={fitRevision}
          />
        </ReactFlowProvider>
      ) : (
        <div className="plan-placeholder">Plan ready · scroll to explore</div>
      )}
    </div>
  );
}
function App() {
  const saved = api.getState();
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
                ? `${firstPlan.database.engine.toUpperCase()} ${firstPlan.database.version || ""} · ${String(firstPlan.metadata.connectionLabel || batch?.connectionLabel || "Local plan")}`
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
