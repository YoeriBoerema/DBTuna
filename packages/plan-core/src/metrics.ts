import type { QueryPlan } from "./types";
// Only sum independent roots; child costs already contribute to subtree costs.
export function estimatedPlanCost(plan: QueryPlan): number | undefined {
  let total = 0;
  for (const id of plan.rootNodeIds) {
    const cost = plan.nodes.find((node) => node.id === id)?.estimates
      ?.totalCost;
    if (cost === undefined) return undefined;
    total += cost;
  }
  return total;
}
