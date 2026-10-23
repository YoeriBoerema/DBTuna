import type { QueryPlan, PlanNode } from "../../plan-core/src/types";
import type { NodeFacts } from "./factTypes";

export function estimatedInputs(
  plan: QueryPlan,
  facts: Map<string, NodeFacts>,
) {
  const nodes = new Map(plan.nodes.map((node) => [node.id, node]));
  const inputs = new Map<string, PlanNode[]>();
  const inputEdges = new Map<string, QueryPlan["edges"]>();
  for (const edge of plan.edges) {
    const list = inputEdges.get(edge.source) || [];
    list.push(edge);
    inputEdges.set(edge.source, list);
    const child = nodes.get(edge.target);
    if (child)
      inputs.set(edge.source, [...(inputs.get(edge.source) || []), child]);
  }
  if (plan.database.engine === "postgresql")
    for (const parent of plan.nodes) {
      if (parent.nativeType !== "Nested Loop") continue;
      const edges = inputEdges.get(parent.id) || [];
      const outer = nodes.get(
        edges.find((edge) => edge.relationship === "Outer")?.target || "",
      );
      const inner = nodes.get(
        edges.find((edge) => edge.relationship === "Inner")?.target || "",
      );
      if (!inner || !outer || outer.estimates?.rows === undefined) continue;
      // Do not cross Materialize/Memoize: their cached rescans are not scan executions.
      if (!["TABLE_SCAN", "INDEX_ACCESS"].includes(inner.category)) continue;
      const f = facts.get(inner.id)!;
      f.estimatedExecutions = outer.estimates.rows;
      f.estimatedExecutionSource =
        "PostgreSQL outer row estimate; assumes one direct inner invocation per outer row";
      f.availability.estimatedExecutions = { available: true };
    }
  return inputs;
}
