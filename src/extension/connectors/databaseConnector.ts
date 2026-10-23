import type { QueryPlan } from "../../../packages/plan-core/src/types";
import type { Profile } from "../connection/profile";
import type { PreparedExecution } from "../sql/executionPreparation";
export type CollectedPlan = { raw: unknown; version?: string };
export type ClassifiedStatement =
  | { sql: string; status: "supported" }
  | { sql: string; status: "skipped" | "invalid"; reason: string };
export interface DatabaseConnector {
  classify(sql: string): ClassifiedStatement[];
  readonly type: Profile["type"];
  split(text: string, selection?: string): string[];
  validate(sql: string): string;
  collectEstimated(
    profile: Profile,
    password: string | undefined,
    sql: string,
    signal?: AbortSignal,
  ): Promise<CollectedPlan>;
  collectActual(
    profile: Profile,
    password: string | undefined,
    sql: string,
    signal?: AbortSignal,
  ): Promise<CollectedPlan>;
  parse(raw: unknown): QueryPlan[];
  prepareExecution(plan: QueryPlan, batchSql?: string): PreparedExecution;
  selectActual(
    raw: unknown,
    estimated: QueryPlan,
    kind: PreparedExecution["kind"],
  ): QueryPlan;
}
