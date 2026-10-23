import type { PlanNode, QueryPlan } from "../../plan-core/src/types";
import { counterFacts, finishFacts } from "./factTypes";
import { number } from "./native";

export function oracleFacts(plan: QueryPlan, node: PlanNode) {
  const facts = counterFacts(node),
    p = node.properties;
  // PX and adaptive alternatives do not offer a universally comparable
  // per-start estimate. Suppress ratios rather than infer worker row scopes.
  const ambiguous = plan.nodes.some(
    (n) =>
      n.category === "PARALLEL" ||
      n.properties["DBTuna inactive"] === true ||
      n.properties.DBTUNA_ADAPTIVE === 1 ||
      (number(n.properties.LAST_DEGREE) || 0) > 1,
  );
  if (ambiguous) {
    delete facts.rowsPerExecution;
    delete facts.totalRows;
    delete facts.executions;
  }
  if (/SORT|WINDOW/.test(node.nativeType)) facts.memoryOperation = "sort";
  else if (/HASH/.test(node.nativeType)) facts.memoryOperation = "hash";
  const temp = number(p.LAST_TEMPSEG_SIZE);
  if (node.actuals && temp !== undefined && temp > 0)
    facts.spillEvidence["Last temporary segment bytes"] = temp;
  if (
    node.actuals &&
    /^(?:ONE\s?PASS|MULTI[ -]?PASS)$/i.test(String(p.LAST_EXECUTION))
  )
    facts.spillEvidence["Last workarea execution"] = String(p.LAST_EXECUTION);
  // Access predicates can be index-supported expressions, so only residual
  // filters participate in the generic indexability heuristic.
  if (typeof p.FILTER_PREDICATES === "string")
    facts.predicate = p.FILTER_PREDICATES;
  facts.availability.spill = {
    available:
      !!node.actuals && ("LAST_EXECUTION" in p || "LAST_TEMPSEG_SIZE" in p),
    reason: "Oracle last-execution workarea statistics are unavailable.",
  };
  facts.availability.warnings = {
    available: false,
    reason:
      "Oracle plan notes are not equivalent to SQL Server structured performance warnings.",
  };
  facts.availability.missingIndexes = {
    available: false,
    reason:
      "Oracle has no equivalent native missing-index plan feed; schema and advisors were not consulted.",
  };
  const result = finishFacts(facts, node);
  result.availability.filtering = {
    available: false,
    reason:
      "Oracle buffer gets are not examined rows; comparable examined/rejected row counts are unavailable.",
  };
  if (ambiguous) {
    result.availability.cardinality.reason =
      "Parallel or inactive adaptive branches have uncertain estimate/runtime row scopes.";
    result.availability.repeated.reason =
      result.availability.cardinality.reason;
  }
  return result;
}
