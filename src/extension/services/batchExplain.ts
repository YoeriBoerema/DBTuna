import { randomUUID } from "node:crypto";
import {
  type PlanBatch,
  validateBatch,
} from "../../../packages/plan-core/src/batch";
import type { QueryPlan } from "../../../packages/plan-core/src/types";
import { validateSql } from "../sql/statementSelection";
export function prepareBatch(statements: string[]): PlanBatch {
  return validateBatch({
    kind: "dbtuna-batch",
    schemaVersion: "1.0",
    id: randomUUID(),
    items: statements.map((sql, i) => {
      try {
        validateSql(sql);
        return { index: i + 1, sql, status: "pending" };
      } catch (e) {
        return {
          index: i + 1,
          sql,
          status: "error",
          error: e instanceof Error ? e.message : "Invalid SQL.",
        };
      }
    }),
  });
}
export async function explainBatch(
  initial: PlanBatch,
  collect: (sql: string, signal: AbortSignal) => Promise<QueryPlan>,
  signal: AbortSignal,
  onUpdate: (batch: PlanBatch) => void,
) {
  let batch = initial;
  const update = (
    index: number,
    change: Partial<PlanBatch["items"][number]>,
  ) => {
    batch = {
      ...batch,
      items: batch.items.map((item, i) =>
        i === index ? { ...item, ...change } : item,
      ),
    };
    onUpdate(batch);
  };
  onUpdate(batch);
  for (let i = 0; i < batch.items.length; i++) {
    if (batch.items[i].status !== "pending") continue;
    if (signal.aborted) {
      update(i, {
        status: "cancelled",
        error: "Batch cancelled before planning this query.",
      });
      continue;
    }
    update(i, { status: "running" });
    try {
      const collected = await collect(batch.items[i].sql, signal);
      const plan = { ...collected, id: `${batch.id}:${i + 1}` };
      if (signal.aborted) {
        update(i, { status: "cancelled", error: "Batch cancelled." });
        continue;
      }
      const candidate = {
        ...batch,
        items: batch.items.map((item, index) =>
          index === i ? { ...item, status: "complete" as const, plan } : item,
        ),
      };
      validateBatch(candidate);
      update(i, { status: "complete", plan });
    } catch (e) {
      update(i, {
        status: signal.aborted ? "cancelled" : "error",
        error: signal.aborted
          ? "Batch cancelled."
          : e instanceof Error
            ? e.message
            : "Could not explain query.",
      });
    }
  }
  return batch;
}
