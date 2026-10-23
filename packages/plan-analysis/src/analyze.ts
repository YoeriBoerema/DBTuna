import type { QueryPlan } from "../../plan-core/src/types";
import { extractFacts } from "./facts";
import { estimatedInputs } from "./estimatedContext";
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

import { estimatedResultRule } from "./rules/estimatedResult";
import { estimatedMemoryRule } from "./rules/estimatedMemory";
import { estimatedRepeatedRule } from "./rules/estimatedRepeated";
import { estimatedPredicateRule } from "./rules/estimatedPredicate";
import { estimatedIndexesRule } from "./rules/estimatedIndexes";

export const analysisRules: readonly AnalysisRule[] = [
  cardinalityRule,
  spillRule,
  repeatedAccessRule,
  filteringRule,
  predicateRule,
  nativeWarningsRule,
  predicateExpressionRule,
  estimatedResultRule,
  estimatedMemoryRule,
  estimatedRepeatedRule,
  estimatedPredicateRule,
  estimatedIndexesRule,
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
  if (!["postgresql", "sqlserver", "oracle"].includes(plan.database.engine))
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
  const nodeFacts = new Map(
    plan.nodes.map((node) => [node.id, extractFacts(plan, node)]),
  );
  const inputs = estimatedInputs(plan, nodeFacts);
  for (const node of plan.nodes) {
    const facts = nodeFacts.get(node.id)!;
    const context: RuleContext = {
      node,
      facts,
      thresholds,
      partiallyConsumed: partial.has(node.id),
      inputs: inputs.get(node.id) || [],
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
          basis: rule.basis || "measured",
          nodeIds: [node.id],
        });
    });
  }
  coverage.push(
    "Estimated risks describe optimizer predictions and textual candidates, not measured bottlenecks. Runtime checks still require actual counters. No findings does not mean the query is optimal.",
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
