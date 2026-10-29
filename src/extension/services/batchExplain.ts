import { snapshotPlan } from "../../../packages/plan-core/src/snapshots";
import { randomUUID } from "node:crypto";
import {
  type PlanBatch,
  validateBatch,
} from "../../../packages/plan-core/src/batch";
import type { QueryPlan } from "../../../packages/plan-core/src/types";
import { databaseConnector } from "../connectors/registry";
import { safeErrorMessage } from "../../../packages/plan-core/src/errors";
export function prepareBatch(
  statements: string[],
  type: "postgresql" | "sqlserver" | "oracle" = "postgresql",
): PlanBatch {
  return validateBatch({
    kind: "dbtuna-batch",
    schemaVersion: "1.0",
    id: randomUUID(),
    items: statements
      .flatMap((sql) => databaseConnector(type).classify(sql))
      .map((candidate, i) => {
        const base = { index: i + 1, sql: candidate.sql };
        switch (candidate.status) {
          case "supported":
            return { ...base, status: "pending" };
          case "skipped":
            return { ...base, status: "skipped", error: candidate.reason };
          case "invalid":
            return { ...base, status: "error", error: candidate.reason };
        }
      }),
  });
}
export async function explainBatch(
  initial: PlanBatch,
  collect: (
    sql: string,
    signal: AbortSignal,
  ) => Promise<QueryPlan | QueryPlan[]>,
  signal: AbortSignal,
  onUpdate: (batch: PlanBatch) => void,
  onPlan?: (plan: QueryPlan, sourceSql: string) => void,
) {
  let batch = initial;
  const update = (
    index: number,
    change:
      { status: "running" } | { status: "error" | "cancelled"; error: string },
  ) => {
    batch = {
      ...batch,
      items: batch.items.map((item, i) =>
        i === index ? { index: item.index, sql: item.sql, ...change } : item,
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
      const plans = Array.isArray(collected) ? collected : [collected];
      if (!plans.length) throw Error("No statement plans returned.");
      if (signal.aborted) {
        update(i, { status: "cancelled", error: "Batch cancelled." });
        continue;
      }
      const original = batch.items[i];
      const results = plans.map((plan) => ({
        index: 0,
        sql: plan.query || original.sql,
        status: "complete" as const,
        plan: snapshotPlan(plan),
      }));
      const items = [
        ...batch.items.slice(0, i),
        ...results,
        ...batch.items.slice(i + 1),
      ].map((item, index) => ({
        ...item,
        index: index + 1,
        ...(item.plan
          ? { plan: { ...item.plan, id: `${batch.id}:${index + 1}` } }
          : {}),
      }));
      const candidate = validateBatch({ ...batch, items });
      batch = candidate;
      for (const item of batch.items.slice(i, i + plans.length))
        if (item.plan) onPlan?.(item.plan, original.sql);
      onUpdate(batch);
      i += plans.length - 1;
    } catch (e) {
      update(i, {
        status: signal.aborted ? "cancelled" : "error",
        error: signal.aborted
          ? "Batch cancelled."
          : safeErrorMessage(
              e,
              "Could not explain query. Check SQL syntax, object names and database permissions.",
            ),
      });
    }
  }
  return batch;
}

export function completedBatch(plans: QueryPlan[]): PlanBatch {
  const id = randomUUID();
  return validateBatch({
    kind: "dbtuna-batch",
    schemaVersion: "1.0",
    id,
    items: plans.map((plan, index) => ({
      index: index + 1,
      sql: plan.query || "",
      status: "complete",
      plan: snapshotPlan({ ...plan, id: `${id}:${index + 1}` }),
    })),
  });
}
