import { formatAdvice as presentAdvice } from "../../webview/src/advicePresentation";

import { parseAdvice } from "../../packages/plan-core/src/advice";

import { test } from "node:test";

import assert from "node:assert/strict";

import { readFileSync } from "node:fs";

import { PostgresAdapter } from "../../packages/adapter-postgres/src/postgresAdapter";

import { requestAdvice, listModels } from "../../src/extension/ai/openaiClient";

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

const mock = (
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
) =>
  ((url, init) => Promise.resolve(handler(String(url), init!))) as typeof fetch;

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
  assert.match(formatAdvice(result.advice), /^Score: 75\/100/);
  assert.match(formatAdvice(result.advice), /Suggestions\n-/);
  assert.match(
    formatAdvice(result.advice),
    /Updated query \(proposed\)\nSELECT \* FROM customers/,
  );
  assert.ok(!formatAdvice(result.advice).includes("Findings"));
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

test("OpenAI transport uses explicit operation timeouts independent of caller cancellation", async (context) => {
  const { jsonRequest } =
    await import("../../src/extension/ai/openaiTransport");
  const { AI_LIMITS } = await import("../../packages/plan-core/src/limits");
  const durations: number[] = [];
  context.mock.method(AbortSignal, "timeout", (duration: number) => {
    durations.push(duration);
    return new AbortController().signal;
  });
  await jsonRequest(
    "responses",
    "test",
    { method: "POST" },
    undefined,
    mock(() => Response.json({})),
  );
  await jsonRequest(
    "models",
    "test",
    { method: "GET" },
    new AbortController().signal,
    mock(() => Response.json({})),
  );
  assert.deepEqual(durations, [AI_LIMITS.requestMs, AI_LIMITS.modelListMs]);
});
