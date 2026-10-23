import { test } from "node:test";
import assert from "node:assert/strict";
import {
  optimizeRoutes,
  routeMetrics,
  validRoute,
  reconnectRoute,
  type Obstacle,
  type RouteRequest,
} from "../../webview/relationships/router";
const boxes: Obstacle[] = [
  { id: "a", x: 0, y: 0, width: 100, height: 80 },
  { id: "b", x: 600, y: 200, width: 100, height: 80 },
  { id: "c", x: 0, y: 200, width: 100, height: 80 },
  { id: "d", x: 600, y: 0, width: 100, height: 80 },
];
test("router separates shared lanes without moving tables or column endpoints", async () => {
  const requests: RouteRequest[] = [
    {
      id: "ab",
      source: "a",
      target: "b",
      points: [
        { x: 100, y: 40 },
        { x: 350, y: 40 },
        { x: 350, y: 240 },
        { x: 600, y: 240 },
      ],
    },
    {
      id: "cd",
      source: "c",
      target: "d",
      points: [
        { x: 100, y: 240 },
        { x: 300, y: 240 },
        { x: 300, y: 40 },
        { x: 600, y: 40 },
      ],
    },
  ];
  const result = await optimizeRoutes(requests, boxes);
  console.log(
    "Shared lane benchmark:",
    JSON.stringify({
      before: result.before,
      after: result.after,
      improved: result.improved,
    }),
  );
  assert.ok(result.after.sharedLength < result.before.sharedLength);
  assert.ok(result.after.crossings <= result.before.crossings);
  for (const request of requests)
    assert.ok(validRoute(request, result.routes.get(request.id)!, boxes));
});
test("routing preserves a clear existing path, avoids table obstacles and is cancellable", async () => {
  const request: RouteRequest = {
    id: "clear",
    source: "a",
    target: "d",
    points: [
      { x: 100, y: 40 },
      { x: 600, y: 40 },
    ],
  };
  const result = await optimizeRoutes([request], boxes);
  assert.deepEqual(result.routes.get(request.id), request.points);
  const obstructed = {
    ...request,
    points: [
      { x: 100, y: 40 },
      { x: 300, y: 40 },
      { x: 300, y: 240 },
      { x: 600, y: 240 },
    ],
  };
  assert.equal(
    validRoute(obstructed, obstructed.points, [
      ...boxes,
      { id: "blocker", x: 280, y: 100, width: 80, height: 80 },
    ]),
    false,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => optimizeRoutes([request], boxes, controller.signal),
    /cancelled/i,
  );
});

test("rerouting reconnects moved anchors and finds a safe path around intervening tables", async () => {
  const old = [
    { x: 100, y: 40 },
    { x: 600, y: 40 },
  ];
  const start = { x: 100, y: 50 },
    end = { x: 600, y: 250 };
  const points = reconnectRoute(old, start, end, "right", "left");
  const request = { id: "moved", source: "a", target: "b", points };
  const obstacles = [
    { id: "a", x: 0, y: 0, width: 100, height: 100 },
    { id: "b", x: 600, y: 200, width: 100, height: 100 },
    { id: "blocker", x: 250, y: 80, width: 100, height: 180 },
  ];
  const result = await optimizeRoutes([request], obstacles);
  assert.ok(validRoute(request, result.routes.get(request.id)!, obstacles));
  assert.deepEqual(result.routes.get(request.id)![0], start);
  assert.deepEqual(result.routes.get(request.id)!.at(-1), end);
});
test("crossing metrics distinguish shared lanes, proper crossings and endpoint touches", () => {
  assert.equal(
    routeMetrics(
      new Map([
        [
          "h",
          [
            { x: 0, y: 10 },
            { x: 20, y: 10 },
          ],
        ],
        [
          "v",
          [
            { x: 10, y: 0 },
            { x: 10, y: 20 },
          ],
        ],
      ]),
    ).crossings,
    1,
  );
  assert.equal(
    routeMetrics(
      new Map([
        [
          "a",
          [
            { x: 0, y: 10 },
            { x: 20, y: 10 },
          ],
        ],
        [
          "b",
          [
            { x: 20, y: 10 },
            { x: 30, y: 10 },
          ],
        ],
      ]),
    ).sharedLength,
    0,
  );
});

test("a separate routing pass reduces crossings while retaining port directions", async () => {
  const requests: RouteRequest[] = [
    {
      id: "horizontal",
      source: "a",
      target: "b",
      points: [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
      ],
    },
    {
      id: "bent",
      source: "c",
      target: "d",
      points: [
        { x: -50, y: -50 },
        { x: 100, y: -50 },
        { x: 100, y: 50 },
        { x: 250, y: 50 },
      ],
    },
  ];
  const result = await optimizeRoutes(requests, []);
  console.log(
    "Crossing benchmark:",
    JSON.stringify({ before: result.before, after: result.after }),
  );
  assert.ok(result.after.crossings < result.before.crossings);
  for (const request of requests)
    assert.ok(validRoute(request, result.routes.get(request.id)!, []));
});
