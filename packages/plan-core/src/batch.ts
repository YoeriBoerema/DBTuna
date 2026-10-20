import { z } from "zod";
import { bounded, planSchema, validate } from "./schema";
export const MAX_BATCH_STATEMENTS = 20;
export const batchSchema = z.object({
  kind: z.literal("dbtuna-batch"),
  schemaVersion: z.literal("1.0"),
  id: z.string(),
  connectionLabel: z.string().optional(),
  items: z
    .array(
      z.object({
        index: z.number().int().positive(),
        sql: z.string().max(1024 * 1024),
        status: z.enum([
          "pending",
          "running",
          "complete",
          "error",
          "cancelled",
        ]),
        plan: planSchema.optional(),
        error: z.string().optional(),
      }),
    )
    .min(1)
    .max(MAX_BATCH_STATEMENTS),
});
export type PlanBatch = z.infer<typeof batchSchema>;
export function validateBatch(input: unknown): PlanBatch {
  const batch = batchSchema.parse(bounded(input));
  let nodes = 0;
  batch.items.forEach((item, i) => {
    if (item.index !== i + 1)
      throw Error("Batch query numbers must be consecutive.");
    if ((item.status === "complete") !== !!item.plan)
      throw Error("Batch status does not match its plan.");
    if (item.plan) {
      item.plan = validate(item.plan);
      nodes += item.plan.nodes.length;
    }
  });
  if (
    nodes > 5000 ||
    new TextEncoder().encode(JSON.stringify(batch)).byteLength > 5 * 1024 * 1024
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
        : item,
    ),
  };
}
