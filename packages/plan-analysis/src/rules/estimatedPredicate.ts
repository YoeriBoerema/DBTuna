import type { AnalysisRule } from "../contracts";

function hasColumnExpression(predicate: string): boolean {
  // Hide literals and parameters so lower('constant') and lower(@parameter) do
  // not become column-access advice. This is deliberately a narrow heuristic.
  const masked = predicate
    .replace(/(?:\b[NE])?'(?:''|[^'])*'/gi, " ")
    .replace(/@[\w]+/g, " ")
    .replace(/\[(?:[^\]]|\]\])*\]|"(?:[^"]|"")*"/g, "column_ref");
  for (const match of masked.matchAll(
    /\b(lower|upper|coalesce|isnull|convert|cast|datepart|year)\s*\(/gi,
  )) {
    const start = match.index! + match[0].length;
    let end = start,
      depth = 1;
    while (end < masked.length && depth) {
      if (masked[end] === "(") depth++;
      else if (masked[end] === ")") depth--;
      end++;
    }
    if (depth) continue;
    const argument = masked
      .slice(start, end - 1)
      .replace(/\b\w+\s*\(/g, " ")
      .replace(
        /\b(as|null|text|varchar|nvarchar|char|nchar|int|integer|bigint|smallint|decimal|numeric|float|real|date|datetime|timestamp|year|month|day)\b/gi,
        " ",
      );
    if (/[a-z_][\w]*/i.test(argument)) return true;
  }
  return false;
}
export const estimatedPredicateRule: AnalysisRule = {
  id: "estimate.predicate-expression",
  basis: "estimated",
  requires: ["predicate"],
  inapplicable: ({ node, facts }) =>
    node.actuals
      ? "Actual plans use the measured filtering predicate check instead."
      : facts.conversions.length
        ? "Native conversion warnings already describe this predicate risk."
        : !["TABLE_SCAN", "INDEX_ACCESS"].includes(node.category)
          ? "Only scan/index residual predicates are assessed."
          : undefined,
  evaluate: ({ facts }) => {
    if (!facts.predicate || !hasColumnExpression(facts.predicate)) return;
    return {
      title: "Potential index-access issue in predicate expression",
      evidence: { "Residual predicate": facts.predicate },
      suggestion:
        "Check whether the expression wraps a filtered column and whether existing indexes support it. Consider a semantics-preserving range predicate or an expression/computed-column index where appropriate.",
      limitation:
        "This textual candidate does not prove an index is unusable or missing. Expression indexes, optimizer simplification, constants, types and collation can make it harmless. Actual filtering and schema were not checked.",
      confidence: "low",
      severity: "info",
    };
  },
};
