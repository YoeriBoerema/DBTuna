import { advicePayload } from "../../src/extension/ai/advicePayload";

import { formatAdvice as presentAdvice } from "../../webview/src/advicePresentation";

import { parseAdvice } from "../../packages/plan-core/src/advice";

import { test } from "node:test";

import assert from "node:assert/strict";

import { readFileSync } from "node:fs";

import { PostgresAdapter } from "../../packages/adapter-postgres/src/postgresAdapter";

import { webviewMessageSchema } from "../../src/extension/webview/messages";

const formatAdvice = (value: unknown) => presentAdvice(parseAdvice(value));

const plan = () => {
  const p = new PostgresAdapter().parse(
    JSON.parse(readFileSync("fixtures/postgres/nested-loop.json", "utf8")),
  );
  p.query = "SELECT * FROM customers";
  p.application.connectionLabel = "private-host";
  p.application.planKind = "actual";
  p.application.clientElapsedMs = 123;
  p.metadata.batchSql = "SELECT secret FROM unrelated";
  p.metadata.nativeXml = "duplicate";
  return p;
};

test("AI payload includes selected query, engine, complete plan and operator; excludes connection/batch metadata", () => {
  const p = plan(),
    text = advicePayload({
      plan: p,
      nodeId: p.rootNodeIds[0],
      context: "Focus on latency",
    });
  const value = JSON.parse(text);
  assert.equal(value.database.engine, "postgresql");
  assert.equal(value.query, p.query);
  assert.equal(value.plan.nodes.length, p.nodes.length);
  assert.deepEqual(value.plan.application, {
    planKind: "actual",
    clientElapsedMs: 123,
  });
  assert.equal(value.context, "Focus on latency");
  assert.ok(!text.includes("private-host"));
  assert.ok(!text.includes("unrelated"));
  assert.ok(!text.includes("duplicate"));
  assert.throws(() =>
    advicePayload({ plan: p, nodeId: "missing", context: "" }),
  );
  delete p.query;
  assert.throws(() =>
    advicePayload({ plan: p, nodeId: p.rootNodeIds[0], context: "" }),
  );
  assert.equal(
    JSON.parse(
      advicePayload({
        plan: p,
        nodeId: p.rootNodeIds[0],
        context: "",
        query: "SELECT 1",
      }),
    ).query,
    "SELECT 1",
  );
  p.query = "x".repeat(513 * 1024);
  assert.throws(
    () => advicePayload({ plan: p, nodeId: p.rootNodeIds[0], context: "" }),
    /512 KiB/,
  );
});

test("webview AI messages reject arbitrary plans, keys, unknown actions and oversized fields", () => {
  const request = {
    type: "AI_ANALYZE",
    requestId: "r",
    planId: "p",
    nodeId: "n",
    context: "",
  };
  assert.ok(webviewMessageSchema.safeParse(request).success);
  for (const message of [
    { ...request, apiKey: "secret" },
    { ...request, plan: plan() },
    { ...request, context: "x".repeat(4001) },
    { ...request, requestId: "" },
    { type: "AI_EXECUTE_SQL" },
    { type: "EXPORT_PLAN", payload: "bad" },
  ])
    assert.equal(webviewMessageSchema.safeParse(message).success, false);
  assert.ok(webviewMessageSchema.safeParse({ type: "AI_SETTINGS" }).success);
  assert.ok(
    webviewMessageSchema.safeParse({ type: "AI_CANCEL", requestId: "r" })
      .success,
  );
});

test("advice formatting enforces score bounds, concise suggestions and complete query inclusion", () => {
  const valid = {
    score: 1,
    scoreReason: "Severe apparent inefficiencies.",
    suggestions: ["Remove redundant predicates."],
    updatedQuery: "SELECT * FROM customers;",
  };
  assert.match(formatAdvice(valid), /^Score: 1\/100/);
  assert.match(
    formatAdvice(valid),
    /Updated query \(proposed\)\nSELECT \* FROM customers;/,
  );
  const clean = formatAdvice({
    score: 100,
    scoreReason: "No easy improvements evident.",
    suggestions: [],
    updatedQuery: null,
  });
  assert.match(clean, /^Score: 100\/100/);
  assert.ok(!clean.includes("Updated query"));
  assert.ok(!clean.includes("Findings"));
  assert.ok(!clean.includes("Validation"));
  for (const invalid of [
    { ...valid, score: 0 },
    { ...valid, score: 101 },
    { ...valid, score: 50.5 },
    { ...valid, updatedQuery: null },
    { ...valid, updatedQuery: " " },
    { ...valid, suggestions: Array(4).fill("suggestion") },
    { ...valid, findings: "unwanted" },
    { ...valid, suggestions: ["x".repeat(201)] },
  ])
    assert.throws(() => formatAdvice(invalid));
});
