import React, { useId } from "react";
import type { QueryPlan } from "../../../packages/plan-core/src/types";
import { ReactFlow, Background, Controls, MiniMap } from "@xyflow/react";
import { nodeSize, type PlanView } from "../graphPresentation";
import { Operator } from "./Operator";
import { Details } from "./Details";
import { usePlanLayout } from "../hooks/usePlanLayout";
const nodeTypes = { operator: Operator };
export function PlanWorkspace({
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
  const canvasId = "plan-" + useId().replace(/:/g, "");
  const { nodes, setNodes, edges, selected, busy, error, flow, pick } =
    usePlanLayout(plan, view, revision, fitRevision);
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
