import type { SimLayout } from "./types";

/**
 * Маршруты роботов по сетке проходов склада. Робот ездит только вдоль осей: по стеллажному
 * проходу (или полосе ворот) вертикально, по поперечному проезду горизонтально. Поэтому длина
 * маршрута — сумма модулей приращений, без корня: результат одинаков в любом движке.
 *
 * Разъезды роботов и заторы в проходах не моделируются (ТЗ §5.7 — «не моделируется»): маршрут
 * не зависит от положения других роботов.
 */

/** Точка на планировке, м от левого нижнего угла. */
export type Waypoint = { x: number; y: number };

/** Допуск, в пределах которого две координаты X считаются одним проходом, м. */
const SAME_AISLE_EPS = 1e-9;

/**
 * Поперечный проезд, через который путь из (ay) в (by) короче всего:
 * min по c из |ay − c| + |by − c|; при равенстве — проезд с меньшим индексом.
 */
function bestCrossAisle(crossAislesY: readonly number[], ay: number, by: number): number {
  let best = crossAislesY[0] ?? 0;
  let bestLen = Infinity;
  for (const c of crossAislesY) {
    const len = Math.abs(ay - c) + Math.abs(by - c);
    if (len < bestLen) {
      bestLen = len;
      best = c;
    }
  }
  return best;
}

/**
 * Длина маршрута между двумя точками, м, без построения списка точек — для перебора пар в
 * аналитике и для выбора ближайшего свободного робота. Совпадает с
 * `routeLengthM(route(layout, a, b))`.
 */
export function routeLengthBetween(layout: SimLayout, ax: number, ay: number, bx: number, by: number): number {
  if (layout.routingGraph) return graphDistance(layout, { x: ax, y: ay }, { x: bx, y: by });
  if (Math.abs(ax - bx) <= SAME_AISLE_EPS) return Math.abs(ay - by);
  let bestLen = Infinity;
  for (const c of layout.crossAislesY) {
    const len = Math.abs(ay - c) + Math.abs(by - c);
    if (len < bestLen) bestLen = len;
  }
  return Math.abs(ax - bx) + bestLen;
}

/**
 * Маршрут из `a` в `b` по проходам:
 * - в одном проходе (одинаковый X) — прямо по вертикали;
 * - иначе — вертикально до поперечного проезда, который минимизирует общую длину,
 *   горизонтально по нему и вертикально до цели.
 * Повторяющиеся подряд точки убираются; маршрут всегда начинается в `a` и кончается в `b`.
 */
export function route(layout: SimLayout, a: Waypoint, b: Waypoint): Waypoint[] {
  if (layout.routingGraph) return graphRoute(layout, a, b);
  const raw: Waypoint[] =
    Math.abs(a.x - b.x) <= SAME_AISLE_EPS
      ? [a, b]
      : (() => {
          const c = bestCrossAisle(layout.crossAislesY, a.y, b.y);
          return [a, { x: a.x, y: c }, { x: b.x, y: c }, b];
        })();
  const out: Waypoint[] = [{ x: raw[0]!.x, y: raw[0]!.y }];
  for (let i = 1; i < raw.length; i++) {
    const p = raw[i]!;
    const last = out[out.length - 1]!;
    if (p.x !== last.x || p.y !== last.y) out.push({ x: p.x, y: p.y });
  }
  return out;
}

type GraphCache = {
  adjacent: { node: number; length: number }[][];
  shortest: Map<number, { distances: number[]; previous: number[] }>;
  exactNodes: Map<string, number>;
  anchors: Map<string, { node: number; distance: number }[] | null>;
};
const graphCaches = new WeakMap<SimLayout, GraphCache>();

function graphCache(layout: SimLayout): GraphCache {
  const existing = graphCaches.get(layout);
  if (existing) return existing;
  const graph = layout.routingGraph!;
  const indices = new Map(graph.nodes.map((n, i) => [n.id, i]));
  const adjacent = graph.nodes.map(() => [] as { node: number; length: number }[]);
  for (const e of graph.edges) {
    const a = indices.get(e.from)!;
    const b = indices.get(e.to)!;
    const pa = graph.nodes[a]!;
    const pb = graph.nodes[b]!;
    const length = Math.abs(pa.x - pb.x) + Math.abs(pa.y - pb.y);
    adjacent[a]!.push({ node: b, length });
    adjacent[b]!.push({ node: a, length });
  }
  const exactNodes = new Map<string, number>();
  const cells = new Map<string, number[]>();
  // Cache the original first fuzzy match for every node, including near-coincident nodes.
  // One ambiguous pair must not turn a dense all-pairs calculation into repeated graph scans.
  for (const [i, node] of graph.nodes.entries()) {
    const x = Math.floor(node.x / SAME_AISLE_EPS), y = Math.floor(node.y / SAME_AISLE_EPS);
    let first = i;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const index of cells.get(`${x + dx},${y + dy}`) ?? []) {
        const prior = graph.nodes[index]!;
        if (index < first && Math.abs(prior.x - node.x) < SAME_AISLE_EPS && Math.abs(prior.y - node.y) < SAME_AISLE_EPS) first = index;
      }
    }
    const cell = `${x},${y}`;
    const bucket = cells.get(cell);
    if (bucket) bucket.push(i); else cells.set(cell, [i]);
    exactNodes.set(`${node.x},${node.y}`, first);
  }
  const cache: GraphCache = { adjacent, shortest: new Map(), exactNodes, anchors: new Map() };
  graphCaches.set(layout, cache);
  return cache;
}

function shortestFrom(layout: SimLayout, source: number) {
  const cache = graphCache(layout);
  const existing = cache.shortest.get(source);
  if (existing) {
    cache.shortest.delete(source); cache.shortest.set(source, existing);
    return existing;
  }
  const count = cache.adjacent.length;
  const distances = Array<number>(count).fill(Infinity);
  const previous = Array<number>(count).fill(-1);
  const visited = Array<boolean>(count).fill(false);
  distances[source] = 0;
  type Entry = { node: number; distance: number };
  const heap: Entry[] = [{ node: source, distance: 0 }];
  const before = (a: Entry, b: Entry) => a.distance < b.distance || (a.distance === b.distance && a.node < b.node);
  const push = (entry: Entry) => {
    let i = heap.length; heap.push(entry);
    while (i > 0) { const parent = (i - 1) >> 1; if (!before(entry, heap[parent]!)) break; heap[i] = heap[parent]!; i = parent; }
    heap[i] = entry;
  };
  const pop = (): Entry => {
    const first = heap[0]!, last = heap.pop()!;
    if (heap.length) {
      let i = 0;
      while (2 * i + 1 < heap.length) { let child = 2 * i + 1; if (child + 1 < heap.length && before(heap[child + 1]!, heap[child]!)) child++; if (!before(heap[child]!, last)) break; heap[i] = heap[child]!; i = child; }
      heap[i] = last;
    }
    return first;
  };
  while (heap.length) {
    const entry = pop(), current = entry.node;
    if (visited[current] || entry.distance !== distances[current]) continue;
    visited[current] = true;
    for (const edge of cache.adjacent[current]!) {
      const next = distances[current]! + edge.length;
      if (next < distances[edge.node]!) {
        distances[edge.node] = next;
        previous[edge.node] = current;
        push({ node: edge.node, distance: next });
      }
    }
  }
  const result = { distances, previous };
  cache.shortest.set(source, result);
  // Bound memory for dense plans; eviction changes work performed, never the selected route.
  if (cache.shortest.size > 128) cache.shortest.delete(cache.shortest.keys().next().value!);
  return result;
}

/** Endpoints must lie on this validated graph; no straight-line fallback through obstacles. */
function anchors(layout: SimLayout, p: Waypoint): { node: number; distance: number }[] {
  const graph = layout.routingGraph!;
  const coordinate = `${p.x},${p.y}`, cache = graphCache(layout), exactKey = cache.exactNodes.get(coordinate);
  if (exactKey !== undefined) return [{ node: exactKey, distance: 0 }];
  const cached = cache.anchors.get(coordinate);
  if (cached !== undefined) {
    cache.anchors.delete(coordinate); cache.anchors.set(coordinate, cached);
    if (cached === null) throw new Error("Route endpoint is outside the site routing graph");
    return cached;
  }
  const remember = (result: { node: number; distance: number }[] | null) => {
    cache.anchors.set(coordinate, result);
    if (cache.anchors.size > 256) cache.anchors.delete(cache.anchors.keys().next().value!);
  };
  const exact = graph.nodes.findIndex((n) => Math.abs(n.x - p.x) < SAME_AISLE_EPS && Math.abs(n.y - p.y) < SAME_AISLE_EPS);
  if (exact >= 0) { const result = [{ node: exact, distance: 0 }]; remember(result); return result; }
  for (let i = 0; i < graph.nodes.length; i++) {
    const a = graph.nodes[i]!;
    for (const e of cache.adjacent[i]!) {
      if (e.node < i) continue;
      const b = graph.nodes[e.node]!;
      const along = (Math.abs(a.x - b.x) < SAME_AISLE_EPS && Math.abs(p.x - a.x) < SAME_AISLE_EPS && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y)) || (Math.abs(a.y - b.y) < SAME_AISLE_EPS && Math.abs(p.y - a.y) < SAME_AISLE_EPS && p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x));
      if (along) {
        const result = [{ node: i, distance: Math.abs(p.x - a.x) + Math.abs(p.y - a.y) }, { node: e.node, distance: Math.abs(p.x - b.x) + Math.abs(p.y - b.y) }];
        remember(result); return result;
      }
    }
  }
  remember(null);
  throw new Error("Route endpoint is outside the site routing graph");
}

function graphDistance(layout: SimLayout, a: Waypoint, b: Waypoint): number {
  const starts = anchors(layout, a), ends = anchors(layout, b);
  if (starts.length === 2 && ends.length === 2 && starts.every(s => ends.some(e => e.node === s.node))) return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  let best = Infinity;
  for (const start of starts) {
    const shortest = shortestFrom(layout, start.node);
    for (const end of ends) best = Math.min(best, start.distance + shortest.distances[end.node]! + end.distance);
  }
  if (!Number.isFinite(best)) throw new Error("No connected route in site graph");
  return best;
}

/** Exact weighted expectation without rebuilding anchors and looking up shortest paths per pair. */
export function weightedMeanRouteLength(
  layout: SimLayout,
  from: readonly (Waypoint & { weight: number })[],
  to: readonly (Waypoint & { weight: number })[],
): number {
  const valid = (points: typeof from) => points.length > 0 && points.every(p => Number.isFinite(p.weight) && p.weight >= 0);
  const fromWeight = from.reduce((sum, p) => sum + p.weight, 0);
  const toWeight = to.reduce((sum, p) => sum + p.weight, 0);
  if (!valid(from) || !valid(to) || !Number.isFinite(fromWeight * toWeight) || fromWeight <= 0 || toWeight <= 0) {
    throw new Error("Route expectation requires finite nonnegative weights with a positive total");
  }
  let sum = 0;
  if (!layout.routingGraph) {
    for (const a of from) for (const b of to) sum += a.weight * b.weight * routeLengthBetween(layout, a.x, a.y, b.x, b.y);
  } else {
    const targets = to.filter(p => p.weight > 0).map(point => ({ point, anchors: anchors(layout, point) }));
    for (const a of from) {
      if (a.weight === 0) continue;
      const starts = anchors(layout, a);
      const paths = starts.map(start => ({ ...start, distances: shortestFrom(layout, start.node).distances }));
      for (const target of targets) {
        const b = target.point, ends = target.anchors;
        let best = Infinity;
        if (starts.length === 2 && ends.length === 2 && starts.every(s => ends.some(e => e.node === s.node))) {
          best = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
        } else {
          for (const start of paths) for (const end of ends) {
            best = Math.min(best, start.distance + start.distances[end.node]! + end.distance);
          }
        }
        if (!Number.isFinite(best)) throw new Error("No connected route in site graph");
        sum += a.weight * b.weight * best;
      }
    }
  }
  return sum / (fromWeight * toWeight);
}

function graphRoute(layout: SimLayout, a: Waypoint, b: Waypoint): Waypoint[] {
  const starts = anchors(layout, a);
  const ends = anchors(layout, b);
  if (starts.length === 2 && ends.length === 2 && starts.every((s) => ends.some((e) => e.node === s.node))) return [{ ...a }, { ...b }];
  let best = Infinity;
  let chosen: { source: number; target: number; previous: number[] } | null = null;
  for (const start of starts) {
    const shortest = shortestFrom(layout, start.node);
    for (const end of ends) {
      const distance = start.distance + shortest.distances[end.node]! + end.distance;
      if (distance < best) {
        best = distance;
        chosen = { source: start.node, target: end.node, previous: shortest.previous };
      }
    }
  }
  if (!chosen) throw new Error("No connected route in site graph");
  const indices = [chosen.target];
  while (indices[indices.length - 1] !== chosen.source) indices.push(chosen.previous[indices[indices.length - 1]!]!);
  const raw = [a, ...indices.reverse().map((i) => layout.routingGraph!.nodes[i]!), b];
  const path: Waypoint[] = [];
  for (const p of raw) if (!path.length || Math.abs(path[path.length - 1]!.x - p.x) > SAME_AISLE_EPS || Math.abs(path[path.length - 1]!.y - p.y) > SAME_AISLE_EPS) path.push({ x: p.x, y: p.y });
  return path;
}

/** Длина маршрута, м: сумма |Δx| + |Δy| по отрезкам (отрезки параллельны осям). */
export function routeLengthM(pts: readonly Waypoint[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.abs(pts[i]!.x - pts[i - 1]!.x) + Math.abs(pts[i]!.y - pts[i - 1]!.y);
  }
  return len;
}

/**
 * Точка маршрута на расстоянии `distM` от начала. Расстояние прижимается к [0; длина
 * маршрута]: до начала — первая точка, после конца — последняя. Пустой маршрут даёт (0, 0).
 */
export function positionAlong(pts: readonly Waypoint[], distM: number): Waypoint {
  const first = pts[0];
  if (!first) return { x: 0, y: 0 };
  if (!(distM > 0)) return { x: first.x, y: first.y };
  let left = distM;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const seg = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    if (left <= seg) {
      if (seg === 0) return { x: b.x, y: b.y };
      const f = left / seg;
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
    left -= seg;
  }
  const last = pts[pts.length - 1]!;
  return { x: last.x, y: last.y };
}
