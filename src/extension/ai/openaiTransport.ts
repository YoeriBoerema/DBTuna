import { AI_LIMITS } from "../../../packages/plan-core/src/limits";
export async function jsonRequest(
  path: "models" | "responses",
  key: string,
  init: RequestInit,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  const timeoutMs =
    path === "models" ? AI_LIMITS.modelListMs : AI_LIMITS.requestMs;
  let response: Response;
  try {
    response = await fetcher("https://api.openai.com/v1/" + path, {
      ...init,
      redirect: "error",
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
      },
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
        : AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      await response.body?.cancel();
      const messages: Record<number, string> = {
        401: "API key was rejected. Update it in AI Assistance.",
        403: "This API key cannot access the selected resource or model.",
        404: "The selected model was not found or does not support the Responses API.",
        429: "OpenAI rate limit or API quota reached. Check your API account and retry later.",
        400: "OpenAI rejected the request. Check that the selected model supports structured text outputs through the Responses API.",
      };
      throw Error(
        messages[response.status] ||
          `OpenAI request failed (HTTP ${response.status}).`,
      );
    }
    const reader = response.body?.getReader();
    if (!reader) throw Error("OpenAI returned an empty response.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > AI_LIMITS.responseBytes)
          throw Error("OpenAI response exceeded 2 MiB.");
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
      string,
      unknown
    >;
  } catch (error) {
    if (signal?.aborted) throw Error("AI request cancelled.");
    if (
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    )
      throw Error(
        "OpenAI request timed out. Try again or select a faster model.",
      );
    if (error instanceof TypeError)
      throw Error("Could not reach OpenAI. Check your network connection.");
    if (error instanceof SyntaxError)
      throw Error("OpenAI returned an invalid response.");
    throw error;
  }
}
