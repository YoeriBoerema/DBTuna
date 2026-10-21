import { bounded, validate } from "../../plan-core/src/schema";
import type { QueryPlan, PlanNode } from "../../plan-core/src/types";
import type { QueryPlanAdapter } from "../../adapter-sdk/src/adapter";
import { operatorMapping } from "./operatorMapping";
export class PostgresAdapter implements QueryPlanAdapter {
  readonly id = "postgresql";
  readonly displayName = "PostgreSQL";
  canParse(v: unknown) {
    return (
      Array.isArray(v) &&
      v.length === 1 &&
      v[0] &&
      typeof v[0] === "object" &&
      "Plan" in v[0]
    );
  }
  parse(input: unknown): QueryPlan {
    const value = bounded(input);
    if (!this.canParse(value))
      throw Error(
        "PostgreSQL plan must be an array containing exactly one Plan object.",
      );
    const top = (value as Record<string, unknown>[])[0];
    const nodes: PlanNode[] = [];
    const edges: QueryPlan["edges"] = [];
    const walk = (raw: unknown, id: string) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw))
        throw Error("Invalid PostgreSQL operator.");
      const n = raw as Record<string, unknown>;
      if (typeof n["Node Type"] !== "string")
        throw Error("Operator is missing Node Type.");
      if (nodes.length >= 1000) throw Error("Maximum 1000 operators.");
      const number = (key: string) => {
        const v = n[key];
        if (v === undefined) return undefined;
        if (typeof v !== "number" || !Number.isFinite(v) || v < 0)
          throw Error("Invalid metric: " + key);
        return v;
      };
      const str = (key: string) =>
        typeof n[key] === "string" ? (n[key] as string) : undefined;
      const { Plans, ...properties } = n;
      const actuals = Object.keys(n).some((k) => k.startsWith("Actual "))
        ? {
            rows: number("Actual Rows"),
            rowsScope: "per_execution" as const,
            loops: number("Actual Loops"),
            startupTimeMs: number("Actual Startup Time"),
            totalTimeMs: number("Actual Total Time"),
          }
        : undefined;
      nodes.push({
        id,
        nativeType: n["Node Type"],
        label:
          n["Node Type"] === "ModifyTable" && str("Operation")
            ? str("Operation")!
            : n["Node Type"],
        category: operatorMapping[n["Node Type"]] || "OTHER",
        object: {
          schema: str("Schema"),
          relation: str("Relation Name"),
          alias: str("Alias"),
          index: str("Index Name"),
        },
        estimates: {
          startupCost: number("Startup Cost"),
          totalCost: number("Total Cost"),
          rows: number("Plan Rows"),
          rowWidth: number("Plan Width"),
        },
        actuals,
        properties,
      });
      if (Plans !== undefined) {
        if (!Array.isArray(Plans)) throw Error("Plans must be an array.");
        Plans.forEach((child, i) => {
          const target = id + "." + i;
          walk(child, target);
          edges.push({
            id: id + ">" + target,
            source: id,
            target,
            relationship:
              typeof child?.["Parent Relationship"] === "string"
                ? child["Parent Relationship"]
                : undefined,
          });
        });
      }
    };
    walk(top.Plan, "0");
    const metadata = { ...top };
    delete metadata.Plan;
    return validate({
      schemaVersion: "1.0",
      id: "postgres-plan",
      database: { engine: "postgresql" },
      source: {
        format: "postgresql-json",
        synthetic: metadata["DBTuna Synthetic"] === true,
      },
      rootNodeIds: ["0"],
      nodes,
      edges,
      metadata,
    });
  }
}
