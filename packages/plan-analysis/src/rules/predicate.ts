import type { AnalysisRule } from "../contracts";
export const predicateRule: AnalysisRule = {
  id: "predicate.plan-affecting-conversion",
  requires: ["predicate"],
  evaluate: ({ facts: f }) => {
    if (f.conversions.length)
      return {
        title: "SQL Server reports plan-affecting conversions",
        evidence: Object.fromEntries(
          f.conversions.map((conversion, index) => [
            `${conversion.source} conversion ${index + 1}`,
            conversion.expression,
          ]),
        ),
        suggestion:
          "Check parameter and column types. Prefer matching types where semantics allow, and compare plans before changing SQL.",
        limitation:
          "These warnings do not prove the conversions are the primary bottleneck.",
        confidence: "medium",
        severity: "warning",
      };
  },
};
