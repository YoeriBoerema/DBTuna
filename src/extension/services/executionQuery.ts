import type { QueryPlan } from "../../../packages/plan-core/src/types";
import { databaseConnector } from "../connectors/registry";
export function executionQuery(plan: QueryPlan, batchSql?: string) {
  return databaseConnector(plan.database.engine).prepareExecution(
    plan,
    batchSql,
  );
}
