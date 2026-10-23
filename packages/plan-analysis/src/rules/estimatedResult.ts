import type { AnalysisRule } from "../contracts";
export const estimatedResultRule: AnalysisRule = {
  id: "estimate.large-result",
  basis: "estimated",
  requires: ["estimates"],
  inapplicable: ({ node }) =>
    ["JOIN", "AGGREGATE", "APPEND", "MATERIALIZE"].includes(node.category)
      ? undefined
      : "This rule targets intermediate-result operators, not ordinary table scans.",
  evaluate: ({ node, inputs, thresholds: t }) => {
    const rows = node.estimates!.rows!;
    if (rows < t.estimatedRows) return;
    const inputRows = inputs.map((input) => input.estimates?.rows);
    const largest =
      inputRows.length >= 2 && inputRows.every((value) => value !== undefined)
        ? Math.max(...(inputRows as number[]))
        : undefined;
    const ratio =
      node.category === "JOIN" && largest !== undefined && largest > 0
        ? rows / largest
        : undefined;
    const expansion =
      ratio !== undefined && Number.isFinite(ratio) ? ratio : undefined;
    return {
      title:
        expansion !== undefined && expansion >= t.joinExpansionRatio
          ? "Potential join row expansion"
          : "Large estimated intermediate result",
      evidence: {
        "Estimated output rows": rows,
        ...(expansion !== undefined
          ? { "Output / largest input estimate": expansion }
          : {}),
      },
      suggestion:
        "Review join predicates, expected relationship cardinality and opportunities to reduce rows before downstream work. Confirm that the result size is intended.",
      limitation:
        "This is a volume estimate, not a measured bottleneck or proof of an incorrect join. Large results can be required; estimates and row goals may be inaccurate.",
      confidence: "low",
      severity: "info",
    };
  },
};
