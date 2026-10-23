import { postgresNative } from "../helpers/nativePlans.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  executionReducer,
  initialExecutionState,
} from "../../webview/src/state/executionState";
import { aiReducer } from "../../webview/src/state/aiState";
import { PostgresAdapter } from "../../packages/adapter-postgres/src/postgresAdapter";
import type {
  ExecutionResult,
  AiResult,
} from "../../src/extension/webview/messages";
const plan = new PostgresAdapter().parse(postgresNative());
const result = (requestId: string): ExecutionResult => ({
  type: "EXECUTION_RESULT",
  requestId,
  planId: "plan",
  status: "complete",
  actualPlan: plan,
  elapsedMs: 12,
});
test("execution transitions ignore old requests, preserve measured plans after errors and bound elapsed time", () => {
  const confirming = executionReducer(initialExecutionState, {
    type: "start",
    requestId: "first",
  });
  assert.equal(
    executionReducer(confirming, {
      type: "result",
      message: result("stale"),
      now: 100,
    }),
    confirming,
  );
  const running = executionReducer(confirming, {
    type: "result",
    message: {
      type: "EXECUTION_RESULT",
      requestId: "first",
      planId: "plan",
      status: "running",
    },
    now: 100,
  });
  assert.equal(executionReducer(running, { type: "tick", now: 50 }).elapsed, 0);
  assert.equal(
    executionReducer(running, { type: "tick", now: 150 }).elapsed,
    50,
  );
  const completed = executionReducer(running, {
    type: "result",
    message: result("first"),
    now: 200,
  });
  assert.equal(completed.actual, plan);
  assert.equal(completed.elapsed, 12);
  const next = executionReducer(completed, {
    type: "start",
    requestId: "second",
  });
  assert.equal(
    executionReducer(next, {
      type: "result",
      message: result("first"),
      now: 210,
    }),
    next,
  );
  const cancelled = executionReducer(next, {
    type: "result",
    message: {
      type: "EXECUTION_RESULT",
      planId: "plan",
      requestId: "second",
      status: "cancelled",
      error: "Cancelled",
    },
    now: 220,
  });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.actual, plan);
  assert.equal(
    executionReducer(cancelled, {
      type: "result",
      message: result("second"),
      now: 230,
    }),
    cancelled,
  );
});
test("AI transitions do not let stale success overwrite a newer request or cancellation", () => {
  const pending = aiReducer(
    { status: "idle" },
    { type: "start", requestId: "new" },
  );
  const success: AiResult = {
    type: "AI_RESULT",
    requestId: "old",
    planId: "plan",
    nodeId: "node",
    status: "complete",
    model: "mock",
    advice: {
      score: 100,
      scoreReason: "No easy improvements",
      suggestions: [],
      updatedQuery: null,
    },
  };
  assert.equal(
    aiReducer(pending, { type: "result", message: success }),
    pending,
  );
  const cancelled = aiReducer(pending, {
    type: "result",
    message: {
      type: "AI_RESULT",
      requestId: "new",
      planId: "plan",
      nodeId: "node",
      status: "cancelled",
      error: "Cancelled",
    },
  });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(
    aiReducer(cancelled, {
      type: "result",
      message: { ...success, requestId: "new" },
    }),
    cancelled,
  );
});

test("execution confirmation and display state only transition through valid phases", () => {
  let state = executionReducer(initialExecutionState, { type: "arm_cancel" });
  assert.equal(state.confirmation, "none");
  state = executionReducer(state, { type: "arm_run" });
  assert.equal(state.confirmation, "run");
  state = executionReducer(state, { type: "start", requestId: "one" });
  assert.equal(state.status, "preparing");
  assert.equal(state.confirmation, "none");
  assert.equal(
    executionReducer(state, { type: "start", requestId: "duplicate" }),
    state,
  );
  state = executionReducer(state, { type: "arm_cancel" });
  assert.equal(state.confirmation, "cancel");
  state = executionReducer(state, {
    type: "result",
    message: result("one"),
    now: 1,
  });
  assert.equal(state.confirmation, "none");
  assert.equal(state.mode, "actual");
  state = executionReducer(state, { type: "select_mode", mode: "estimated" });
  assert.equal(state.mode, "estimated");
  assert.deepEqual(
    executionReducer(state, { type: "reset" }),
    initialExecutionState,
  );
});
