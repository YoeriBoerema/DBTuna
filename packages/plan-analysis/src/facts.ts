import type { PlanNode, QueryPlan } from "../../plan-core/src/types";

export type NodeFacts = {
  rowsPerExecution?: number;
  totalRows?: number;
  executions?: number;
  examinedRows?: number;
  rejectedRows?: number;
  spillEvidence: Record<string, string | number>;
  warnings: string[];
  conversion?: string;
  predicate?: string;
};
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): value is ObjectValue =>
  !!value && typeof value === "object" && !Array.isArray(value);
const number = (value: unknown): number | undefined => {
  if (typeof value !== "number" && typeof value !== "string") return;
  if (value === "") return;
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 ? result : undefined;
};
// Properties are operator-local; never cross a native operator boundary.
function entries(value: unknown, output: [string, unknown][] = []): [string, unknown][] {
  if (Array.isArray(value)) value.forEach((child) => entries(child, output));
  else if (object(value)) for (const [key, child] of Object.entries(value)) {
    if (key === "RelOp" || key === "Plans") continue;
    output.push([key, child]);
    entries(child, output);
  }
  return output;
}

export function extractFacts(plan: QueryPlan, node: PlanNode): NodeFacts {
  const facts: NodeFacts = { spillEvidence: {}, warnings: [] };
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
  const p = node.properties;
  if (plan.database.engine === "postgresql") {
    if (p["Sort Space Type"] === "Disk")
      facts.spillEvidence["Sort space type"] = "Disk";
    for (const key of ["Disk Usage", "Hash Batches"]) {
      const value = number(p[key]);
      if (value !== undefined && value > (key === "Hash Batches" ? 1 : 0))
        facts.spillEvidence[key] = value;
    }
    if (actual?.rowsScope === "per_execution" && facts.totalRows !== undefined) {
      const removed = number(p["Rows Removed by Filter"]);
      if (removed !== undefined) {
        facts.rejectedRows = removed * facts.executions!;
        facts.examinedRows = facts.totalRows + facts.rejectedRows;
      }
    }
    if (typeof p.Filter === "string") facts.predicate = p.Filter;
  } else if (plan.database.engine === "sqlserver") {
    const native = entries(p);
    if (plan.rootNodeIds[0] === node.id) native.push(...entries(plan.metadata));
    const threads = native.filter(([key, value]) => key === "RunTimeCountersPerThread" && object(value))
      .map(([, value]) => value as ObjectValue);
    // Arrays have one containing entry, so collect their members explicitly.
    for (const [key, value] of native)
      if (key === "RunTimeCountersPerThread" && Array.isArray(value))
        threads.push(...value.filter(object));
    if (threads.length > 1) facts.rowsPerExecution = undefined;
    if (threads.length && facts.totalRows !== undefined) {
      const reads = threads.map((thread) => number(thread.ActualRowsRead));
      if (reads.every((value) => value !== undefined)) {
        facts.examinedRows = (reads as number[]).reduce((sum, value) => sum + value, 0);
        if (facts.examinedRows >= facts.totalRows)
          facts.rejectedRows = facts.examinedRows - facts.totalRows;
      }
    }
    const warningEntries = native.flatMap(([key, value]): [string, unknown][] =>
      Array.isArray(value) ? value.map((child) => [key, child]) : [[key, value]]);
    for (const [key, value] of warningEntries) {
      if (["SpillToTempDb", "SortSpillDetails", "HashSpillDetails"].includes(key) && (object(value) || value === ""))
        facts.spillEvidence[key] = "Reported by SQL Server";
      if (key === "PlanAffectingConvert" && object(value))
        facts.conversion = typeof value.Expression === "string" ? value.Expression : "Plan-affecting conversion reported";
      if (key === "Warnings" && object(value))
        facts.warnings.push(...Object.keys(value).filter((name) =>
          !["SpillToTempDb", "SortSpillDetails", "HashSpillDetails", "PlanAffectingConvert"].includes(name) &&
          value[name] !== false && value[name] !== "false" && value[name] !== "0"));
      if (key === "Predicate" && object(value)) {
        const scalar = entries(value).find(([name, text]) => name === "ScalarString" && typeof text === "string");
        if (scalar) facts.predicate = scalar[1] as string;
      }
    }
  }
  for (const key of ["rowsPerExecution", "totalRows", "executions", "examinedRows", "rejectedRows"] as const)
    if (facts[key] !== undefined && !Number.isFinite(facts[key])) delete facts[key];
  return facts;
}
