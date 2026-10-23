import type { QueryPlan } from "../../plan-core/src/types";
export function partialConsumption(plan: QueryPlan) {
  // Partial consumption can look like overestimation. Avoid diagnosing descendants
  // of limit, semi/anti and merge operators as cardinality errors.
  const partial = new Set<string>();
  const children = new Map<string, string[]>();
  for (const edge of plan.edges)
    children.set(edge.source, [
      ...(children.get(edge.source) || []),
      edge.target,
    ]);
  const mark = (id: string) => {
    if (partial.has(id)) return;
    partial.add(id);
    for (const child of children.get(id) || []) mark(child);
  };
  for (const node of plan.nodes)
    if (
      node.category === "LIMIT" ||
      /Merge Join|Semi|Anti/i.test(
        node.nativeType +
          String(
            node.properties.LogicalOp || node.properties["Join Type"] || "",
          ),
      )
    )
      mark(node.id);

  return partial;
}
