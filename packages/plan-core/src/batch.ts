import { PLAN_LIMITS, SQL_LIMITS } from "./limits";
import { z } from "zod";
import { bounded, planSchema, validate } from "./schema";
export const MAX_BATCH_STATEMENTS = PLAN_LIMITS.statements;
const itemFields = {
  index: z.number().int().positive(),
  sql: z.string().max(SQL_LIMITS.characters),
};
export const batchItemSchema = z.discriminatedUnion("status", [
  z.object({
    ...itemFields,
    status: z.enum(["pending", "running"]),
    plan: z.never().optional(),
    error: z.never().optional(),
  }),
  z.object({
    ...itemFields,
    status: z.literal("complete"),
    plan: planSchema,
    error: z.never().optional(),
  }),
  z.object({
    ...itemFields,
    status: z.enum(["error", "cancelled", "skipped"]),
    error: z.string().default("Query did not complete."),
    plan: z.never().optional(),
  }),
]);
export const batchSchema = z.object({
  kind: z.literal("dbtuna-batch"),
  schemaVersion: z.literal("1.0"),
  id: z.string(),
  connectionLabel: z.string().optional(),
  items: z.array(batchItemSchema).min(1).max(MAX_BATCH_STATEMENTS),
});
export type PlanBatch = z.infer<typeof batchSchema>;
export function validateBatch(input: unknown): PlanBatch {
  const batch = batchSchema.parse(bounded(input));
  let nodes = 0;
  batch.items.forEach((item, i) => {
    if (item.index !== i + 1)
      throw Error("Batch query numbers must be consecutive.");
    if (item.plan) {
      item.plan = validate(item.plan);
      nodes += item.plan.nodes.length;
    }
  });
  if (
    nodes > PLAN_LIMITS.batchOperators ||
    new TextEncoder().encode(JSON.stringify(batch)).byteLength >
      PLAN_LIMITS.bytes
  )
    throw Error("Batch exceeds 5 MiB or 5,000 operators.");
  return batch;
}
export function restoreBatch(input: unknown): PlanBatch {
  const batch = validateBatch(input);
  return {
    ...batch,
    items: batch.items.map((item) =>
      item.status === "pending" || item.status === "running"
        ? {
            ...item,
            status: "cancelled",
            error:
              "Imported batch was not completed. Run Explain Query to plan these statements.",
          }
        : item.status === "error" ||
            item.status === "skipped" ||
            item.status === "cancelled"
          ? {
              ...item,
              error:
                "Imported diagnostic text omitted. Re-run Explain for current diagnostics.",
            }
          : item,
    ),
  };
}
