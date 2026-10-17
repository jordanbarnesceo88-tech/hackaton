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
  if (layout.routingGraph) return routeLengthM(graphRoute(layout, { x: ax, y: ay }, { x: bx, y: by }));
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
  const cache = { adjacent, shortest: new Map() };
  graphCaches.set(layout, cache);
  return cache;
}

function shortestFrom(layout: SimLayout, source: number) {
  const cache = graphCache(layout);
  const existing = cache.shortest.get(source);
  if (existing) return existing;
  const count = cache.adjacent.length;
  const distances = Array<number>(count).fill(Infinity);
  const previous = Array<number>(count).fill(-1);
  const visited = Array<boolean>(count).fill(false);
  distances[source] = 0;
  for (let step = 0; step < count; step++) {
    let current = -1;
    for (let i = 0; i < count; i++) if (!visited[i] && (current < 0 || distances[i]! < distances[current]!)) current = i;
    if (current < 0 || !Number.isFinite(distances[current])) break;
    visited[current] = true;
    for (const edge of cache.adjacent[current]!) {
      const next = distances[current]! + edge.length;
      if (next < distances[edge.node]!) {
        distances[edge.node] = next;
        previous[edge.node] = current;
      }
    }
  }
  const result = { distances, previous };
  cache.shortest.set(source, result);
  return result;
}

/** Endpoints must lie on this validated graph; no straight-line fallback through obstacles. */
function anchors(layout: SimLayout, p: Waypoint): { node: number; distance: number }[] {
  const graph = layout.routingGraph!;
  const exact = graph.nodes.findIndex((n) => Math.abs(n.x - p.x) < SAME_AISLE_EPS && Math.abs(n.y - p.y) < SAME_AISLE_EPS);
  if (exact >= 0) return [{ node: exact, distance: 0 }];
  const cache = graphCache(layout);
  for (let i = 0; i < graph.nodes.length; i++) {
    const a = graph.nodes[i]!;
    for (const e of cache.adjacent[i]!) {
      if (e.node < i) continue;
      const b = graph.nodes[e.node]!;
      const along = (Math.abs(a.x - b.x) < SAME_AISLE_EPS && Math.abs(p.x - a.x) < SAME_AISLE_EPS && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y)) || (Math.abs(a.y - b.y) < SAME_AISLE_EPS && Math.abs(p.y - a.y) < SAME_AISLE_EPS && p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x));
      if (along) return [{ node: i, distance: Math.abs(p.x - a.x) + Math.abs(p.y - a.y) }, { node: e.node, distance: Math.abs(p.x - b.x) + Math.abs(p.y - b.y) }];
    }
  }
  throw new Error("Route endpoint is outside the site routing graph");
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
