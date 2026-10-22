import { formatAdvice } from "../advicePresentation";
import { SQL_LIMITS, AI_LIMITS } from "../../../packages/plan-core/src/limits";
import React from "react";
import type {
  PlanNode,
  QueryPlan,
} from "../../../packages/plan-core/src/types";
import { api } from "../vscodeApi";
import { useAiAdvice } from "../hooks/useAiAdvice";
export function AiAdvice({ plan, node }: { plan: QueryPlan; node: PlanNode }) {
  const {
    context,
    setContext,
    query,
    setQuery,
    pending,
    result,
    contextId,
    queryId,
    analyze,
    cancel,
  } = useAiAdvice(plan, node);
  return (
    <section className="ai-assistance" aria-label="AI Assistance">
      <h3>AI Assistance</h3>
      <p className="ai-disclosure">
        Sends this query, its plan, the selected operator and your context to
        OpenAI. API usage charges apply.
      </p>
      {!plan.query?.trim() && (
        <>
          <label htmlFor={queryId}>SQL query</label>
          <textarea
            id={queryId}
            value={query}
            maxLength={SQL_LIMITS.characters}
            rows={4}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Paste the SQL for this imported plan"
          />
        </>
      )}
      <label htmlFor={contextId}>Additional context (optional)</label>
      <textarea
        id={contextId}
        value={context}
        maxLength={AI_LIMITS.contextCharacters}
        rows={3}
        onChange={(e) => setContext(e.target.value)}
        placeholder="What should the advice focus on?"
      />
      <div className="ai-controls">
        <button
          className="primary"
          disabled={pending || !(plan.query?.trim() || query.trim())}
          onClick={analyze}
        >
          {pending ? "Analyzing..." : "Get AI advice"}
        </button>
        {pending && <button onClick={cancel}>Cancel</button>}
        <button onClick={() => api.postMessage({ type: "AI_SETTINGS" })}>
          Settings
        </button>
      </div>
      <div aria-live="polite" aria-busy={pending}>
        {pending && <p>Waiting for OpenAI...</p>}
        {result?.error && (
          <p role="alert" className="ai-error">
            {result.error}
          </p>
        )}
        {result?.advice && (
          <>
            <div className="ai-output">{formatAdvice(result.advice)}</div>
            <small>
              Model: {result.model} - review proposed SQL before use
            </small>
          </>
        )}
      </div>
    </section>
  );
}
