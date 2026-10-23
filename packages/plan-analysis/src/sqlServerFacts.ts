import type { PlanNode, QueryPlan } from "../../plan-core/src/types";
import { counterFacts, finishFacts } from "./factTypes";
import { object, number, entries, type ObjectValue } from "./native";
export function sqlServerFacts(plan: QueryPlan, node: PlanNode) {
  const facts = counterFacts(node);
  const p = node.properties;

  const native = entries(p);

  const threads = native
    .filter(
      ([key, value]) => key === "RunTimeCountersPerThread" && object(value),
    )
    .map(([, value]) => value as ObjectValue);
  // Arrays have one containing entry, so collect their members explicitly.
  for (const [key, value] of native)
    if (key === "RunTimeCountersPerThread" && Array.isArray(value))
      threads.push(...value.filter(object));
  if (threads.length > 1) facts.rowsPerExecution = undefined;
  if (threads.length && facts.totalRows !== undefined) {
    const reads = threads.map((thread) => number(thread.ActualRowsRead));
    if (reads.every((value) => value !== undefined)) {
      facts.examinedRows = (reads as number[]).reduce(
        (sum, value) => sum + value,
        0,
      );
      if (facts.examinedRows >= facts.totalRows)
        facts.rejectedRows = facts.examinedRows - facts.totalRows;
    }
  }
  const scopedEntries = [
    ...native.map((entry) => ({ entry, source: "operator" as const })),
    ...(plan.rootNodeIds[0] === node.id
      ? entries(plan.metadata).map((entry) => ({
          entry,
          source: "statement" as const,
        }))
      : []),
  ];
  const warningEntries = scopedEntries.flatMap(
    ({ entry: [key, value], source }) =>
      (Array.isArray(value) ? value : [value]).map((value) => ({
        key,
        value,
        source,
      })),
  );
  for (const { key, value, source } of warningEntries) {
    if (
      ["SpillToTempDb", "SortSpillDetails", "HashSpillDetails"].includes(key) &&
      (object(value) || value === "")
    )
      facts.spillEvidence[key] = "Reported by SQL Server";
    if (key === "PlanAffectingConvert" && object(value))
      facts.conversions.push({
        expression:
          typeof value.Expression === "string"
            ? value.Expression
            : "Plan-affecting conversion reported",
        source,
      });
    if (key === "Warnings" && object(value))
      facts.warnings.push(
        ...Object.keys(value).filter(
          (name) =>
            ![
              "SpillToTempDb",
              "SortSpillDetails",
              "HashSpillDetails",
              "PlanAffectingConvert",
            ].includes(name) &&
            value[name] !== false &&
            value[name] !== "false" &&
            value[name] !== "0",
        ),
      );
    if (key === "Predicate" && object(value)) {
      const scalar = entries(value).find(
        ([name, text]) => name === "ScalarString" && typeof text === "string",
      );
      if (scalar) facts.predicate = scalar[1] as string;
    }
  }
  facts.availability.spill = {
    available: !!node.actuals || Object.keys(facts.spillEvidence).length > 0,
    reason: "An actual SQL Server plan is needed for spill evidence.",
  };
  facts.availability.warnings = { available: true };
  return finishFacts(facts, node);
}
