import type { QueryPlan } from "./types";
// Call when creating/replacing plan content; the ID is a rendering hint, never authorization.
export function snapshotPlan(plan: QueryPlan): QueryPlan {
  return {
    ...plan,
    application: { ...plan.application, snapshotId: crypto.randomUUID() },
  };
}
export function samePlanSnapshot(a: QueryPlan, b: QueryPlan): boolean {
  return (
    !!a.application.snapshotId &&
    a.id === b.id &&
    a.application.snapshotId === b.application.snapshotId &&
    a.application.executionAvailable === b.application.executionAvailable &&
    a.application.executionUnavailableReason ===
      b.application.executionUnavailableReason
  );
}
