import type { AnalysisRule } from "../contracts";
export const estimatedIndexesRule: AnalysisRule = {
  id: "estimate.native-missing-index",
  basis: "estimated",
  requires: ["missingIndexes"],
  evaluate: ({ facts }) => {
    if (!facts.missingIndexes.length) return;
    const evidence: Record<string, string | number> = {};
    facts.missingIndexes.forEach((index, position) => {
      const prefix = `Candidate ${position + 1}`;
      evidence[`${prefix} relation`] = index.relation;
      if (index.equality.length)
        evidence[`${prefix} equality columns`] = index.equality.join(", ");
      if (index.inequality.length)
        evidence[`${prefix} inequality columns`] = index.inequality.join(", ");
      if (index.include.length)
        evidence[`${prefix} included columns`] = index.include.join(", ");
      if (index.impact !== undefined)
        evidence[`${prefix} optimizer estimated impact (%)`] = index.impact;
    });
    return {
      title: "SQL Server suggests missing-index candidates",
      evidence,
      suggestion:
        "Review these native optimizer candidates against existing indexes and the wider read/write workload. Consolidate overlapping candidates, decide key order and assess index size and maintenance before testing any change.",
      limitation:
        "Native impact is an untested optimizer cost estimate, not a promised runtime improvement. Suggestions omit some index types and do not establish suitable key ordering or workload-wide benefit. This is statement-level advice linked to its result operator; no index DDL is generated or executed.",
      confidence: "medium",
      severity: "info",
    };
  },
};
