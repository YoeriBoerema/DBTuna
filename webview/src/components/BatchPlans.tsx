import React from "react";
import type { PlanBatch } from "../../../packages/plan-core/src/batch";
import type { PlanView } from "../graphPresentation";
import { QuerySection } from "./QuerySection";
export function BatchPlans({
  batch,
  view,
  revision,
  completed,
  failed,
  skipped,
  running,
}: {
  batch: PlanBatch;
  view: PlanView;
  revision: number;
  completed: number;
  failed: number;
  skipped: number;
  running: boolean;
}) {
  return (
    <>
      <div className="batch-summary" role="status">
        {batch.items.length} {batch.items.length === 1 ? "query" : "queries"} ·{" "}
        {completed} planned{failed ? ` · ${failed} failed` : ""}
        {skipped ? ` · ${skipped} skipped` : ""}
        {running
          ? " · planning…"
          : batch.items.some((item) => item.status === "cancelled")
            ? " · cancelled"
            : " · finished"}
        <small>
          Explain collects estimates only. Use a query's Run action to execute
          it and collect an actual plan; INSERT changes persist.
        </small>
      </div>
      <div className="batch-list">
        {batch.items.map((item) => (
          <QuerySection
            key={batch.id + ":" + item.index}
            batchId={batch.id}
            item={item}
            view={view}
            revision={revision}
          />
        ))}
      </div>
    </>
  );
}
