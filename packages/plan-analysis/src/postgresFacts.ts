import type { PlanNode } from "../../plan-core/src/types";
import { counterFacts, finishFacts } from "./factTypes";
import { number } from "./native";
export function postgresFacts(node: PlanNode) {
  const facts = counterFacts(node);
  const actual = node.actuals;
  const p = node.properties;
  if (["Sort", "Incremental Sort"].includes(node.nativeType))
    facts.memoryOperation = "sort";
  else if (
    node.nativeType === "Hash" ||
    ["Hashed", "Mixed"].includes(String(p.Strategy))
  )
    facts.memoryOperation = "hash";

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
  facts.availability.spill = {
    available: !!actual || Object.keys(facts.spillEvidence).length > 0,
    reason: "An actual PostgreSQL plan is needed for spill evidence.",
  };
  facts.availability.warnings = {
    available: false,
    reason:
      "PostgreSQL has no equivalent structured native-warning capability.",
  };
  return finishFacts(facts, node);
}
