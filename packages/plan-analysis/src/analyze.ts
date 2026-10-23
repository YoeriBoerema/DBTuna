import type { QueryPlan } from "../../plan-core/src/types";
import { extractFacts } from "./facts";

export type Finding = {
  ruleId: string;
  ruleVersion: 1;
  nodeIds: string[];
  severity: "warning" | "info";
  confidence: "high" | "medium" | "low";
  title: string;
  evidence: Record<string, string | number>;
  suggestion: string;
  limitation: string;
};
export const defaultThresholds = {
  cardinalityRatio: 10,
  cardinalityDifference: 1000,
  repeatedExecutions: 1000,
  repeatedRows: 100000,
  examinedRows: 10000,
  rejectedFraction: 0.9,
};
export type Analysis = {
  findings: Finding[];
  coverage: string[];
};

export function analyzePlan(plan: QueryPlan, options: Partial<typeof defaultThresholds> = {}): Analysis {
  const t = { ...defaultThresholds, ...options };
  for (const value of Object.values(t))
    if (!Number.isFinite(value) || value <= 0) throw Error("Analysis thresholds must be finite and positive.");
  if (t.rejectedFraction > 1 || t.cardinalityRatio <= 1)
    throw Error("Invalid analysis ratio threshold.");
  const findings: Finding[] = [];
  const coverage = ["Schema, existing indexes, statistics freshness and workload were not inspected. No query or database changes are made."];
  if (!["postgresql", "sqlserver"].includes(plan.database.engine))
    return { findings, coverage: ["This database engine has no analysis fact extractor."] };
  if (!plan.nodes.some((node) => node.actuals)) coverage.push("Actual counters are unavailable; runtime rules need an actual plan.");
  if (plan.source.synthetic) coverage.push("This is a synthetic sample; findings describe sample data.");
  // Partial consumption can look like overestimation. Avoid diagnosing descendants
  // of limit, semi/anti and merge operators as cardinality errors.
  const partial = new Set<string>();
  const children = new Map<string, string[]>();
  for (const edge of plan.edges) children.set(edge.source, [...(children.get(edge.source) || []), edge.target]);
  const mark = (id: string) => {
    if (partial.has(id)) return;
    partial.add(id);
    for (const child of children.get(id) || []) mark(child);
  };
  for (const node of plan.nodes)
    if (node.category === "LIMIT" || /Merge Join|Semi|Anti/i.test(node.nativeType + String(node.properties.LogicalOp || node.properties["Join Type"] || ""))) mark(node.id);
  let comparisons = 0;
  for (const node of plan.nodes) {
    const f = extractFacts(plan, node);
    const add = (ruleId: string, title: string, evidence: Finding["evidence"], suggestion: string,
      limitation: string, confidence: Finding["confidence"] = "high", severity: Finding["severity"] = "warning") =>
      findings.push({ ruleId, ruleVersion: 1, nodeIds: [node.id], title, evidence, suggestion, limitation, confidence, severity });
    const expected = node.estimates?.rows;
    const observed = f.rowsPerExecution;
    if (expected !== undefined && observed !== undefined && !partial.has(node.id)) {
      comparisons++;
      const ratio = Math.max(expected, observed) / Math.max(1, Math.min(expected, observed));
      if (ratio >= t.cardinalityRatio && Math.abs(expected - observed) >= t.cardinalityDifference)
        add("cardinality.discrepancy", "Large estimated-versus-actual row discrepancy",
          { "Estimated rows per execution": expected, "Actual rows per execution": observed, "Discrepancy factor (denominator floor 1)": ratio },
          "Investigate statistics, data skew, parameter values and correlated predicates before changing the query.",
          "This does not establish stale statistics. Partial execution and parameter-sensitive plans can also explain a discrepancy.", "medium");
    }
    if (Object.keys(f.spillEvidence).length)
      add("memory.spill", "Disk-backed sort or hash work reported", f.spillEvidence,
        "Review input row counts, estimates and indexes that could reduce sorting or hashing before considering engine-specific memory tuning.",
        "A spill is an observed condition, not proof that increasing memory is safe or beneficial.");
    if (["TABLE_SCAN", "INDEX_ACCESS"].includes(node.category) && f.executions !== undefined &&
      f.totalRows !== undefined && f.executions >= t.repeatedExecutions && f.totalRows >= t.repeatedRows)
      add("work.repeated-access", "Access operator executed many times",
        { Executions: f.executions, "Total rows returned": f.totalRows },
        "Review the parent join and repeated access path. Check whether an existing index, reduced outer input or a different query shape could reduce repeated work.",
        "Repeated seeks can be efficient. These counters alone do not establish a bottleneck.", "medium", "info");
    const inefficient = f.examinedRows !== undefined && f.rejectedRows !== undefined &&
      f.examinedRows >= t.examinedRows && f.rejectedRows / f.examinedRows >= t.rejectedFraction;
    if (inefficient)
      add("filter.discarded-rows", "Most examined rows were filtered out",
        { "Examined rows": f.examinedRows!, "Rejected rows": f.rejectedRows!, "Rejected fraction": f.rejectedRows! / f.examinedRows! },
        "Inspect the residual predicate and existing access paths. Consider a more selective predicate or suitable index after checking schema and workload.",
        "This is not a missing-index prescription. Filter counters describe logical row work, not physical disk reads.");
    if (f.conversion)
      add("predicate.plan-affecting-conversion", "SQL Server reports a plan-affecting conversion",
        { Expression: f.conversion }, "Check parameter and column types. Prefer matching types where semantics allow, and compare plans before changing SQL.",
        "The warning does not prove the conversion is the primary bottleneck.", "medium");
    else if (inefficient && ["TABLE_SCAN", "INDEX_ACCESS"].includes(node.category) && f.predicate &&
      /\b(lower|upper|coalesce|isnull|convert|cast|datepart|year)\s*\(/i.test(f.predicate))
      add("predicate.expression-review", "Review expressions in a heavily filtering predicate",
        { Predicate: f.predicate }, "Check whether predicate expressions operate on indexed columns. Consider a semantics-preserving range predicate or an engine-supported expression/computed-column index.",
        "This is a textual candidate, not dialect AST proof. Functions on constants, expression indexes and collation rules may make it harmless.", "low", "info");
    if (f.warnings.length)
      add("native.warning", "SQL Server operator warnings reported", { Warnings: [...new Set(f.warnings)].sort().join(", ") },
        "Inspect the native warning attributes and validate the relevant engine-specific remedy against the workload.",
        "The presence of a warning alone does not measure its performance impact.", "medium");
  }
  coverage.push(`${comparisons}/${plan.nodes.length} operators had comparable row estimates and actuals; missing scope, parallel counters and potentially partial consumption can prevent comparison.`);
  coverage.push("Spill, filtering and predicate checks only run when native evidence is present. No findings does not mean the query is optimal.");
  const rank = { warning: 0, info: 1 };
  findings.sort((a, b) => rank[a.severity] - rank[b.severity] || a.ruleId.localeCompare(b.ruleId) || a.nodeIds[0].localeCompare(b.nodeIds[0]));
  return { findings, coverage };
}
