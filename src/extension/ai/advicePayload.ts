import type { QueryPlan } from "../../../packages/plan-core/src/types";
import { AI_LIMITS } from "../../../packages/plan-core/src/limits";
export type AiInput = {
  plan: QueryPlan;
  nodeId: string;
  context: string;
  query?: string;
};
export function advicePayload({ plan, nodeId, context, query }: AiInput) {
  if (!plan.nodes.some((node) => node.id === nodeId))
    throw Error("Selected operator is no longer available.");
  const sql = plan.query?.trim() || query?.trim();
  if (!sql) throw Error("Supply the SQL query before requesting AI advice.");
  const metadata = Object.fromEntries(
    Object.entries(plan.metadata).filter(
      ([key]) => !["connectionLabel", "nativeXml", "batchSql"].includes(key),
    ),
  );
  const payload = {
    database: plan.database,
    query: sql,
    selectedOperatorId: nodeId,
    context,
    plan: {
      schemaVersion: plan.schemaVersion,
      rootNodeIds: plan.rootNodeIds,
      nodes:
        plan.database.engine === "oracle"
          ? plan.nodes.map((node) => ({
              ...node,
              properties: Object.fromEntries(
                Object.entries(node.properties).filter(
                  ([key]) => key !== "OTHER_XML",
                ),
              ),
            }))
          : plan.nodes,
      edges: plan.edges,
      application: {
        statementType: plan.application.statementType,
        statementIndex: plan.application.statementIndex,
        planKind: plan.application.planKind,
        clientElapsedMs: plan.application.clientElapsedMs,
      },
      metadata,
    },
  };
  const text = JSON.stringify(payload);
  if (Buffer.byteLength(text) > AI_LIMITS.inputBytes)
    throw Error(
      "Query and plan exceed the AI input limit of 512 KiB. Use a smaller plan.",
    );
  return text;
}
