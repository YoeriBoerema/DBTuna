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
}: {
  plan: QueryPlan;
  view: PlanView;
  revision: number;
}) {
  const canvasId = "plan-" + useId().replace(/:/g, "");
  const { nodes, setNodes, edges, selected, busy, error, flow, pick } =
    usePlanLayout(plan, view, revision);
  const navigate = (id: string) => {
    const node = nodes.find((candidate) => candidate.id === id);
    if (!node) return;
    pick(id);
    const measured = flow.getNode(id)?.measured;
    void flow.setCenter(
      node.position.x + (measured?.width ?? nodeSize(view).width) / 2,
      node.position.y + (measured?.height ?? nodeSize(view).height) / 2,
      { zoom: 1, duration: 250 },
    );
  };
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
            onNodeDragStart={(_, n) => pick(n.id)}
            onNodesChange={(changes) => {
              // React Flow can select on pointer-down even if movement prevents
              // a click. Route that selection through the details state too.
              const selection = changes.find(
                (change) => change.type === "select" && change.selected,
              );
              if (selection?.type === "select") pick(selection.id);
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
        <Details
          plan={plan}
          node={plan.nodes.find((n) => n.id === selected)}
          onNavigate={navigate}
        />
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
            onChange={(e) => navigate(e.target.value)}
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
