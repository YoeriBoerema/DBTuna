import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PostgresAdapter } from "../../packages/adapter-postgres/src/postgresAdapter";
import {
  advicePayload,
  formatAdvice,
  requestAdvice,
  listModels,
} from "../../src/extension/ai/openaiClient";
import { webviewMessageSchema } from "../../src/extension/webview/messages";
const plan = () => {
  const p = new PostgresAdapter().parse(
    JSON.parse(readFileSync("fixtures/postgres/nested-loop.json", "utf8")),
  );
  p.query = "SELECT * FROM customers";
  p.metadata.connectionLabel = "private-host";
  p.metadata.batchSql = "SELECT secret FROM unrelated";
  p.metadata.nativeXml = "duplicate";
  return p;
};
const mock = (
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
) =>
  ((url, init) => Promise.resolve(handler(String(url), init!))) as typeof fetch;
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
test("OpenAI Responses request uses host authorization, store=false, no tools, and parses all text output", async () => {
  const p = plan();
  let calls = 0;
  const result = await requestAdvice(
    "test-key",
    "chosen-model",
    { plan: p, nodeId: p.rootNodeIds[0], context: "" },
    undefined,
    mock((url, init) => {
      calls++;
      assert.equal(url, "https://api.openai.com/v1/responses");
      assert.equal(init.redirect, "error");
      assert.equal(
        (init.headers as Record<string, string>).Authorization,
        "Bearer test-key",
      );
      const body = JSON.parse(init.body as string);
      assert.equal(body.model, "chosen-model");
      assert.equal(body.store, false);
      assert.ok(!JSON.stringify(body).includes("test-key"));
      assert.equal(body.tools, undefined);
      assert.equal(body.text.format.type, "json_schema");
      assert.equal(body.text.format.strict, true);
      assert.equal(body.text.format.schema.properties.score.maximum, 100);
      assert.equal(body.text.format.schema.properties.suggestions.maxItems, 3);
      assert.match(body.instructions, /optimizer costs are not milliseconds/);
      return Response.json({
        status: "completed",
        model: "chosen-model",
        output: [
          { type: "reasoning" },
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  score: 75,
                  scoreReason: "Some opportunities remain.",
                  suggestions: [
                    "Check existing indexes before adding one; the query is unchanged.",
                  ],
                  updatedQuery: p.query,
                }),
              },
            ],
          },
        ],
      });
    }),
  );
  assert.equal(calls, 1);
  assert.match(result.text, /^Score: 75\/100/);
  assert.match(result.text, /Suggestions\n-/);
  assert.match(
    result.text,
    /Updated query \(proposed\)\nSELECT \* FROM customers/,
  );
  assert.ok(!result.text.includes("Findings"));
  assert.equal(result.incomplete, false);
});
test("AI errors sanitize provider bodies; incomplete/empty responses, cancellation and network failures are handled", async () => {
  const p = plan(),
    input = { plan: p, nodeId: p.rootNodeIds[0], context: "" };
  for (const status of [400, 401, 403, 404, 429, 500]) {
    await assert.rejects(
      () =>
        requestAdvice(
          "test-key",
          "chosen-model",
          input,
          undefined,
          mock(() => new Response("secret request or API key", { status })),
        ),
      (error) => {
        assert.ok(error instanceof Error);
        assert.ok(!error.message.includes("secret"));
        return true;
      },
    );
  }
  await assert.rejects(
    () =>
      requestAdvice(
        "test-key",
        "chosen-model",
        input,
        undefined,
        mock(() => Response.json({ output: [] })),
      ),
    /no advice/,
  );
  await assert.rejects(
    () =>
      requestAdvice(
        "test-key",
        "chosen-model",
        input,
        undefined,
        mock(() =>
          Response.json({
            status: "incomplete",
            output: [
              {
                type: "message",
                content: [{ type: "output_text", text: "partial SQL" }],
              },
            ],
          }),
        ),
      ),
    /output limit/,
  );
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    () =>
      requestAdvice(
        "test-key",
        "chosen-model",
        input,
        abort.signal,
        mock((url, init) => {
          init.signal!.throwIfAborted();
          return Response.json({});
        }),
      ),
    /cancelled/,
  );
  await assert.rejects(
    () =>
      requestAdvice(
        "test-key",
        "chosen-model",
        input,
        undefined,
        mock(() => {
          throw new TypeError("fetch failed");
        }),
      ),
    /network/,
  );
  await assert.rejects(
    () =>
      requestAdvice(
        "test-key",
        "chosen-model",
        input,
        undefined,
        mock(() => new Response("x".repeat(2 * 1024 * 1024 + 1))),
      ),
    /2 MiB/,
  );
});
test("model selector loads account text candidates without substituting a hardcoded model", async () => {
  const models = await listModels(
    "test-key",
    mock((url, init) => {
      assert.equal(url, "https://api.openai.com/v1/models");
      assert.equal(init.method, "GET");
      return Response.json({
        data: [
          { id: "gpt-example" },
          { id: "gpt-example" },
          { id: "o3-example" },
          { id: "text-embedding-model" },
          { id: "gpt-audio-example" },
          { id: "invalid model" },
        ],
      });
    }),
  );
  assert.deepEqual(models, ["gpt-example", "o3-example"]);
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
