import type { AnalysisRule } from "../contracts";
export const repeatedAccessRule: AnalysisRule = {
  id: "work.repeated-access",
  requires: ["repeated"],
  evaluate: ({ node, facts: f, thresholds: t }) => {
    if (
      ["TABLE_SCAN", "INDEX_ACCESS"].includes(node.category) &&
      f.executions !== undefined &&
      f.totalRows !== undefined &&
      f.executions >= t.repeatedExecutions &&
      f.totalRows >= t.repeatedRows
    )
      return {
        title: "Access operator executed many times",
        evidence: {
          Executions: f.executions,
          "Total rows returned": f.totalRows,
        },
        suggestion:
          "Review the parent join and repeated access path. Check whether an existing index, reduced outer input or a different query shape could reduce repeated work.",
        limitation:
          "Repeated seeks can be efficient. These counters alone do not establish a bottleneck.",
        confidence: "medium",
        severity: "info",
      };
  },
};
