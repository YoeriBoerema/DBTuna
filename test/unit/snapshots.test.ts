import { test } from "node:test";
import assert from "node:assert/strict";
import { PostgresAdapter } from "../../packages/adapter-postgres/src/postgresAdapter";
import {
  snapshotPlan,
  samePlanSnapshot,
} from "../../packages/plan-core/src/snapshots";

test("snapshot identity survives serialization but never hides changed execution availability", () => {
  const raw = new PostgresAdapter().parse([
    { Plan: { "Node Type": "Result" } },
  ]);
  const a = snapshotPlan(raw);
  const b = JSON.parse(JSON.stringify(a));
  assert.equal(samePlanSnapshot(a, b), true);
  b.application.executionAvailable = false;
  assert.equal(samePlanSnapshot(a, b), false);
  b.application.executionAvailable = a.application.executionAvailable;
  b.application.executionUnavailableReason = "Connection changed";
  assert.equal(samePlanSnapshot(a, b), false);
  assert.equal(samePlanSnapshot(a, snapshotPlan(a)), false);
  assert.equal(samePlanSnapshot(raw, raw), false);
  assert.equal(raw.application.snapshotId, undefined);
});
