import React from "react";
import type {
  PlanNode,
  QueryPlan,
} from "../../../packages/plan-core/src/types";
import { AiAdvice } from "./AiAdvice";
import { fmt } from "../format";
export function Details({ node, plan }: { node?: PlanNode; plan: QueryPlan }) {
  if (!node)
    return (
      <aside>
        <h2>Operator details</h2>
        <p>Select an operation to inspect its estimates and properties.</p>
      </aside>
    );
  return (
    <aside>
      <div className="eyebrow">OPERATOR DETAILS</div>
      <h2>{node.label}</h2>
      <span className="tag">{node.category}</span>
      <h3>Identification</h3>
      <dl>
        {Object.entries({
          "Native operator": node.nativeType,
          Relation: node.object?.relation,
          Schema: node.object?.schema,
          Alias: node.object?.alias,
          Index: node.object?.index,
        }).map(([k, v]) => (
          <React.Fragment key={k}>
            <dt>{k}</dt>
            <dd>{fmt(v)}</dd>
          </React.Fragment>
        ))}
      </dl>
      <h3>
        Cost estimates <span>optimizer units</span>
      </h3>
      <dl>
        {Object.entries({
          ...(node.estimates?.costScope === "subtree"
            ? {}
            : { "Startup cost": node.estimates?.startupCost }),
          [node.estimates?.costScope === "subtree"
            ? "Subtree cost"
            : "Total cost"]: node.estimates?.totalCost,
          "Estimated CPU cost": node.estimates?.cpuCost,
          "Estimated I/O cost": node.estimates?.ioCost,
          "Estimated rows": node.estimates?.rows,
          "Row width (bytes)": node.estimates?.rowWidth,
        }).map(([k, v]) => (
          <React.Fragment key={k}>
            <dt>{k}</dt>
            <dd>{fmt(v)}</dd>
          </React.Fragment>
        ))}
      </dl>
      <h3>
        Actual execution{" "}
        <span>{node.actuals ? "measured metrics" : "not measured"}</span>
      </h3>
      <dl>
        {Object.entries({
          [node.actuals?.rowsScope === "total"
            ? "Actual rows (total)"
            : "Actual rows (per loop)"]: node.actuals?.rows,
          ...(node.actuals?.elapsedTimeMs !== undefined
            ? { "Max thread elapsed (ms)": node.actuals.elapsedTimeMs }
            : {}),
          ...(node.actuals?.cpuTimeMs !== undefined
            ? { "CPU across threads (ms)": node.actuals.cpuTimeMs }
            : {}),
          [node.actuals?.rowsScope === "total" ? "Executions (sum)" : "Loops"]:
            node.actuals?.loops,
          ...(node.actuals?.rowsScope === "total"
            ? {}
            : {
                "Startup per loop (ms)": node.actuals?.startupTimeMs,
                "Total per loop (ms)": node.actuals?.totalTimeMs,
              }),
        }).map(([k, v]) => (
          <React.Fragment key={k}>
            <dt>{k}</dt>
            <dd>{fmt(v)}</dd>
          </React.Fragment>
        ))}
      </dl>
      <h3>Native attributes</h3>
      {Object.entries(node.properties).map(([k, v]) => (
        <details key={k}>
          <summary>{k}</summary>
          <pre>{JSON.stringify(v, null, 2)}</pre>
        </details>
      ))}
      <AiAdvice key={plan.id + ":" + node.id} plan={plan} node={node} />
    </aside>
  );
}
