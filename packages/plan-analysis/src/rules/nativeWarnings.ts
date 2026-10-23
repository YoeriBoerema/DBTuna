import type { AnalysisRule } from "../contracts";
export const nativeWarningsRule: AnalysisRule = {
  id: "native.warning",
  requires: ["warnings"],
  evaluate: ({ facts: f }) => {
    if (f.warnings.length)
      return {
        title: "SQL Server operator warnings reported",
        evidence: { Warnings: [...new Set(f.warnings)].sort().join(", ") },
        suggestion:
          "Inspect the native warning attributes and validate the relevant engine-specific remedy against the workload.",
        limitation:
          "The presence of a warning alone does not measure its performance impact.",
        confidence: "medium",
        severity: "warning",
      };
  },
};
