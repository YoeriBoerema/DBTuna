import React, { useEffect, useState, useCallback, useRef, useId } from "react";
import type { PlanNode } from "../../../packages/plan-core/src/types";
import { createPortal } from "react-dom";
import {
  Handle,
  Position,
  useUpdateNodeInternals,
  type NodeProps,
  type Node,
} from "@xyflow/react";
import { OperatorIcon } from "../OperatorIcon";
import type { PlanView } from "../graphPresentation";
import { fmt } from "../format";
type FlowNode = Node<{ operator: PlanNode; view: PlanView }, "operator">;
export function Operator({ id, data, selected }: NodeProps<FlowNode>) {
  const n = data.operator;
  const compact = data.view === "compact";
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    const frame = requestAnimationFrame(() => updateNodeInternals(id));
    return () => cancelAnimationFrame(frame);
  }, [id, data.view, updateNodeInternals]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [tooltip, setTooltip] = useState<{ left: number; top: number }>();
  const tooltipId = useId();
  const dismiss = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
    setTooltip(undefined);
  }, []);
  useEffect(() => {
    dismiss();
    return () => clearTimeout(timer.current);
  }, [n, data.view, dismiss]);
  useEffect(() => {
    if (!tooltip) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", escape);
    window.addEventListener("wheel", dismiss, true);
    return () => {
      window.removeEventListener("keydown", escape);
      window.removeEventListener("wheel", dismiss, true);
    };
  }, [tooltip, dismiss]);
  return (
    <div
      className={
        "operator " +
        n.category +
        (compact ? " compact" : "") +
        (selected ? " selected" : "")
      }
      aria-describedby={tooltip ? tooltipId : undefined}
      onPointerEnter={(event) => {
        const element = event.currentTarget;
        clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          const rect = element.getBoundingClientRect();
          setTooltip({
            left: Math.max(8, Math.min(rect.left, window.innerWidth - 276)),
            top: Math.max(
              8,
              Math.min(
                rect.bottom + 10,
                window.innerHeight - (n.actuals ? 330 : 260),
              ),
            ),
          });
        }, 500);
      }}
      onPointerLeave={dismiss}
      onPointerDown={dismiss}
    >
      <Handle
        type="target"
        position={compact ? Position.Right : Position.Top}
      />
      {compact ? (
        <div className="operator-icon">
          <OperatorIcon node={n} />
        </div>
      ) : (
        <div className="node-category">
          {n.category.replace("_", " ")}
          <span>↗</span>
        </div>
      )}
      <strong>{n.label}</strong>
      <div className="relation">
        {n.object?.relation || n.object?.index || "Plan operation"}
      </div>
      {compact ? (
        <div className="compact-metrics">
          <span>Cost: {fmt(n.estimates?.totalCost)}</span>
          <span>
            {n.actuals
              ? "Actual rows: " + fmt(n.actuals.rows)
              : "Est. rows: " + fmt(n.estimates?.rows)}
          </span>
        </div>
      ) : (
        <div className="node-metrics">
          <span>
            {fmt(n.actuals ? n.actuals.rows : n.estimates?.rows)}
            <small>{n.actuals ? "actual rows" : "est. rows"}</small>
          </span>
          <span>
            {fmt(n.estimates?.totalCost)}
            <small>total cost</small>
          </span>
        </div>
      )}
      <Handle
        type="source"
        position={compact ? Position.Left : Position.Bottom}
      />
      {tooltip &&
        createPortal(
          <div
            id={tooltipId}
            role="tooltip"
            className="cost-tooltip"
            style={tooltip}
          >
            <strong>Cost estimates</strong>
            <div className="tooltip-operation">{n.label}</div>
            <dl>
              {Object.entries({
                ...(n.estimates?.costScope === "subtree"
                  ? {}
                  : { "Startup cost": n.estimates?.startupCost }),
                [n.estimates?.costScope === "subtree"
                  ? "Subtree cost"
                  : "Total cost"]: n.estimates?.totalCost,
                "Estimated CPU cost": n.estimates?.cpuCost,
                "Estimated I/O cost": n.estimates?.ioCost,
                "Estimated rows": n.estimates?.rows,
                "Row width (bytes)": n.estimates?.rowWidth,
                ...(n.actuals
                  ? {
                      "Actual rows": n.actuals.rows,
                      "Actual executions": n.actuals.loops,
                    }
                  : {}),
              }).map(([key, value]) => (
                <React.Fragment key={key}>
                  <dt>{key}</dt>
                  <dd>{fmt(value)}</dd>
                </React.Fragment>
              ))}
            </dl>
            <small>Optimizer cost units · not milliseconds</small>
          </div>,
          document.body,
        )}
    </div>
  );
}
