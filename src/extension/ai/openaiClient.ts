import { z } from "zod";
import {
  parseAdvice,
  adviceSchema,
} from "../../../packages/plan-core/src/advice";
import { AI_LIMITS } from "../../../packages/plan-core/src/limits";
import { AI_INSTRUCTIONS } from "./adviceInstructions";
import { advicePayload, type AiInput } from "./advicePayload";
import { jsonRequest } from "./openaiTransport";
// Provider shape derives from the same schema used for local validation. Cross-field
// refinements (suggestions require SQL) remain enforced by parseAdvice.
export const adviceJsonSchema = z.toJSONSchema(adviceSchema);
export function validModel(id: string) {
  return /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(id);
}
export async function listModels(key: string, fetcher: typeof fetch = fetch) {
  const value = await jsonRequest(
    "models",
    key,
    { method: "GET" },
    undefined,
    fetcher,
  );
  if (!Array.isArray(value.data))
    throw Error("OpenAI returned an invalid model list.");
  return [
    ...new Set(
      value.data.flatMap((model) =>
        model &&
        typeof model.id === "string" &&
        validModel(model.id) &&
        /^(gpt-|o[134](?:-|$)|chatgpt-)/i.test(model.id) &&
        !/(audio|realtime|image|transcrib|tts|embedding|moderation)/i.test(
          model.id,
        )
          ? [model.id as string]
          : [],
      ),
    ),
  ].sort();
}
export async function requestAdvice(
  key: string,
  model: string,
  input: AiInput,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
) {
  if (!validModel(model))
    throw Error("Select a valid OpenAI model in AI Assistance.");
  const value = await jsonRequest(
    "responses",
    key,
    {
      method: "POST",
      body: JSON.stringify({
        model,
        store: false,
        instructions: AI_INSTRUCTIONS,
        input: advicePayload(input),
        max_output_tokens: AI_LIMITS.outputTokens,
        text: {
          format: {
            type: "json_schema",
            name: "query_optimization_advice",
            strict: true,
            schema: adviceJsonSchema,
          },
        },
      }),
    },
    signal,
    fetcher,
  );
  if (value.status === "incomplete")
    throw Error(
      "AI response reached its output limit. Try again or choose another model.",
    );
  if (value.error || value.status === "failed")
    throw Error("OpenAI could not generate advice. Try another model.");
  const output = Array.isArray(value.output) ? value.output : [];
  const text = output
    .flatMap((item) =>
      item?.type === "message" && Array.isArray(item.content)
        ? item.content.flatMap((part: { type?: string; text?: unknown }) =>
            part.type === "output_text" && typeof part.text === "string"
              ? [part.text]
              : [],
          )
        : [],
    )
    .join("\n\n")
    .trim();
  if (!text)
    throw Error(
      "The model returned no advice text. Try again or choose another model.",
    );
  return {
    advice: (() => {
      let advice: unknown;
      try {
        advice = JSON.parse(text);
      } catch {
        throw Error(
          "AI returned an invalid suggestions format. Choose a model supporting structured outputs.",
        );
      }
      return parseAdvice(advice);
    })(),
    model: typeof value.model === "string" ? value.model : model,
  };
}
