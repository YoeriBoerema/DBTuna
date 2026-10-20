import { test } from "node:test";
import assert from "node:assert/strict";
import { PostgresAdapter } from "../../packages/adapter-postgres/src/postgresAdapter";
import { presentEdges, nodeSize } from "../../webview/src/graphPresentation";
const plan = new PostgresAdapter().parse([
  {
    Plan: {
      "Node Type": "Nested Loop",
      Plans: [
        {
          "Node Type": "Seq Scan",
          "Plan Rows": 10000,
          "Parent Relationship": "Outer",
        },
        {
          "Node Type": "Index Scan",
          "Plan Rows": 1,
          "Parent Relationship": "Inner",
        },
      ],
    },
  },
]);
test("compact arrows follow data flow without modifying the canonical parent-child graph", () => {
  const before = JSON.stringify(plan);
  const compact = presentEdges(plan, "compact");
  assert.equal(compact[0].source, "0.0");
  assert.equal(compact[0].target, "0");
  assert.equal(compact[1].source, "0.1");
  assert.equal(compact[1].target, "0");
  assert.equal(JSON.stringify(plan), before);
  const cards = presentEdges(plan, "cards");
  assert.equal(cards[0].source, "0");
  assert.equal(cards[0].target, "0.0");
  assert.equal(cards[0].label, "Outer");
  assert.equal(cards[1].label, "Inner");
});
test("edge widths scale with estimated child rows and remain bounded with missing estimates", () => {
  const edges = presentEdges(plan, "compact");
  assert.ok(edges[0].style.strokeWidth > edges[1].style.strokeWidth);
  assert.equal(edges[0].style.strokeWidth, 5);
  const unknown = {
    ...plan,
    nodes: plan.nodes.map((n) => ({ ...n, estimates: undefined })),
  };
  assert.ok(
    presentEdges(unknown, "compact").every((e) => e.style.strokeWidth === 1),
  );
  assert.ok(nodeSize("compact").width < nodeSize("cards").width);
});
