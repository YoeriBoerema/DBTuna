import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js";
import { optimizeRoutes } from "./router";
import type { RelationshipGraph } from "../../src/extension/metadata/relationshipGraph";
export interface TableSize {
  width: number;
  height: number;
  ports: Record<string, number>;
}
export interface Point {
  x: number;
  y: number;
}
export const pairId = (id: string, index: number) =>
  JSON.stringify([id, index]);
export type Side = "left" | "right";
export interface ConnectionSides {
  source: Side;
  target: Side;
}
export const portId = (
  table: string,
  type: string,
  column: string,
  side: Side,
) => JSON.stringify([table, type, column, side]);
export function chooseConnectionSides(
  source: Point & TableSize,
  target: Point & TableSize,
  sourceColumn: string,
  targetColumn: string,
  self = false,
): ConnectionSides {
  if (self) return { source: "right", target: "right" };
  let best = { source: "right", target: "left" } as ConnectionSides;
  let cost = Infinity;
  for (const sourceSide of ["right", "left"] as const)
    for (const targetSide of ["left", "right"] as const) {
      const sx = source.x + (sourceSide === "right" ? source.width : 0);
      const tx = target.x + (targetSide === "right" ? target.width : 0);
      const sy = source.y + source.ports[sourceColumn],
        ty = target.y + target.ports[targetColumn];
      const backtrack = (sourceSide === "right" ? tx < sx : tx > sx) ? 160 : 0;
      const approach = (targetSide === "left" ? sx > tx : sx < tx) ? 160 : 0;
      const candidate =
        Math.abs(tx - sx) + Math.abs(ty - sy) + backtrack + approach;
      if (candidate < cost) {
        cost = candidate;
        best = { source: sourceSide, target: targetSide };
      }
    }
  return best;
}
export async function layoutRelationships(
  graph: RelationshipGraph,
  sizes: Map<string, TableSize>,
  signal?: AbortSignal,
) {
  const schemas = [...new Set(graph.tables.map((t) => t.schema))].sort();
  const options = {
    "elk.algorithm": "layered",
    "elk.direction": "RIGHT",
    "elk.edgeRouting": "ORTHOGONAL",
    "elk.hierarchyHandling": "INCLUDE_CHILDREN",
    "elk.layered.mergeHierarchyEdges": "false",
    "elk.layered.mergeEdges": "false",
    "elk.spacing.nodeNode": "100",
    "elk.spacing.edgeNode": "32",
    "elk.spacing.edgeEdge": "18",
    "elk.layered.spacing.nodeNodeBetweenLayers": "220",
    "elk.layered.spacing.edgeNodeBetweenLayers": "40",
    "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
    "elk.layered.crossingMinimization.greedySwitch.type": "TWO_SIDED",
    "elk.randomSeed": "7",
  };
  const sides = new Map<string, ConnectionSides>();
  const run = () =>
    new ELK().layout({
      id: "root",
      layoutOptions: {
        ...options,
        "elk.spacing.nodeNode": "700",
        "elk.spacing.componentComponent": "700",
        "elk.layered.spacing.nodeNodeBetweenLayers": "900",
      },
      children: schemas.map((schema) => ({
        id: JSON.stringify(["schema", schema]),
        layoutOptions: {
          ...options,
          "elk.spacing.individual":
            "org.eclipse.elk.spacing.nodeNode:700;,;org.eclipse.elk.layered.spacing.nodeNodeBetweenLayers:900",
          "elk.padding": "[top=64,left=48,bottom=48,right=48]",
        },
        children: graph.tables
          .filter((t) => t.schema === schema)
          .map((table) => {
            const size = sizes.get(table.id)!;
            return {
              id: table.id,
              width: size.width,
              height: size.height,
              layoutOptions: { "elk.portConstraints": "FIXED_POS" },
              ports: table.columns.flatMap((column) =>
                ["source", "target"].flatMap((type) =>
                  (["left", "right"] as const).map((side) => ({
                    id: portId(table.id, type, column, side),
                    width: 0,
                    height: 0,
                    x: side === "right" ? size.width : 0,
                    y: size.ports[column],
                    layoutOptions: {
                      "elk.port.side": side === "right" ? "EAST" : "WEST",
                    },
                  })),
                ),
              ),
            };
          }),
      })),
      edges: graph.relationships.flatMap((edge) =>
        edge.columnPairs.map((pair, index) => ({
          id: pairId(edge.id, index),
          sources: [
            portId(
              edge.source,
              "source",
              pair.source,
              sides.get(pairId(edge.id, index))?.source ?? "right",
            ),
          ],
          targets: [
            portId(
              edge.target,
              "target",
              pair.target,
              sides.get(pairId(edge.id, index))?.target ?? "left",
            ),
          ],
        })),
      ),
    });
  let result = await run();
  const positions = new Map<string, Point>();
  const routes = new Map<string, Point[]>();
  const collect = (node: ElkNode, offset: Point) => {
    for (const child of node.children ?? []) {
      const position = {
        x: offset.x + (child.x ?? 0),
        y: offset.y + (child.y ?? 0),
      };
      positions.set(child.id, position);
      collect(child, position);
    }
    for (const edge of node.edges ?? []) {
      const section = edge.sections?.[0];
      const origin = edge.container
        ? (positions.get(edge.container) ?? offset)
        : offset;
      if (section)
        routes.set(
          edge.id,
          [
            section.startPoint,
            ...(section.bendPoints ?? []),
            section.endPoint,
          ].map((p) => ({ x: p.x + origin.x, y: p.y + origin.y })),
        );
    }
  };
  collect(result, { x: 0, y: 0 });
  for (const edge of graph.relationships)
    edge.columnPairs.forEach((pair, index) => {
      sides.set(
        pairId(edge.id, index),
        chooseConnectionSides(
          { ...positions.get(edge.source)!, ...sizes.get(edge.source)! },
          { ...positions.get(edge.target)!, ...sizes.get(edge.target)! },
          pair.source,
          pair.target,
          edge.source === edge.target,
        ),
      );
    });
  result = await run();
  positions.clear();
  routes.clear();
  collect(result, { x: 0, y: 0 });
  const routing = await optimizeRoutes(
    graph.relationships.flatMap((edge) =>
      edge.columnPairs.map((_, index) => ({
        id: pairId(edge.id, index),
        source: edge.source,
        target: edge.target,
        points: routes.get(pairId(edge.id, index))!,
      })),
    ),
    graph.tables.map((table) => ({
      id: table.id,
      ...positions.get(table.id)!,
      ...sizes.get(table.id)!,
    })),
    signal,
  );
  return {
    positions,
    routes: routing.routes,
    groups: result.children ?? [],
    sides,
    routing,
  };
}
