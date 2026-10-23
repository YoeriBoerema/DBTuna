import type { AnalysisRule } from "../contracts";
export const spillRule: AnalysisRule = {
  id: "memory.spill",
  requires: ["spill"],
  evaluate: ({ facts: f }) => {
    if (Object.keys(f.spillEvidence).length)
      return {
        title: "Disk-backed sort or hash work reported",
        evidence: f.spillEvidence,
        suggestion:
          "Review input row counts, estimates and indexes that could reduce sorting or hashing before considering engine-specific memory tuning.",
        limitation:
          "A spill is an observed condition, not proof that increasing memory is safe or beneficial.",
        confidence: "high",
        severity: "warning",
      };
  },
};
