import type { AnalysisRule } from "../contracts";
export const predicateExpressionRule: AnalysisRule = {
  id: "predicate.expression-review",
  requires: ["predicate", "filtering"],
  evaluate: ({ node, facts: f, thresholds: t }) => {
    if (f.conversions.length) return;
    const inefficient =
      f.examinedRows !== undefined &&
      f.rejectedRows !== undefined &&
      f.examinedRows >= t.examinedRows &&
      f.rejectedRows / f.examinedRows >= t.rejectedFraction;
    if (
      inefficient &&
      ["TABLE_SCAN", "INDEX_ACCESS"].includes(node.category) &&
      f.predicate &&
      /\b(lower|upper|coalesce|isnull|convert|cast|datepart|year)\s*\(/i.test(
        f.predicate,
      )
    )
      return {
        title: "Review expressions in a heavily filtering predicate",
        evidence: { Predicate: f.predicate },
        suggestion:
          "Check whether predicate expressions operate on indexed columns. Consider a semantics-preserving range predicate or an engine-supported expression/computed-column index.",
        limitation:
          "This is a textual candidate, not dialect AST proof. Functions on constants, expression indexes and collation rules may make it harmless.",
        confidence: "low",
        severity: "info",
      };
  },
};
