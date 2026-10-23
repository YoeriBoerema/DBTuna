import React, { useCallback, useState } from "react";
import type { QueryPlan } from "../../../packages/plan-core/src/types";
import type { PlanBatch } from "../../../packages/plan-core/src/batch";
import { estimatedPlanCost } from "../../../packages/plan-core/src/metrics";
import { fmt } from "../format";
import { LazyPlan } from "./LazyPlan";
import type { PlanView } from "../graphPresentation";
export function QuerySection({
  batchId,
  item,
  view,
  revision,
}: {
  batchId: string;
  item: PlanBatch["items"][number];
  view: PlanView;
  revision: number;
}) {
  const [verifiedSource, setVerifiedSource] = useState<QueryPlan>();
  const onVerifiedChange = useCallback(
    (verified: boolean) => {
      setVerifiedSource(verified ? item.plan : undefined);
    },
    [item.plan],
  );
  const verified =
    !!item.plan &&
    (verifiedSource === item.plan ||
      item.plan.application.planKind === "actual" ||
      item.plan.nodes.some((node) => node.actuals));
  return (
    <section
      key={batchId + ":" + item.index}
      className="query-section"
      aria-label={"Query " + item.index}
    >
      <div className="query-heading">
        <h2>Query {item.index}</h2>
        <span className={"query-status " + item.status}>
          {item.status === "complete"
            ? verified
              ? "Verified"
              : "Predicted"
            : item.status === "pending"
              ? "Queued"
              : item.status === "running"
                ? "Planning…"
                : item.status === "error"
                  ? "Failed"
                  : item.status === "skipped"
                    ? "Skipped"
                    : "Cancelled"}
        </span>
        {item.plan && (
          <span className="query-cost">
            Plan cost: {fmt(estimatedPlanCost(item.plan))}
          </span>
        )}
      </div>
      <details className="query-sql">
        <summary aria-label={"SQL for query " + item.index}>
          {item.sql.replace(/\s+/g, " ").slice(0, 180)}
          {item.sql.length > 180 ? "…" : ""}
        </summary>
        <pre>{item.sql}</pre>
      </details>
      {item.plan ? (
        <LazyPlan
          plan={item.plan}
          view={view}
          revision={revision}
          onVerifiedChange={onVerifiedChange}
        />
      ) : item.error ? (
        <div
          role={item.status === "error" ? "alert" : "status"}
          className={
            item.status === "skipped" ? "query-skipped" : "query-error"
          }
        >
          {item.error}
        </div>
      ) : (
        <div className="query-pending">
          {item.status === "running"
            ? "Requesting estimated query plan…"
            : "Waiting for earlier queries…"}
        </div>
      )}
    </section>
  );
}
