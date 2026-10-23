import { PLAN_LIMITS } from "./limits";
import { z } from "zod";
import { normalizePlanApplication } from "./application";
export const categories = [
  "TABLE_SCAN",
  "INDEX_ACCESS",
  "JOIN",
  "HASH",
  "SORT",
  "AGGREGATE",
  "LIMIT",
  "MATERIALIZE",
  "PARALLEL",
  "APPEND",
  "OTHER",
] as const;
const num = z.number().finite().nonnegative().optional();
export const nodeSchema = z.object({
  id: z.string().min(1),
  category: z.enum(categories),
  nativeType: z.string(),
  label: z.string(),
  object: z
    .object({
      schema: z.string().optional(),
      relation: z.string().optional(),
      alias: z.string().optional(),
      index: z.string().optional(),
    })
    .optional(),
  estimates: z
    .object({
      startupCost: num,
      totalCost: num,
      rows: num,
      rowWidth: num,
      cpuCost: num,
      ioCost: num,
      costScope: z.enum(["subtree", "operator"]).optional(),
    })
    .optional(),
  actuals: z
    .object({
      rows: num,
      loops: num,
      startupTimeMs: num,
      totalTimeMs: num,
      rowsScope: z.enum(["total", "per_execution"]).optional(),
      elapsedTimeMs: num,
      cpuTimeMs: num,
    })
    .optional(),
  properties: z.record(z.string(), z.unknown()),
});
// DBTuna-owned presentation fields. Native database attributes stay in metadata.
export const applicationSchema = z.object({
  snapshotId: z.string().optional(),
  connectionLabel: z.string().optional(),
  executionAvailable: z.boolean().optional(),
  executionUnavailableReason: z.string().optional(),
  statementIndex: z.number().int().positive().optional(),
  statementType: z.string().optional(),
  planKind: z.enum(["estimated", "actual"]).optional(),
  clientElapsedMs: num,
});
export const planSchema = z.preprocess(
  normalizePlanApplication,
  z.object({
    schemaVersion: z.literal("1.0"),
    id: z.string(),
    database: z.object({ engine: z.string(), version: z.string().optional() }),
    source: z.object({
      format: z.string(),
      capturedAt: z.string().optional(),
      synthetic: z.boolean(),
    }),
    query: z.string().optional(),
    rootNodeIds: z.array(z.string()).min(1),
    nodes: z.array(nodeSchema).min(1).max(PLAN_LIMITS.operators),
    edges: z
      .array(
        z.object({
          id: z.string(),
          source: z.string(),
          target: z.string(),
          relationship: z.string().optional(),
        }),
      )
      .max(PLAN_LIMITS.edges),
    application: applicationSchema.default({}),
    metadata: z.record(z.string(), z.unknown()),
  }),
);
export type QueryPlan = z.infer<typeof planSchema>;
export type PlanNode = z.infer<typeof nodeSchema>;
export type OperatorCategory = (typeof categories)[number];
export function bounded(input: unknown): unknown {
  if (typeof input === "string") {
    if (Buffer.byteLength(input) > PLAN_LIMITS.bytes)
      throw Error("Plan exceeds 5 MiB.");
    try {
      input = JSON.parse(input);
    } catch {
      throw Error("Invalid JSON execution plan.");
    }
    if (typeof input === "string") input = JSON.parse(input);
  }
  let count = 0;
  const walk = (v: unknown, d: number) => {
    if (d > PLAN_LIMITS.objectDepth || ++count > PLAN_LIMITS.values)
      throw Error("Plan exceeds nesting or size limits.");
    if (v && typeof v === "object")
      for (const x of Object.values(v)) walk(x, d + 1);
  };
  walk(input, 0);
  return input;
}
export function validate(input: unknown): QueryPlan {
  const p = planSchema.parse(bounded(input));
  const ids = new Set(p.nodes.map((n) => n.id));
  if (
    ids.size !== p.nodes.length ||
    new Set(p.edges.map((e) => e.id)).size !== p.edges.length
  )
    throw Error("Duplicate graph IDs.");
  if (
    new Set(p.rootNodeIds).size !== p.rootNodeIds.length ||
    p.rootNodeIds.some((id) => !ids.has(id))
  )
    throw Error("Invalid roots.");
  const children = new Map<string, string[]>();
  const parents = new Set<string>();
  for (const e of p.edges) {
    if (!ids.has(e.source) || !ids.has(e.target) || parents.has(e.target))
      throw Error("Invalid edge endpoints or multiple parents.");
    parents.add(e.target);
    children.set(e.source, [...(children.get(e.source) || []), e.target]);
  }
  const seen = new Set<string>();
  function visit(id: string) {
    if (seen.has(id)) throw Error("Cycle or repeated root.");
    seen.add(id);
    for (const child of children.get(id) || []) visit(child);
  }
  for (const id of p.rootNodeIds) {
    if (parents.has(id)) throw Error("Root has a parent.");
    visit(id);
  }
  if (seen.size !== ids.size) throw Error("Disconnected graph or cycle.");
  return p;
}
