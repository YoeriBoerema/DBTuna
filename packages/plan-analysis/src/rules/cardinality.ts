import type { AnalysisRule } from "../contracts";
export const cardinalityRule: AnalysisRule = {
  id: "cardinality.discrepancy",
  requires: ["cardinality"],
  inapplicable: (context) =>
    context.partiallyConsumed
      ? "Potential partial consumption suppresses cardinality diagnosis."
      : undefined,
  evaluate: ({ node, facts: f, thresholds: t }) => {
    const expected = node.estimates?.rows;
    const observed = f.rowsPerExecution;
    if (expected !== undefined && observed !== undefined) {
      const ratio =
        Math.max(expected, observed) /
        Math.max(1, Math.min(expected, observed));
      if (
        ratio >= t.cardinalityRatio &&
        Math.abs(expected - observed) >= t.cardinalityDifference
      )
        return {
          title: "Large estimated-versus-actual row discrepancy",
          evidence: {
            "Estimated rows per execution": expected,
            "Actual rows per execution": observed,
            "Discrepancy factor (denominator floor 1)": ratio,
          },
          suggestion:
            "Investigate statistics, data skew, parameter values and correlated predicates before changing the query.",
          limitation:
            "This does not establish stale statistics. Partial execution and parameter-sensitive plans can also explain a discrepancy.",
          confidence: "medium",
          severity: "warning",
        };
    }
  },
};
