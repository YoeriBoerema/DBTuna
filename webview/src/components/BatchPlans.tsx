import React from "react";
import type { PlanBatch } from "../../../packages/plan-core/src/batch";
import type { PlanView } from "../graphPresentation";
import { QuerySection } from "./QuerySection";
export function BatchPlans({
  batch,
  view,
  revision,
}: {
  batch: PlanBatch;
  view: PlanView;
  revision: number;
}) {
  return (
    <>
      <div className="batch-summary" role="status">
        {batch.items.length} {batch.items.length === 1 ? "query" : "queries"}
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
