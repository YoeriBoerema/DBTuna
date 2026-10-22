import { useEffect, useState, useCallback } from "react";
import {
  useReactFlow,
  useNodesInitialized,
  MarkerType,
  type Node,
  type Edge,
} from "@xyflow/react";
import ELK from "elkjs/lib/elk.bundled.js";
import type {
  PlanNode,
  QueryPlan,
} from "../../../packages/plan-core/src/types";
import { nodeSize, presentEdges, type PlanView } from "../graphPresentation";
export type FlowNode = Node<{ operator: PlanNode; view: PlanView }, "operator">;
const elk = new ELK();
export function usePlanLayout(
  plan: QueryPlan,
  view: PlanView,
  revision: number,
  fitRevision: number,
) {
  const [nodes, setNodes] = useState<FlowNode[]>([]),
    [edges, setEdges] = useState<Edge[]>([]),
    [selected, setSelected] = useState<string>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
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
  return { nodes, setNodes, edges, selected, busy, error, flow, pick };
}
