import type { AnalysisRule } from "../contracts";
export const estimatedRepeatedRule: AnalysisRule = {
  id: "estimate.repeated-access",
  basis: "estimated",
  requires: ["estimates", "estimatedExecutions"],
  inapplicable: ({ node, partiallyConsumed }) =>
    partiallyConsumed
      ? "Potential partial consumption makes repeated-work estimates uncertain."
      : !["TABLE_SCAN", "INDEX_ACCESS"].includes(node.category)
        ? "Only direct scan/index access is assessed."
        : undefined,
  evaluate: ({ node, facts: f, thresholds: t }) => {
    const executions = f.estimatedExecutions!;
    const rows = executions * node.estimates!.rows!;
    if (
      !Number.isFinite(rows) ||
      executions < t.repeatedExecutions ||
      rows < t.repeatedRows
    )
      return;
    return {
      title: "Potential repeated access from estimates",
      evidence: {
        "Estimated executions": executions,
        "Estimated total rows returned": rows,
        Basis: f.estimatedExecutionSource!,
      },
      suggestion:
        "Review the outer input and inner access path of the loop. Check whether reducing outer rows or using an appropriate existing index could reduce repeated work.",
      limitation:
        "These are optimizer estimates or a direct nested-loop inference, not measured execution counts. Caching, early termination and runtime choices can change the work; repeated seeks can be efficient.",
      confidence: "low",
      severity: "info",
    };
  },
};
