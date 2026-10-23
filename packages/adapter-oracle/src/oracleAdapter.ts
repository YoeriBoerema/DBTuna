import { z } from "zod";
import { bounded, validate } from "../../plan-core/src/schema";
import { PLAN_LIMITS } from "../../plan-core/src/limits";
import type { PlanNode, OperatorCategory } from "../../plan-core/src/types";
import type { QueryPlanAdapter } from "../../adapter-sdk/src/adapter";
import { parseOracleText } from "./oracleText";

export const oracleEnvelopeSchema = z.object({
  kind: z.literal("dbtuna-oracle-native"),
  nativeVersion: z.literal(1),
  query: z.string().optional(),
  version: z.string().optional(),
  planKind: z.enum(["estimated", "actual"]),
  statementType: z.enum(["SELECT", "INSERT"]).optional(),
  synthetic: z.boolean().optional(),
  rows: z
    .array(z.record(z.string(), z.unknown()))
    .min(1)
    .max(PLAN_LIMITS.operators),
});
export type OracleEnvelope = z.infer<typeof oracleEnvelopeSchema>;

function category(operation: string, options: string): OperatorCategory {
  const label = operation + " " + options;
  if (/STOPKEY|COUNT STOPKEY/.test(label)) return "LIMIT";
  if (/NESTED LOOPS|JOIN/.test(operation)) return "JOIN";
  if (/^PX |PARALLEL/.test(operation)) return "PARALLEL";
  if (/GROUP BY|AGGREGATE/.test(label)) return "AGGREGATE";
  if (/SORT|WINDOW/.test(operation)) return "SORT";
  if (/^INDEX|BITMAP/.test(operation)) return "INDEX_ACCESS";
  if (/TABLE ACCESS/.test(operation)) return "TABLE_SCAN";
  if (/HASH/.test(operation)) return "HASH";
  if (/TEMP TABLE|MATERIALIZ|LOAD AS SELECT/.test(label)) return "MATERIALIZE";
  if (/UNION|CONCATENATION/.test(operation)) return "APPEND";
  return "OTHER";
}

export class OracleAdapter implements QueryPlanAdapter {
  readonly id = "oracle";
  readonly displayName = "Oracle Database";
  canParse(input: unknown): boolean {
    return typeof input === "string"
      ? /\|\s*Id\s*\|\s*Operation\s*\|/i.test(input)
      : !!input &&
          typeof input === "object" &&
          "kind" in input &&
          input.kind === "dbtuna-oracle-native";
  }
  parse(input: unknown) {
    const envelope = oracleEnvelopeSchema.parse(
      bounded(typeof input === "string" ? parseOracleText(input) : input),
    );
    if (Buffer.byteLength(JSON.stringify(envelope)) > PLAN_LIMITS.bytes)
      throw Error("Oracle plan exceeds 5 MiB.");
    const ids = new Set<string>(),
      roots: string[] = [],
      edges: { id: string; source: string; target: string }[] = [];
    const number = (row: Record<string, unknown>, key: string) => {
      const value = row[key];
      if (value === undefined || value === null) return undefined;
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
        throw Error("Invalid Oracle metric: " + key);
      return value;
    };
    const text = (row: Record<string, unknown>, key: string) =>
      typeof row[key] === "string" ? (row[key] as string) : undefined;
    const nodes: PlanNode[] = envelope.rows.map((row) => {
      const nativeId = number(row, "ID");
      if (nativeId === undefined || !Number.isInteger(nativeId))
        throw Error("Oracle operator requires an integer ID.");
      const id = String(nativeId);
      if (ids.has(id)) throw Error("Duplicate Oracle operator ID.");
      ids.add(id);
      const operation = text(row, "OPERATION"),
        options = text(row, "OPTIONS") || "";
      if (!operation) throw Error("Oracle operator is missing OPERATION.");
      const parent = number(row, "PARENT_ID");
      if (parent === undefined) roots.push(id);
      else
        edges.push({
          id: `${parent}>${id}`,
          source: String(parent),
          target: id,
        });
      const rows = number(row, "CARDINALITY"),
        bytes = number(row, "BYTES"),
        elapsed = number(row, "LAST_ELAPSED_TIME");
      const hasActual =
        envelope.planKind === "actual" &&
        number(row, "LAST_STARTS") !== undefined;
      return {
        id,
        nativeType: operation + (options ? " " + options : ""),
        label: operation + (options ? " " + options : ""),
        category: category(operation.toUpperCase(), options.toUpperCase()),
        object: {
          schema: text(row, "OBJECT_OWNER"),
          relation: /^INDEX/.test(operation)
            ? undefined
            : text(row, "OBJECT_NAME"),
          index: /^INDEX/.test(operation)
            ? text(row, "OBJECT_NAME")
            : undefined,
          alias: text(row, "OBJECT_ALIAS"),
        },
        estimates: {
          totalCost: number(row, "COST"),
          rows,
          rowWidth: rows && bytes !== undefined ? bytes / rows : undefined,
          cpuCost: number(row, "CPU_COST"),
          ioCost: number(row, "IO_COST"),
          costScope: "subtree",
        },
        actuals: hasActual
          ? {
              rows: number(row, "LAST_OUTPUT_ROWS"),
              loops: number(row, "LAST_STARTS"),
              rowsScope: "total",
              totalTimeMs: elapsed === undefined ? undefined : elapsed / 1000,
            }
          : undefined,
        properties: {
          ...row,
          "DBTuna timing scope":
            "Inclusive row-source elapsed time; do not sum operators or parallel workers",
          ...(rows && bytes !== undefined
            ? { "DBTuna row width": "Derived from BYTES / CARDINALITY" }
            : {}),
        },
      };
    });
    if (
      envelope.planKind === "actual" &&
      !nodes.some((node) => node.actuals && (node.actuals.loops || 0) > 0)
    )
      throw Error(
        "Oracle returned no runtime statistics. Enable row-source statistics and check cursor access.",
      );
    return validate({
      schemaVersion: "1.0",
      id: "oracle-plan",
      database: { engine: "oracle", version: envelope.version },
      query: envelope.query,
      source: {
        format: "oracle-plan-rows",
        synthetic: envelope.synthetic === true,
      },
      rootNodeIds: roots,
      nodes,
      edges,
      application: {
        planKind: envelope.planKind,
        statementType:
          envelope.statementType ||
          (/^\s*INSERT\b/i.test(
            (envelope.query || "").replace(
              /^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*/,
              "",
            ),
          )
            ? "INSERT"
            : "SELECT"),
      },
      metadata: {
        metricScope:
          "Oracle optimizer costs; runtime rows are totals across starts. Adaptive/parallel comparisons require compatible scopes.",
      },
    });
  }
}
