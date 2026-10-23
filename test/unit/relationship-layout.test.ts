import { test } from "node:test";
import assert from "node:assert/strict";
import {
  layoutRelationships,
  chooseConnectionSides,
  pairId,
  type TableSize,
  type Point,
} from "../../webview/relationships/layout";
import type { RelationshipGraph } from "../../src/extension/metadata/relationshipGraph";

test("column connections choose facing sides in both directions and keep self-loops outside the table", () => {
  const size = { width: 260, height: 200, ports: { id: 100, parent: 140 } };
  assert.deepEqual(
    chooseConnectionSides(
      { ...size, x: 0, y: 0 },
      { ...size, x: 600, y: 0 },
      "parent",
      "id",
    ),
    { source: "right", target: "left" },
  );
  assert.deepEqual(
    chooseConnectionSides(
      { ...size, x: 600, y: 0 },
      { ...size, x: 0, y: 0 },
      "parent",
      "id",
    ),
    { source: "left", target: "right" },
  );
  assert.deepEqual(
    chooseConnectionSides(
      { ...size, x: 0, y: 0 },
      { ...size, x: 0, y: 400 },
      "parent",
      "id",
    ),
    { source: "right", target: "right" },
  );
  assert.deepEqual(
    chooseConnectionSides(
      { ...size, x: 0, y: 0 },
      { ...size, x: 0, y: 0 },
      "parent",
      "id",
      true,
    ),
    { source: "right", target: "right" },
  );
});
test("schema layout keeps tall tables apart and routes column edges around other tables", async () => {
  const graph: RelationshipGraph = {
    schema: "test",
    tables: Array.from({ length: 18 }, (_, i) => ({
      id: String(i),
      schema: `schema_${i % 3}`,
      name: `table_${i}`,
      columns: ["id", "parent"],
      external: false,
    })),
    relationships: [],
  };
  for (let i = 0; i < 16; i++)
    graph.relationships.push({
      id: `fk${i}`,
      name: `fk${i}`,
      source: String(i),
      target: String((i + 4) % 16),
      columns: ["parent → id"],
      columnPairs: [{ source: "parent", target: "id" }],
    });
  const sizes = new Map<string, TableSize>(
    graph.tables.map((table, index) => [
      table.id,
      { width: 260, height: 200 + index * 15, ports: { id: 100, parent: 140 } },
    ]),
  );
  const layout = await layoutRelationships(graph, sizes);
  console.log(
    "Dense-schema routing benchmark:",
    JSON.stringify({
      before: layout.routing.before,
      after: layout.routing.after,
      searched: layout.routing.searched,
      limited: layout.routing.limited,
    }),
  );
  assert.equal(layout.groups.length, 3);
  for (const a of layout.groups)
    for (const b of layout.groups) {
      if (a.id === b.id) continue;
      const gapX = Math.max(a.x! - b.x! - b.width!, b.x! - a.x! - a.width!);
      const gapY = Math.max(a.y! - b.y! - b.height!, b.y! - a.y! - a.height!);
      assert.ok(
        Math.max(gapX, gapY) >= 600,
        `Schema gap too small: ${JSON.stringify({ gapX, gapY, a: a.id, b: b.id })}`,
      );
    }
  const boxes = graph.tables.map((table) => ({
    id: table.id,
    ...layout.positions.get(table.id)!,
    ...sizes.get(table.id)!,
  }));
  for (const a of boxes)
    for (const b of boxes) {
      if (a.id === b.id) continue;
      assert.ok(
        a.x + a.width <= b.x ||
          b.x + b.width <= a.x ||
          a.y + a.height <= b.y ||
          b.y + b.height <= a.y,
        `Overlapping tables ${a.id} and ${b.id}`,
      );
    }
  for (const edge of graph.relationships) {
    const route = layout.routes.get(pairId(edge.id, 0));
    assert.ok(route && route.length >= 2);
    const source = layout.positions.get(edge.source)!,
      target = layout.positions.get(edge.target)!;
    assert.equal(
      route[0].y,
      source.y + 140,
      JSON.stringify({ edge, route, source, target }),
    );
    assert.equal(route.at(-1)!.y, target.y + 100);
    const sides = layout.sides.get(pairId(edge.id, 0))!;
    assert.equal(
      route[0].x,
      source.x + (sides.source === "right" ? sizes.get(edge.source)!.width : 0),
    );
    assert.equal(
      route.at(-1)!.x,
      target.x + (sides.target === "right" ? sizes.get(edge.target)!.width : 0),
    );
    for (let i = 1; i < route.length; i++) {
      const a: Point = route[i - 1],
        b: Point = route[i];
      assert.ok(a.x === b.x || a.y === b.y, "Routes must be orthogonal");
      for (const box of boxes.filter(
        (box) => box.id !== edge.source && box.id !== edge.target,
      )) {
        const intersects: boolean =
          a.x === b.x
            ? a.x > box.x &&
              a.x < box.x + box.width &&
              Math.max(a.y, b.y) > box.y &&
              Math.min(a.y, b.y) < box.y + box.height
            : a.y > box.y &&
              a.y < box.y + box.height &&
              Math.max(a.x, b.x) > box.x &&
              Math.min(a.x, b.x) < box.x + box.width;
        assert.equal(
          intersects,
          false,
          `Route ${edge.id} crosses table ${box.id}`,
        );
      }
    }
  }
});
