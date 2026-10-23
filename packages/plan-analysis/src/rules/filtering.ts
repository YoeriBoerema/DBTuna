import type { AnalysisRule } from "../contracts";
export const filteringRule: AnalysisRule = {
  id: "filter.discarded-rows",
  requires: ["filtering"],
  evaluate: ({ facts: f, thresholds: t }) => {
    const inefficient =
      f.examinedRows !== undefined &&
      f.rejectedRows !== undefined &&
      f.examinedRows >= t.examinedRows &&
      f.rejectedRows / f.examinedRows >= t.rejectedFraction;
    if (inefficient)
      return {
        title: "Most examined rows were filtered out",
        evidence: {
          "Examined rows": f.examinedRows!,
          "Rejected rows": f.rejectedRows!,
          "Rejected fraction": f.rejectedRows! / f.examinedRows!,
        },
        suggestion:
          "Inspect the residual predicate and existing access paths. Consider a more selective predicate or suitable index after checking schema and workload.",
        limitation:
          "This is not a missing-index prescription. Filter counters describe logical row work, not physical disk reads.",
        confidence: "high",
        severity: "warning",
      };
  },
};
