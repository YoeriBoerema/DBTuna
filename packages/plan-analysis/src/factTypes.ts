import type { PlanNode } from "../../plan-core/src/types";
export type FactCapability =
  "cardinality" | "spill" | "repeated" | "filtering" | "predicate" | "warnings";
export type Availability = { available: boolean; reason?: string };
export type NodeFacts = {
  rowsPerExecution?: number;
  totalRows?: number;
  executions?: number;
  examinedRows?: number;
  rejectedRows?: number;
  spillEvidence: Record<string, string | number>;
  warnings: string[];
  conversions: { expression: string; source: "operator" | "statement" }[];
  predicate?: string;
  availability: Record<FactCapability, Availability>;
};
export function counterFacts(node: PlanNode): NodeFacts {
  const facts: NodeFacts = {
    spillEvidence: {},
    warnings: [],
    conversions: [],
    availability: Object.fromEntries(
      [
        "cardinality",
        "spill",
        "repeated",
        "filtering",
        "predicate",
        "warnings",
      ].map((key) => [
        key,
        { available: false, reason: "Native evidence is unavailable." },
      ]),
    ) as NodeFacts["availability"],
  };
  const actual = node.actuals;
  if (actual?.loops !== undefined && actual.loops > 0) {
    facts.executions = actual.loops;
    if (actual.rows !== undefined && actual.rowsScope === "per_execution") {
      facts.rowsPerExecution = actual.rows;
      facts.totalRows = actual.rows * actual.loops;
    } else if (actual.rows !== undefined && actual.rowsScope === "total") {
      facts.rowsPerExecution = actual.rows / actual.loops;
      facts.totalRows = actual.rows;
    }
  }
  return facts;
}
export function finishFacts(facts: NodeFacts, node: PlanNode): NodeFacts {
  for (const key of [
    "rowsPerExecution",
    "totalRows",
    "executions",
    "examinedRows",
    "rejectedRows",
  ] as const)
    if (facts[key] !== undefined && !Number.isFinite(facts[key]))
      delete facts[key];
  facts.availability.cardinality = {
    available:
      facts.rowsPerExecution !== undefined &&
      node.estimates?.rows !== undefined,
    reason:
      facts.rowsPerExecution === undefined || node.estimates?.rows === undefined
        ? "Estimated rows, per-execution row scope or comparable thread counters are unavailable."
        : undefined,
  };
  facts.availability.repeated = {
    available: facts.executions !== undefined && facts.totalRows !== undefined,
    reason: "Complete row and execution counters are required.",
  };
  facts.availability.filtering = {
    available:
      facts.examinedRows !== undefined && facts.rejectedRows !== undefined,
    reason: "Comparable examined and rejected row counters are required.",
  };
  facts.availability.predicate = {
    available: !!facts.predicate || facts.conversions.length > 0,
    reason: "No predicate expression or conversion warning is reported.",
  };
  return facts;
}
