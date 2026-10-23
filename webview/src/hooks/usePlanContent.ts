import { useEffect, useState } from "react";
import type { PlanBatch } from "../../../packages/plan-core/src/batch";
import type { QueryPlan } from "../../../packages/plan-core/src/types";
import type { ExtensionToWebview } from "../../../src/extension/webview/messages";
import { samePlanSnapshot } from "../../../packages/plan-core/src/snapshots";
import type { PlanView } from "../graphPresentation";
import { api } from "../vscodeApi";
export function usePlanContent() {
  const [saved] = useState(() => api.getState());
  const [view, setView] = useState<PlanView>(
    saved?.view === "cards" ? "cards" : "compact",
  );
  const [content, setContent] = useState<{
    plan?: QueryPlan;
    batch?: PlanBatch;
  }>(saved?.batch ? { batch: saved.batch } : { plan: saved?.plan });
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  const { plan, batch } = content;
  const firstPlan = plan || batch?.items.find((item) => item.plan)?.plan;
  const running = !!batch?.items.some(
    (item) => item.status === "pending" || item.status === "running",
  );
  const completed =
    batch?.items.filter((item) => item.status === "complete").length || 0;
  const failed =
    batch?.items.filter((item) => item.status === "error").length || 0;
  const skipped =
    batch?.items.filter((item) => item.status === "skipped").length || 0;
  useEffect(() => {
    const listener = (event: MessageEvent<ExtensionToWebview>) => {
      const m = event.data;
      if (m.type === "PLAN_LOADED") {
        setContent({ plan: m.payload });
        setError("");
        setBusy(false);
      } else if (m.type === "BATCH_LOADED") {
        setContent((current) => {
          const previous = current.batch;
          const next = m.payload;
          if (previous?.id !== next.id) return { batch: next };
          return {
            batch: {
              ...next,
              items: next.items.map((item, i) => {
                const before = previous.items[i];
                return before?.plan &&
                  item.plan &&
                  samePlanSnapshot(before.plan, item.plan)
                  ? { ...item, plan: before.plan }
                  : item;
              }),
            },
          };
        });
        setError("");
        setBusy(false);
      } else if (m.type === "PLAN_ERROR") {
        setError(m.message);
        setBusy(false);
      } else if (m.type === "LOADING") setBusy(m.loading);
    };
    window.addEventListener("message", listener);
    api.postMessage({ type: "WEBVIEW_READY" });
    return () => window.removeEventListener("message", listener);
  }, []);
  useEffect(() => {
    api.setState({ ...content, view });
  }, [content, view]);
  return {
    plan,
    batch,
    firstPlan,
    running,
    completed,
    failed,
    skipped,
    view,
    setView,
    error,
    busy,
    revision,
    setRevision,
  };
}
