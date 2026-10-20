import type { QueryPlan } from "../../packages/plan-core/src/types";
export type PlanView = "compact" | "cards";
export const nodeSize = (view: PlanView) =>
  view === "compact"
    ? { width: 164, height: 132 }
    : { width: 236, height: 145 };
export function presentEdges(plan: QueryPlan, view: PlanView) {
  const rows = new Map(plan.nodes.map((n) => [n.id, n.estimates?.rows]));
  const maxRows = Math.max(
    1,
    ...plan.edges.map((e) => rows.get(e.target) ?? 0),
  );
  return plan.edges.map((e) => ({
    id: e.id,
    source: view === "compact" ? e.target : e.source,
    target: view === "compact" ? e.source : e.target,
    type: view === "compact" ? "step" : "smoothstep",
    label: view === "compact" ? undefined : e.relationship,
    style: {
      strokeWidth:
        view === "compact"
          ? 1 + (4 * Math.log1p(rows.get(e.target) ?? 0)) / Math.log1p(maxRows)
          : 1.5,
    },
  }));
}
