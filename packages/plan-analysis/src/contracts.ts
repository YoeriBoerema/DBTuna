import type { PlanNode } from "../../plan-core/src/types";
import type { NodeFacts, FactCapability } from "./factTypes";
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
  ruleCoverage: RuleCoverage[];
};

export type Thresholds = typeof defaultThresholds;
export type RuleCoverage = {
  ruleId: string;
  evaluatedNodes: number;
  skippedNodes: number;
  reasons: string[];
};
export type FindingDetails = Omit<
  Finding,
  "ruleId" | "ruleVersion" | "nodeIds"
>;
export type RuleContext = {
  node: PlanNode;
  facts: NodeFacts;
  thresholds: Thresholds;
  partiallyConsumed: boolean;
};
export type AnalysisRule = {
  id: string;
  requires: FactCapability[];
  inapplicable?: (context: RuleContext) => string | undefined;
  evaluate: (context: RuleContext) => FindingDetails | undefined;
};
