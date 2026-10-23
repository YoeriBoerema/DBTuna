import type { AnalysisRule } from "../contracts";
export const estimatedMemoryRule: AnalysisRule = {
  id: "estimate.sort-hash-input",
  basis: "estimated",
  requires: ["estimates"],
  inapplicable: ({ facts }) =>
    facts.memoryOperation ? undefined : "No sort/hash operation is identified.",
  evaluate: ({ node, inputs, facts, thresholds: t }) => {
    const rows = inputs.length
      ? inputs.every((input) => input.estimates?.rows !== undefined)
        ? inputs.reduce((sum, input) => sum + input.estimates!.rows!, 0)
        : undefined
      : node.estimates?.rows;
    if (
      rows === undefined ||
      !Number.isFinite(rows) ||
      rows < t.estimatedWorkRows
    )
      return;
    const bytes =
      inputs.length &&
      inputs.every((input) => input.estimates?.rowWidth !== undefined)
        ? inputs.reduce(
            (sum, input) =>
              sum + input.estimates!.rows! * input.estimates!.rowWidth!,
            0,
          )
        : undefined;
    return {
      title: "Large estimated sort/hash workload",
      evidence: {
        Operation: facts.memoryOperation!,
        [inputs.length
          ? "Estimated input rows (sum)"
          : "Estimated operator rows"]: rows,
        ...(bytes !== undefined && Number.isFinite(bytes)
          ? { "Estimated input data bytes": bytes }
          : {}),
      },
      suggestion:
        "Review input cardinality, projected columns and existing access paths that could reduce sort/hash work. Collect an actual plan to assess runtime memory and spills.",
      limitation:
        "Input volume is not a memory-grant prediction. Hash build sides, compression, parallelism and algorithm details matter. This does not establish a spill or justify raising memory limits.",
      confidence: "low",
      severity: "info",
    };
  },
};
