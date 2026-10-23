import React, { useEffect, useState, useRef } from "react";
import type { QueryPlan } from "../../../packages/plan-core/src/types";
import { ReactFlowProvider } from "@xyflow/react";
import type { PlanView } from "../graphPresentation";
import { ExecutablePlan } from "./ExecutablePlan";
export function LazyPlan({
  plan,
  view,
  revision,
}: {
  plan: QueryPlan;
  view: PlanView;
  revision: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "400px" },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} className="lazy-plan">
      {visible ? (
        <ReactFlowProvider>
          <ExecutablePlan plan={plan} view={view} revision={revision} />
        </ReactFlowProvider>
      ) : (
        <div className="plan-placeholder">Plan ready · scroll to explore</div>
      )}
    </div>
  );
}
