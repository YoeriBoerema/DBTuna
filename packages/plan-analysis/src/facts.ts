import type { PlanNode, QueryPlan } from "../../plan-core/src/types";
import { postgresFacts } from "./postgresFacts";
import { sqlServerFacts } from "./sqlServerFacts";
import { counterFacts } from "./factTypes";
export type { NodeFacts } from "./factTypes";
export function extractFacts(plan: QueryPlan, node: PlanNode) {
  switch (plan.database.engine) {
    case "postgresql":
      return postgresFacts(node);
    case "sqlserver":
      return sqlServerFacts(plan, node);
    default:
      return counterFacts(node);
  }
}
