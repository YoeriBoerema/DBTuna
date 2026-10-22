import type { QueryPlan } from "../../plan-core/src/types";
export interface QueryPlanAdapter {
  readonly id: string;
  readonly displayName: string;
  canParse(input: unknown): boolean;
  parse(input: unknown): QueryPlan;
  parseStatements?(input: unknown): QueryPlan[];
}
