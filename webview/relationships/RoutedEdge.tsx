import React from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
  type Edge,
} from "@xyflow/react";
import type { Point } from "./layout";
export type RelationshipEdge = Edge<{
  columns: string[];
  route?: Point[];
  relationshipId: string;
}>;
export function RoutedEdge(props: EdgeProps<RelationshipEdge>) {
  const route = props.data?.route;
  const first = route?.[0],
    last = route?.at(-1);
  const dx = props.sourceX - (first?.x ?? 0),
    dy = props.sourceY - (first?.y ?? 0);
  // Group drags can translate an entire route. Table drags use live handles until re-layout.
  const routed =
    first &&
    last &&
    Math.abs(props.targetX - last.x - dx) < 2 &&
    Math.abs(props.targetY - last.y - dy) < 2;
  const [fallback, labelX, labelY] = getSmoothStepPath(props);
  const path = routed
    ? route!
        .map((p, index) => `${index ? "L" : "M"} ${p.x + dx} ${p.y + dy}`)
        .join(" ")
    : fallback;
  const center = routed ? route![Math.floor(route!.length / 2)] : undefined;
  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        markerEnd={props.markerEnd}
        style={props.style}
        interactionWidth={20}
      />
      <title>
        {String(props.label)}: {props.data?.columns.join(", ")}
      </title>
      {props.selected && (
        <EdgeLabelRenderer>
          <div
            className="relationship-label nodrag nopan"
            style={{
              transform: `translate(-50%, -100%) translate(${center ? center.x + dx : labelX}px, ${center ? center.y + dy : labelY}px)`,
            }}
          >
            {props.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
