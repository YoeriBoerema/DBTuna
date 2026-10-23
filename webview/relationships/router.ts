import type { Point } from "./layout";

export interface Obstacle extends Point {
  id: string;
  width: number;
  height: number;
}
export interface RouteRequest {
  id: string;
  source: string;
  target: string;
  points: Point[];
}
export interface RoutingMetrics {
  crossings: number;
  sharedLength: number;
  length: number;
  bends: number;
}
interface Segment {
  a: Point;
  b: Point;
  owner: string;
}
const EPS = 0.01;
const CLEARANCE = 12;
const LANE = 12;
const CROSSING_COST = 600;
const BEND_COST = 32;
const distance = (a: Point, b: Point) =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const equal = (a: Point, b: Point) => distance(a, b) < EPS;
const horizontal = (a: Point, b: Point) => Math.abs(a.y - b.y) < EPS;
function segments(points: Point[], owner: string): Segment[] {
  return points
    .slice(1)
    .map((b, i) => ({ a: points[i], b, owner }))
    .filter((s) => !equal(s.a, s.b));
}
function overlap(a: number, b: number, c: number, d: number) {
  return Math.max(
    0,
    Math.min(Math.max(a, b), Math.max(c, d)) -
      Math.max(Math.min(a, b), Math.min(c, d)),
  );
}
function interaction(a: Segment, b: Segment, includeArrival = false) {
  const ah = horizontal(a.a, a.b),
    bh = horizontal(b.a, b.b);
  if (ah === bh) {
    const gap = Math.abs(ah ? a.a.y - b.a.y : a.a.x - b.a.x);
    const shared = ah
      ? overlap(a.a.x, a.b.x, b.a.x, b.b.x)
      : overlap(a.a.y, a.b.y, b.a.y, b.b.y);
    return {
      crossings: 0,
      shared: gap < EPS ? shared : 0,
      nearby: gap > EPS && gap < LANE ? shared * (1 - gap / LANE) : 0,
    };
  }
  const h = ah ? a : b,
    v = ah ? b : a;
  // Endpoint touches are junctions, not crossings.
  const cross =
    v.a.x > Math.min(h.a.x, h.b.x) + EPS &&
    v.a.x < Math.max(h.a.x, h.b.x) - EPS &&
    h.a.y > Math.min(v.a.y, v.b.y) + EPS &&
    h.a.y < Math.max(v.a.y, v.b.y) - EPS;
  const arrival =
    includeArrival &&
    (ah
      ? Math.abs(a.b.x - v.a.x) < EPS &&
        a.b.y > Math.min(v.a.y, v.b.y) + EPS &&
        a.b.y < Math.max(v.a.y, v.b.y) - EPS
      : Math.abs(a.b.y - h.a.y) < EPS &&
        a.b.x > Math.min(h.a.x, h.b.x) + EPS &&
        a.b.x < Math.max(h.a.x, h.b.x) - EPS);
  return { crossings: cross || arrival ? 1 : 0, shared: 0, nearby: 0 };
}
// Spatial indexing bounds the cost of testing candidate segments against existing routes.
class SegmentIndex {
  private cells = new Map<string, Set<Segment>>();
  private byOwner = new Map<string, Segment[]>();
  private keys(a: Point, b: Point) {
    const keys: string[] = [];
    for (
      let x = Math.floor((Math.min(a.x, b.x) - LANE) / 160);
      x <= Math.floor((Math.max(a.x, b.x) + LANE) / 160);
      x++
    )
      for (
        let y = Math.floor((Math.min(a.y, b.y) - LANE) / 160);
        y <= Math.floor((Math.max(a.y, b.y) + LANE) / 160);
        y++
      )
        keys.push(`${x}:${y}`);
    return keys;
  }
  set(id: string, points: Point[]) {
    for (const s of this.byOwner.get(id) ?? [])
      for (const key of this.keys(s.a, s.b)) this.cells.get(key)?.delete(s);
    const list = segments(points, id);
    this.byOwner.set(id, list);
    for (const s of list)
      for (const key of this.keys(s.a, s.b)) {
        if (!this.cells.has(key)) this.cells.set(key, new Set());
        this.cells.get(key)!.add(s);
      }
  }
  candidates(a: Point, b: Point, owner: string) {
    const found = new Set<Segment>();
    const cells =
      (Math.abs(a.x - b.x) / 160 + 3) * (Math.abs(a.y - b.y) / 160 + 3);
    if (cells > 4096) {
      for (const [id, segments] of this.byOwner)
        if (id !== owner)
          for (const s of segments) {
            if (
              Math.max(s.a.x, s.b.x) + LANE >= Math.min(a.x, b.x) &&
              Math.min(s.a.x, s.b.x) - LANE <= Math.max(a.x, b.x) &&
              Math.max(s.a.y, s.b.y) + LANE >= Math.min(a.y, b.y) &&
              Math.min(s.a.y, s.b.y) - LANE <= Math.max(a.y, b.y)
            )
              found.add(s);
          }
      return found;
    }
    for (const key of this.keys(a, b))
      for (const segment of this.cells.get(key) ?? [])
        if (segment.owner !== owner) found.add(segment);
    return found;
  }
  cost(a: Point, b: Point, owner: string) {
    let cost = 0;
    for (const other of this.candidates(a, b, owner)) {
      const value = interaction({ a, b, owner }, other, true);
      cost +=
        value.crossings * CROSSING_COST + value.shared * 8 + value.nearby * 3;
    }
    return cost;
  }
}
export function routeMetrics(routes: Map<string, Point[]>): RoutingMetrics {
  const index = new SegmentIndex();
  const result = { crossings: 0, sharedLength: 0, length: 0, bends: 0 };
  for (const [id, points] of routes) {
    const list = segments(points, id);
    result.length += list.reduce((sum, s) => sum + distance(s.a, s.b), 0);
    result.bends += Math.max(0, list.length - 1);
    for (const s of list)
      for (const other of index.candidates(s.a, s.b, id)) {
        const value = interaction(s, other);
        result.crossings += value.crossings;
        result.sharedLength += value.shared;
      }
    index.set(id, points);
  }
  return result;
}
export function segmentHitsBox(a: Point, b: Point, box: Obstacle, margin = 0) {
  const left = box.x - margin,
    right = box.x + box.width + margin,
    top = box.y - margin,
    bottom = box.y + box.height + margin;
  return horizontal(a, b)
    ? a.y > top + EPS &&
        a.y < bottom - EPS &&
        overlap(a.x, b.x, left, right) > EPS
    : a.x > left + EPS &&
        a.x < right - EPS &&
        overlap(a.y, b.y, top, bottom) > EPS;
}
export function validRoute(
  request: RouteRequest,
  points: Point[],
  obstacles: Obstacle[],
) {
  if (
    points.length < 2 ||
    !equal(points[0], request.points[0]) ||
    !equal(points.at(-1)!, request.points.at(-1)!)
  )
    return false;
  const start = points[0],
    end = points.at(-1)!;
  const first = request.points.find((p) => !equal(start, p)),
    last = [...request.points].reverse().find((p) => !equal(end, p));
  if (
    first &&
    (points[1].x - start.x) * (first.x - start.x) +
      (points[1].y - start.y) * (first.y - start.y) <=
      0
  )
    return false;
  if (
    last &&
    (points.at(-2)!.x - end.x) * (last.x - end.x) +
      (points.at(-2)!.y - end.y) * (last.y - end.y) <=
      0
  )
    return false;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    if (
      ![a.x, a.y, b.x, b.y].every(Number.isFinite) ||
      (!horizontal(a, b) && Math.abs(a.x - b.x) > EPS)
    )
      return false;
    for (const box of obstacles) if (segmentHitsBox(a, b, box)) return false;
  }
  return true;
}
function compact(points: Point[]) {
  const result: Point[] = [];
  for (const point of points) {
    if (result.length && equal(result.at(-1)!, point)) continue;
    while (result.length >= 2) {
      const a = result.at(-2)!,
        b = result.at(-1)!;
      if (
        horizontal(a, b) === horizontal(b, point) &&
        ((horizontal(a, b) && horizontal(b, point)) ||
          (Math.abs(a.x - b.x) < EPS && Math.abs(b.x - point.x) < EPS))
      )
        result.pop();
      else break;
    }
    result.push(point);
  }
  return result;
}
interface QueueItem {
  state: number;
  cost: number;
  priority: number;
}
class Heap {
  items: QueueItem[] = [];
  push(item: QueueItem) {
    let i = this.items.length;
    this.items.push(item);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.items[parent].priority <= item.priority) break;
      this.items[i] = this.items[parent];
      i = parent;
    }
    this.items[i] = item;
  }
  pop() {
    const first = this.items[0],
      last = this.items.pop()!;
    if (this.items.length) {
      let i = 0;
      while (2 * i + 1 < this.items.length) {
        let child = 2 * i + 1;
        if (
          child + 1 < this.items.length &&
          this.items[child + 1].priority < this.items[child].priority
        )
          child++;
        if (this.items[child].priority >= last.priority) break;
        this.items[i] = this.items[child];
        i = child;
      }
      this.items[i] = last;
    }
    return first;
  }
}
function routeCost(points: Point[], id: string, index: SegmentIndex) {
  const list = segments(points, id);
  return (
    list.reduce(
      (cost, s) => cost + distance(s.a, s.b) + index.cost(s.a, s.b, id),
      0,
    ) +
    Math.max(0, list.length - 1) * BEND_COST
  );
}

// A bounded rectilinear visibility grid. Table boundaries and existing route lanes
// supply useful coordinates; A* includes incoming direction so bends have a cost.
function search(
  request: RouteRequest,
  obstacles: Obstacle[],
  index: SegmentIndex,
  lane: number,
  deadline: number,
): Point[] | undefined {
  const start = request.points[0],
    end = request.points.at(-1)!;
  const first = request.points.find((p) => !equal(start, p));
  const last = [...request.points].reverse().find((p) => !equal(end, p));
  if (!first || !last) return;
  const sourceDir = first.x >= start.x ? 1 : -1,
    targetDir = last.x >= end.x ? 1 : -1;
  const lead = 24 + (lane % 4) * LANE;
  const source = { x: start.x + sourceDir * lead, y: start.y },
    target = { x: end.x + targetDir * lead, y: end.y };
  if (
    obstacles.some(
      (box) =>
        segmentHitsBox(start, source, box) || segmentHitsBox(target, end, box),
    )
  )
    return;
  const xs = new Set([source.x, target.x]),
    ys = new Set([source.y, target.y]);
  const left =
    Math.min(...request.points.map((p) => p.x), source.x, target.x) - 80;
  const right =
    Math.max(...request.points.map((p) => p.x), source.x, target.x) + 80;
  const top = Math.min(...request.points.map((p) => p.y)) - 80,
    bottom = Math.max(...request.points.map((p) => p.y)) + 80;
  const nearby = obstacles.filter(
    (box) =>
      box.x < right &&
      box.x + box.width > left &&
      box.y < bottom &&
      box.y + box.height > top,
  );
  if (nearby.length > 100) return;
  for (const box of nearby) {
    for (const x of [
      box.x - CLEARANCE,
      box.x - CLEARANCE - LANE,
      box.x + box.width + CLEARANCE,
      box.x + box.width + CLEARANCE + LANE,
    ])
      if (x >= left && x <= right) xs.add(x);
    for (const y of [
      box.y - CLEARANCE,
      box.y - CLEARANCE - LANE,
      box.y + box.height + CLEARANCE,
      box.y + box.height + CLEARANCE + LANE,
    ])
      if (y >= top && y <= bottom) ys.add(y);
  }
  for (const p of request.points) {
    xs.add(p.x);
    ys.add(p.y);
  }
  for (const s of index.candidates(
    { x: left, y: top },
    { x: right, y: bottom },
    request.id,
  )) {
    if (horizontal(s.a, s.b)) {
      ys.add(s.a.y - LANE);
      ys.add(s.a.y + LANE);
    } else {
      xs.add(s.a.x - LANE);
      xs.add(s.a.x + LANE);
    }
  }
  xs.add(left);
  xs.add(right);
  ys.add(top);
  ys.add(bottom);
  const xx = [...xs]
      .filter((x) => x >= left && x <= right)
      .sort((a, b) => a - b),
    yy = [...ys].filter((y) => y >= top && y <= bottom).sort((a, b) => a - b);
  if (xx.length * yy.length > 18000) return;
  const width = xx.length,
    count = width * yy.length;
  const point = (id: number) => ({
    x: xx[id % width],
    y: yy[Math.floor(id / width)],
  });
  const sourceId = yy.indexOf(source.y) * width + xx.indexOf(source.x),
    targetId = yy.indexOf(target.y) * width + xx.indexOf(target.x);
  const blocked = new Uint8Array(count);
  for (let id = 0; id < count; id++) {
    const p = point(id);
    if (
      nearby.some(
        (b) =>
          p.x > b.x - CLEARANCE + EPS &&
          p.x < b.x + b.width + CLEARANCE - EPS &&
          p.y > b.y - CLEARANCE + EPS &&
          p.y < b.y + b.height + CLEARANCE - EPS,
      )
    )
      blocked[id] = 1;
  }
  if (blocked[sourceId] || blocked[targetId]) return;
  const costs = new Float64Array(count * 2);
  costs.fill(Infinity);
  const previous = new Int32Array(count * 2);
  previous.fill(-1);
  const queue = new Heap();
  costs[sourceId * 2] = 0;
  queue.push({
    state: sourceId * 2,
    cost: 0,
    priority: distance(source, target),
  });
  const connectionCache = new Map<string, number>();
  let expansions = 0;
  while (queue.items.length && expansions++ < 40000) {
    if (expansions % 128 === 0 && performance.now() > deadline) return;
    const current = queue.pop();
    if (current.cost !== costs[current.state]) continue;
    const id = Math.floor(current.state / 2),
      dir = current.state % 2;
    if (id === targetId) {
      const path: Point[] = [];
      let state = current.state;
      while (state !== -1) {
        path.push(point(Math.floor(state / 2)));
        state = previous[state];
      }
      const result = compact([start, ...path.reverse(), end]);
      if (validRoute(request, result, obstacles)) return result;
      return;
    }
    const x = id % width,
      y = Math.floor(id / width),
      a = point(id);
    for (const next of [
      x > 0 ? id - 1 : -1,
      x + 1 < width ? id + 1 : -1,
      y > 0 ? id - width : -1,
      y + 1 < yy.length ? id + width : -1,
    ]) {
      if (next < 0 || blocked[next]) continue;
      const b = point(next),
        nextDir = horizontal(a, b) ? 0 : 1;
      const key = `${id}:${next}`;
      let step = connectionCache.get(key);
      if (step === undefined) {
        step = nearby.some((box) => segmentHitsBox(a, b, box, CLEARANCE))
          ? Infinity
          : distance(a, b) + index.cost(a, b, request.id);
        connectionCache.set(key, step);
      }
      const cost =
        current.cost +
        step +
        (dir !== nextDir ? BEND_COST : 0) +
        (next === targetId && nextDir !== 0 ? BEND_COST : 0);
      const state = next * 2 + nextDir;
      if (cost < costs[state]) {
        costs[state] = cost;
        previous[state] = current.state;
        queue.push({ state, cost, priority: cost + distance(b, target) });
      }
    }
  }
}

export async function optimizeRoutes(
  requests: RouteRequest[],
  obstacles: Obstacle[],
  signal?: AbortSignal,
) {
  if (signal?.aborted) throw Error("Routing cancelled.");
  const routes = new Map(
    requests.map((request) => [request.id, request.points]),
  );
  const before = routeMetrics(routes);
  const index = new SegmentIndex();
  for (const [id, points] of routes) index.set(id, points);
  let improved = 0,
    searched = 0;
  const ordered = requests
    .map((request) => ({
      request,
      score: routeCost(request.points, request.id, index),
    }))
    .sort(
      (a, b) => b.score - a.score || a.request.id.localeCompare(b.request.id),
    )
    .map((entry) => entry.request);
  const deadline = performance.now() + 2500;
  let limited = false;
  const originalValid = requests.every((request) =>
    validRoute(request, request.points, obstacles),
  );
  // Work caps keep large database diagrams responsive. Untouched ELK routes are retained.
  for (let pass = 0; pass < 2; pass++) {
    for (const request of ordered) {
      if (signal?.aborted) throw Error("Routing cancelled.");
      const current = routes.get(request.id)!;
      const currentCost = validRoute(request, current, obstacles)
        ? routeCost(current, request.id, index)
        : Infinity;
      if (pass > 0 && currentCost < 500) continue;
      if (searched >= 500 || performance.now() > deadline) {
        limited = true;
        break;
      }
      searched++;
      const candidate = search(
        { ...request, points: current },
        obstacles,
        index,
        searched,
        deadline,
      );
      if (
        candidate &&
        routeCost(candidate, request.id, index) + EPS < currentCost
      ) {
        routes.set(request.id, candidate);
        index.set(request.id, candidate);
        improved++;
      }
      if (searched % 6 === 0)
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  const after = routeMetrics(routes);
  const score = (metrics: RoutingMetrics) =>
    metrics.crossings * CROSSING_COST +
    metrics.sharedLength * 8 +
    metrics.length +
    metrics.bends * BEND_COST;
  if (
    originalValid &&
    (after.crossings > before.crossings || score(after) > score(before) + EPS)
  ) {
    return {
      routes: new Map(requests.map((request) => [request.id, request.points])),
      before,
      after: before,
      improved: 0,
      searched,
      limited,
    };
  }
  return { routes, before, after, improved, searched, limited };
}

// Reconnect moved column anchors to the previous route with orthogonal lead-ins.
// The optimizer validates this sketch and must find a safe route before it is used.
export function reconnectRoute(
  points: Point[],
  source: Point,
  target: Point,
  sourceSide: "left" | "right",
  targetSide: "left" | "right",
) {
  if (
    points.length >= 2 &&
    equal(points[0], source) &&
    equal(points.at(-1)!, target)
  )
    return points;
  const a = { x: source.x + (sourceSide === "right" ? 24 : -24), y: source.y };
  const b = { x: target.x + (targetSide === "right" ? 24 : -24), y: target.y };
  const middle = points.slice(1, -1);
  if (!middle.length) return [source, a, { x: a.x, y: b.y }, b, target];
  return [
    source,
    a,
    { x: a.x, y: middle[0].y },
    ...middle,
    { x: b.x, y: middle.at(-1)!.y },
    b,
    target,
  ].filter((point, i, list) => !i || !equal(point, list[i - 1]));
}
