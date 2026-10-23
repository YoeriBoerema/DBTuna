import type { QueryPlan } from "../../plan-core/src/types";
import { extractFacts } from "./facts";
import { partialConsumption } from "./graphContext";
import {
  defaultThresholds,
  type Analysis,
  type AnalysisRule,
  type Finding,
  type RuleContext,
} from "./contracts";
export { defaultThresholds } from "./contracts";
export type { Analysis, Finding } from "./contracts";
import { cardinalityRule } from "./rules/cardinality";
import { spillRule } from "./rules/spill";
import { repeatedAccessRule } from "./rules/repeatedAccess";
import { filteringRule } from "./rules/filtering";
import { predicateRule } from "./rules/predicate";
import { nativeWarningsRule } from "./rules/nativeWarnings";
import { predicateExpressionRule } from "./rules/predicateExpression";

export const analysisRules: readonly AnalysisRule[] = [
  cardinalityRule,
  spillRule,
  repeatedAccessRule,
  filteringRule,
  predicateRule,
  nativeWarningsRule,
  predicateExpressionRule,
];
export function analyzePlan(
  plan: QueryPlan,
  options: Partial<typeof defaultThresholds> = {},
): Analysis {
  const thresholds = { ...defaultThresholds, ...options };
  for (const value of Object.values(thresholds))
    if (!Number.isFinite(value) || value <= 0)
      throw Error("Analysis thresholds must be finite and positive.");
  if (thresholds.rejectedFraction > 1 || thresholds.cardinalityRatio <= 1)
    throw Error("Invalid analysis ratio threshold.");
  const findings: Finding[] = [];
  const coverage = [
    "Schema, existing indexes, statistics freshness and workload were not inspected. No query or database changes are made.",
  ];
  const ruleCoverage = analysisRules.map((rule) => ({
    ruleId: rule.id,
    evaluatedNodes: 0,
    skippedNodes: 0,
    reasons: [] as string[],
  }));
  if (!["postgresql", "sqlserver"].includes(plan.database.engine))
    return {
      findings,
      ruleCoverage,
      coverage: ["This database engine has no analysis fact extractor."],
    };
  if (!plan.nodes.some((node) => node.actuals))
    coverage.push(
      "Actual counters are unavailable; runtime rules need an actual plan.",
    );
  if (plan.source.synthetic)
    coverage.push("This is a synthetic sample; findings describe sample data.");
  const partial = partialConsumption(plan);
  for (const node of plan.nodes) {
    const facts = extractFacts(plan, node);
    const context: RuleContext = {
      node,
      facts,
      thresholds,
      partiallyConsumed: partial.has(node.id),
    };
    analysisRules.forEach((rule, index) => {
      const report = ruleCoverage[index];
      const missing = rule.requires.filter(
        (key) => !facts.availability[key].available,
      );
      const reasons = missing.map(
        (key) =>
          facts.availability[key].reason || `${key} evidence is unavailable.`,
      );
      const inapplicable = rule.inapplicable?.(context);
      if (inapplicable) reasons.push(inapplicable);
      if (reasons.length) {
        report.skippedNodes++;
        report.reasons = [...new Set([...report.reasons, ...reasons])];
        return;
      }
      report.evaluatedNodes++;
      const result = rule.evaluate(context);
      if (result)
        findings.push({
          ...result,
          ruleId: rule.id,
          ruleVersion: 1,
          nodeIds: [node.id],
        });
    });
  }
  coverage.push(
    "Spill, filtering and predicate checks only run when native evidence is present. No findings does not mean the query is optimal.",
  );
  const rank = { warning: 0, info: 1 };
  findings.sort(
    (a, b) =>
      rank[a.severity] - rank[b.severity] ||
      a.ruleId.localeCompare(b.ruleId) ||
      a.nodeIds[0].localeCompare(b.nodeIds[0]),
  );
  return { findings, coverage, ruleCoverage };
}
