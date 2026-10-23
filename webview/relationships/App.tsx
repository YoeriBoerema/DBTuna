import React, { useEffect, useState, useRef, useMemo } from "react";
import { schemaStyles } from "./colors";
import { createRoot } from "react-dom/client";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  MarkerType,
  useNodesState,
  useEdgesState,
  type NodeProps,
  type Node,
  type ReactFlowInstance,
} from "@xyflow/react";
import {
  layoutRelationships,
  pairId,
  chooseConnectionSides,
  type ConnectionSides,
} from "./layout";
import {
  optimizeRoutes,
  reconnectRoute,
  validRoute,
  type RouteRequest,
} from "./router";
import { measureTables } from "./measure";
import { RoutedEdge, type RelationshipEdge } from "./RoutedEdge";
import type {
  RelationshipGraph,
  DiagramTable,
} from "../../src/extension/metadata/relationshipGraph";
import "@xyflow/react/dist/style.css";
import "./style.css";
declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const vscode = acquireVsCodeApi();
function Table({ data }: NodeProps<Node<{ table: DiagramTable }>>) {
  const table = data.table;
  return (
    <article className={table.external ? "table external" : "table"}>
      <small>
        {table.schema}
        {table.external ? " · referenced table" : ""}
      </small>
      <strong>{table.name}</strong>
      <div className="columns">
        {table.columns.length ? (
          table.columns.map((column) => (
            <div className="column-row" key={column} data-column={column}>
              {(["left", "right"] as const).flatMap((side) =>
                (["source", "target"] as const).map((type) => (
                  <Handle
                    key={`${type}-${side}`}
                    id={JSON.stringify([type, column, side])}
                    type={type}
                    position={side === "left" ? Position.Left : Position.Right}
                  />
                )),
              )}
              <span>{column}</span>
            </div>
          ))
        ) : (
          <em>No foreign-key columns</em>
        )}
      </div>
    </article>
  );
}
function Schema({ data }: NodeProps<Node<{ label: string; pattern: string }>>) {
  return (
    <div className="schema-label">
      <svg
        className="schema-line-sample"
        width="40"
        height="14"
        viewBox="0 0 40 14"
        aria-hidden="true"
      >
        <line
          x1="2"
          y1="7"
          x2="38"
          y2="7"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={data.pattern}
        />
      </svg>
      {data.label}
    </div>
  );
}
const nodeTypes = { table: Table, schema: Schema };
const edgeTypes = { routed: RoutedEdge };
function App() {
  const [graph, setGraph] = useState<RelationshipGraph>();
  const palette = useMemo(
    () => schemaStyles(graph?.tables.map((table) => table.schema) ?? []),
    [graph],
  );
  const tableSchemas = useMemo(
    () => new Map(graph?.tables.map((table) => [table.id, table.schema]) ?? []),
    [graph],
  );
  const [error, setError] = useState("");
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<RelationshipEdge>([]);
  const [revision, setRevision] = useState(0);
  const [routingStatus, setRoutingStatus] = useState("");
  const [routingBusy, setRoutingBusy] = useState(false);
  const routingController = useRef<AbortController | undefined>(undefined);
  const [flow, setFlow] = useState<ReactFlowInstance<Node, RelationshipEdge>>();
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.data?.type === "GRAPH") setGraph(event.data.graph);
    };
    window.addEventListener("message", receive);
    vscode.postMessage({ type: "READY" });
    return () => {
      window.removeEventListener("message", receive);
      routingController.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!graph) return;
    let disposed = false;
    const controller = new AbortController();
    routingController.current?.abort();
    routingController.current = controller;
    setRoutingBusy(true);
    setError("");
    void document.fonts.ready
      .then(() =>
        layoutRelationships(
          graph,
          measureTables(graph.tables),
          controller.signal,
        ),
      )
      .then((result) => {
        if (disposed || controller.signal.aborted) return;
        setRoutingStatus(`${result.routing.after.crossings} line crossings`);
        setNodes([
          ...result.groups.map((group) => ({
            id: group.id,
            type: "schema",
            data: {
              label: JSON.parse(group.id)[1] as string,
              pattern:
                palette.get(JSON.parse(group.id)[1] as string)?.dashArray ?? "",
            },
            position: { x: group.x ?? 0, y: group.y ?? 0 },
            style: {
              width: group.width,
              height: group.height,
              "--schema-color": palette.get(JSON.parse(group.id)[1] as string)
                ?.color,
            } as React.CSSProperties,
            className: "schema-group",
            selectable: false,
          })),
          ...graph.tables.map((table) => ({
            id: table.id,
            type: "table",
            data: { table },
            style: {
              "--schema-color": palette.get(table.schema)?.color,
            } as React.CSSProperties,
            parentId: JSON.stringify(["schema", table.schema]),
            extent: "parent" as const,
            position: {
              x:
                result.positions.get(table.id)!.x -
                result.positions.get(JSON.stringify(["schema", table.schema]))!
                  .x,
              y:
                result.positions.get(table.id)!.y -
                result.positions.get(JSON.stringify(["schema", table.schema]))!
                  .y,
            },
          })),
        ]);
        setEdges(
          graph.relationships.flatMap((edge) =>
            edge.columnPairs.map((pair, index) => ({
              id: pairId(edge.id, index),
              source: edge.source,
              target: edge.target,
              sourceHandle: JSON.stringify([
                "source",
                pair.source,
                result.sides.get(pairId(edge.id, index))!.source,
              ]),
              targetHandle: JSON.stringify([
                "target",
                pair.target,
                result.sides.get(pairId(edge.id, index))!.target,
              ]),
              label: edge.name,
              type: "routed",
              markerEnd: { type: MarkerType.ArrowClosed },
              style: {
                stroke: "var(--vscode-textLink-foreground, #70aaff)",
                strokeWidth: 2,
              },
              labelStyle: { fill: "var(--vscode-editor-foreground)" },
              labelBgStyle: { fill: "var(--vscode-editor-background)" },
              data: {
                relationshipId: edge.id,
                columns: [`${pair.source} → ${pair.target}`],
                route: result.routes.get(pairId(edge.id, index)),
              },
            })),
          ),
        );
        requestAnimationFrame(() => {
          if (!disposed) void flow?.fitView({ padding: 0.15 });
        });
      })
      .catch(() => {
        if (!disposed && !controller.signal.aborted)
          setError("Could not lay out this database diagram.");
      })
      .finally(() => {
        if (!disposed && routingController.current === controller)
          setRoutingBusy(false);
      });
    return () => {
      disposed = true;
      controller.abort();
    };
  }, [graph, setNodes, setEdges, revision, flow, palette]);
  const rerouteExisting = async () => {
    if (!graph || !flow || routingBusy) return;
    const controller = new AbortController();
    routingController.current?.abort();
    routingController.current = controller;
    setRoutingBusy(true);
    setRoutingStatus("Finding clearer routes…");
    try {
      const sizes = measureTables(graph.tables);
      const currentNodes = new Map(
        flow.getNodes().map((node) => [node.id, node]),
      );
      const obstacles = graph.tables.map((table) => {
        const node = currentNodes.get(table.id)!;
        const parent = node.parentId
          ? currentNodes.get(node.parentId)?.position
          : undefined;
        return {
          id: table.id,
          x: node.position.x + (parent?.x ?? 0),
          y: node.position.y + (parent?.y ?? 0),
          ...sizes.get(table.id)!,
        };
      });
      const boxes = new Map(obstacles.map((box) => [box.id, box]));
      const currentEdges = new Map(
        flow.getEdges().map((edge) => [edge.id, edge]),
      );
      const sides = new Map<string, ConnectionSides>();
      const requests: RouteRequest[] = graph.relationships.flatMap((edge) =>
        edge.columnPairs.map((pair, index) => {
          const id = pairId(edge.id, index),
            source = boxes.get(edge.source)!,
            target = boxes.get(edge.target)!;
          const anchors = chooseConnectionSides(
            source,
            target,
            pair.source,
            pair.target,
            source.id === target.id,
          );
          sides.set(id, anchors);
          const start = {
            x: source.x + (anchors.source === "right" ? source.width : 0),
            y: source.y + source.ports[pair.source],
          };
          const end = {
            x: target.x + (anchors.target === "right" ? target.width : 0),
            y: target.y + target.ports[pair.target],
          };
          return {
            id,
            source: edge.source,
            target: edge.target,
            points: reconnectRoute(
              currentEdges.get(id)?.data?.route ?? [],
              start,
              end,
              anchors.source,
              anchors.target,
            ),
          };
        }),
      );
      const result = await optimizeRoutes(
        requests,
        obstacles,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (
        !requests.every((request) =>
          validRoute(request, result.routes.get(request.id)!, obstacles),
        )
      ) {
        setRoutingStatus(
          "Could not route safely in these positions. Move tables farther apart or use Auto layout.",
        );
        return;
      }
      setEdges((previous) =>
        previous.map((edge) => {
          const anchors = sides.get(edge.id)!;
          const source = JSON.parse(edge.sourceHandle!) as string[],
            target = JSON.parse(edge.targetHandle!) as string[];
          return {
            ...edge,
            sourceHandle: JSON.stringify([
              source[0],
              source[1],
              anchors.source,
            ]),
            targetHandle: JSON.stringify([
              target[0],
              target[1],
              anchors.target,
            ]),
            data: { ...edge.data!, route: result.routes.get(edge.id) },
          };
        }),
      );
      setRoutingStatus(`${result.after.crossings} line crossings`);
    } catch {
      if (!controller.signal.aborted)
        setRoutingStatus(
          "Could not reroute these connections. Try Auto layout.",
        );
    } finally {
      if (routingController.current === controller) setRoutingBusy(false);
    }
  };
  const [selection, setSelection] = useState("");
  const [activeRelationship, setActiveRelationship] = useState<string>();
  const clearSelection = () => {
    setActiveRelationship(undefined);
    setSelection("");
  };
  useEffect(() => {
    const clear = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActiveRelationship(undefined);
        setSelection("");
      }
    };
    window.addEventListener("keydown", clear);
    return () => window.removeEventListener("keydown", clear);
  }, []);
  const displayedEdges = edges.map((edge) => {
    const active = activeRelationship === edge.data?.relationshipId;
    const schemaStyle = palette.get(tableSchemas.get(edge.source) ?? "");
    const color = schemaStyle?.color ?? "var(--schema-palette-0)";
    return {
      ...edge,
      zIndex: active ? 1001 : 0,
      className: active
        ? "relationship-highlight"
        : activeRelationship
          ? "relationship-dimmed"
          : undefined,
      style: {
        ...edge.style,
        stroke: color,
        strokeWidth: active ? 4 : 2.5,
        strokeDasharray: schemaStyle?.dashArray ?? "",
        strokeLinecap: "round" as const,
        opacity: activeRelationship && !active ? 0.14 : 1,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color,
      },
    };
  });
  return (
    <main>
      <header>
        <h1>Table relationships{graph ? ` · ${graph.schema}` : ""}</h1>
        <div className="diagram-actions">
          <button
            onClick={() => void rerouteExisting()}
            disabled={!graph?.tables.length || routingBusy}
          >
            Reroute lines
          </button>
          <button
            onClick={() => setRevision((value) => value + 1)}
            disabled={!graph?.tables.length || routingBusy}
          >
            Auto layout
          </button>
        </div>
        <p>
          {graph
            ? `${graph.tables.length} tables · ${graph.relationships.length} foreign keys`
            : "Loading…"}{" "}
          · Arrows point from referencing table to referenced table. Drag
          tables, scroll to zoom. Lines use the source schema’s color and
          pattern.
          {routingStatus ? ` · ${routingStatus}` : ""}
        </p>
      </header>
      {error ? (
        <p role="alert">{error}</p>
      ) : graph && !graph.tables.length ? (
        <p className="empty">No visible tables in this database.</p>
      ) : (
        <ReactFlow
          nodes={nodes}
          edges={displayedEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onInit={setFlow}
          onNodesChange={onNodesChange}
          onNodeDragStop={() =>
            setRoutingStatus(
              "Tables moved. Use Reroute lines to update connections.",
            )
          }
          onEdgesChange={onEdgesChange}
          fitView
          minZoom={0.05}
          maxZoom={2}
          nodesConnectable={false}
          onPaneClick={clearSelection}
          onEdgeClick={(_, edge) => {
            setActiveRelationship(edge.data?.relationshipId);
            setSelection(
              `${edge.label}: ${(edge.data?.columns as string[]).join(", ")}`,
            );
          }}
        >
          <Background />
          <Controls />
          <MiniMap pannable zoomable />
        </ReactFlow>
      )}
      <footer>
        {selection ||
          (graph?.relationships.length === 0
            ? "No declared foreign keys found. Tables without relationships are still shown."
            : "Click a relationship to inspect its column mapping. Only metadata visible to your database account is shown.")}
      </footer>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
