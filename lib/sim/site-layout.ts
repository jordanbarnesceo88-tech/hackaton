import type { SimLayout, SimLayoutParams, SiteRect } from "./types";
import { LAYOUT_LIMITS } from "./layout";

type Point = { x: number; y: number };
const EPS = 1e-8;
export const WAREHOUSE_BODY_RADIUS_M = 0.75;
const finite = (n: number) => Number.isFinite(n);

export function pointInFootprint(p: Point, polygon: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j]!;
    const b = polygon[i]!;
    const cross = (p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x);
    if (Math.abs(cross) < EPS && p.x >= Math.min(a.x, b.x) - EPS && p.x <= Math.max(a.x, b.x) + EPS && p.y >= Math.min(a.y, b.y) - EPS && p.y <= Math.max(a.y, b.y) + EPS) return true;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function intersectsRect(a: Point, b: Point, r: SiteRect, clearance: number): boolean {
  const x0 = r.x - clearance;
  const x1 = r.x + r.w + clearance;
  const y0 = r.y - clearance;
  const y1 = r.y + r.h + clearance;
  return Math.max(a.x, b.x) >= x0 - EPS && Math.min(a.x, b.x) <= x1 + EPS && Math.max(a.y, b.y) >= y0 - EPS && Math.min(a.y, b.y) <= y1 + EPS;
}

/** Exact for the axis-aligned site/graph contract, including concave footprints. */
export function siteSegmentIsClear(layout: SimLayout, a: Point, b: Point): boolean {
  if (![a.x, a.y, b.x, b.y].every(finite) || (Math.abs(a.x - b.x) > EPS && Math.abs(a.y - b.y) > EPS)) return false;
  const footprint = layout.footprint;
  if (!footprint || !pointInFootprint(a, footprint) || !pointInFootprint(b, footprint)) return false;
  const clearance = layout.routingGraph?.clearanceM ?? 0;
  // A centre line inside the polygon can still put the body outside it, including at concave corners.
  for (let i = 0; i < footprint.length; i++) {
    const c = footprint[i]!, d = footprint[(i + 1) % footprint.length]!;
    const dx = Math.max(0, Math.min(a.x, b.x) - Math.max(c.x, d.x), Math.min(c.x, d.x) - Math.max(a.x, b.x));
    const dy = Math.max(0, Math.min(a.y, b.y) - Math.max(c.y, d.y), Math.min(c.y, d.y) - Math.max(a.y, b.y));
    if (dx * dx + dy * dy < Math.max(0, clearance - EPS) ** 2) return false;
  }
  const vertical = Math.abs(a.x - b.x) <= EPS;
  const start = vertical ? a.y : a.x;
  const end = vertical ? b.y : b.x;
  const cuts = [start, end, ...footprint.map((p) => vertical ? p.y : p.x).filter((v) => v > Math.min(start, end) && v < Math.max(start, end))].sort((x, y) => x - y);
  for (let i = 1; i < cuts.length; i++) {
    const mid = (cuts[i - 1]! + cuts[i]!) / 2;
    if (!pointInFootprint(vertical ? { x: a.x, y: mid } : { x: mid, y: a.y }, footprint)) return false;
  }
  return ![...(layout.walls ?? []), ...(layout.obstacles ?? []), ...(layout.columns ?? [])].some((r) => intersectsRect(a, b, r, clearance));
}

/** Validation is bounded and returns an invalid precheck rather than trusting scene-only geometry. */
export function validateSiteLayout(layout: SimLayout): string[] {
  try {
    if (![layout.zones, layout.crossAislesY, layout.rackAislesX, layout.receiving, layout.shipping, layout.chargers].every(a => Array.isArray(a) && a.length <= 500) || !Array.isArray(layout.slots) || layout.slots.length > 4096) return ["Missing or excessive site arrays"];
    if (![...layout.crossAislesY, ...layout.rackAislesX].every(finite) || (layout.wallHeightM !== undefined && !(finite(layout.wallHeightM) && layout.wallHeightM > 0))) return ["Invalid site dimensions"];
    for (const r of [...layout.zones, ...(layout.doors ?? []), ...(layout.compartments ?? []), ...(layout.staging ?? [])]) {
      if (![r.x, r.y, r.w, r.h].every(finite) || r.w <= 0 || r.h <= 0 || r.x < 0 || r.y < 0 || r.x + r.w > layout.widthM + EPS || r.y + r.h > layout.heightM + EPS) return ["Invalid site zone rectangle"];
    }
    const graph = layout.routingGraph;
    const footprint = layout.footprint;
    if (!graph || !footprint || footprint.length < 4 || footprint.length > 100 || graph.nodes.length < 2 || graph.nodes.length > 1000 || graph.edges.length > 4000) return ["Invalid site graph or footprint size"];
    if (![layout.widthM, layout.heightM].every((v) => finite(v) && v > 0) || !finite(graph.clearanceM) || graph.clearanceM < 0) return ["Invalid site dimensions/clearance"];
    for (let i = 0; i < footprint.length; i++) {
      const p = footprint[i]!;
      const next = footprint[(i + 1) % footprint.length]!;
      if (![p.x, p.y].every(finite) || p.x < 0 || p.y < 0 || p.x > layout.widthM || p.y > layout.heightM || (p.x !== next.x && p.y !== next.y) || p.x === next.x && p.y === next.y) return ["Footprint must be finite and orthogonal"];
      for (let j = i + 2; j < footprint.length; j++) {
        if (i === 0 && j === footprint.length - 1) continue;
        const a = footprint[j]!;
        const b = footprint[(j + 1) % footprint.length]!;
        if (Math.max(Math.min(p.x, next.x), Math.min(a.x, b.x)) <= Math.min(Math.max(p.x, next.x), Math.max(a.x, b.x)) && Math.max(Math.min(p.y, next.y), Math.min(a.y, b.y)) <= Math.min(Math.max(p.y, next.y), Math.max(a.y, b.y))) return ["Footprint intersects itself"];
      }
    }
    const solids = [...(layout.walls ?? []), ...(layout.obstacles ?? []), ...(layout.columns ?? [])];
    if (solids.length > 500) return ["Too many obstacles"];
    for (const r of solids) {
      if (![r.x, r.y, r.w, r.h].every(finite) || r.w <= 0 || r.h <= 0 || ![{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x, y: r.y + r.h }, { x: r.x + r.w, y: r.y + r.h }].every((p) => pointInFootprint(p, footprint))) return ["Invalid obstacle rectangle"];
    }
    const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
    if (nodes.size !== graph.nodes.length || new Set(graph.nodes.map((n) => `${n.x},${n.y}`)).size !== graph.nodes.length || graph.nodes.some((n) => typeof n.id !== "string" || !n.id || !siteSegmentIsClear(layout, n, n))) return ["Invalid or obstructed graph node"];
    const adjacent = new Map(graph.nodes.map((n) => [n.id, [] as string[]]));
    for (const e of graph.edges) {
      const a = nodes.get(e.from);
      const b = nodes.get(e.to);
      if (!a || !b || e.from === e.to || Math.abs(a.x - b.x) + Math.abs(a.y - b.y) < EPS || !siteSegmentIsClear(layout, a, b)) return ["Edge crosses a wall, rack, footprint or missing node"];
      adjacent.get(e.from)!.push(e.to);
      adjacent.get(e.to)!.push(e.from);
    }
    const seen = new Set<string>();
    const pending = [graph.nodes[0]!.id];
    while (pending.length) {
      const id = pending.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      pending.push(...adjacent.get(id)!);
    }
    if (seen.size !== nodes.size) return ["Site graph is disconnected"];
    const points = [...layout.receiving, ...layout.shipping, ...layout.chargers];
    if (!layout.receiving.length || !layout.shipping.length || !layout.slots.length || points.length > 500) return ["Site needs bounded docks and storage slots"];
    if (new Set(points.map((p) => p.id)).size !== points.length) return ["Duplicate operation point id"];
    if (points.some((p) => !graph.nodes.some((n) => Math.abs(n.x - p.x) < EPS && Math.abs(n.y - p.y) < EPS))) return ["Operation points must be graph nodes"];
    if (layout.slots.some(p => !siteSegmentIsClear(layout, p, p) || !graph.edges.some(e => {
      const a = nodes.get(e.from)!, b = nodes.get(e.to)!;
      return (Math.abs(a.x - b.x) < EPS && Math.abs(p.x - a.x) < EPS && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y)) ||
        (Math.abs(a.y - b.y) < EPS && Math.abs(p.y - a.y) < EPS && p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x));
    }))) return ["Storage slots must lie on the routing graph"];
    return [];
  } catch {
    return ["Malformed site layout"];
  }
}

/** The actual footprint area, including concave sections; not its bounding rectangle. */
export function siteAreaM2(layout: SimLayout): number {
  const p = layout.footprint;
  if (!p?.length) return NaN;
  return Math.abs(p.reduce((sum, a, i) => { const b = p[(i + 1) % p.length]!; return sum + a.x * b.y - b.x * a.y; }, 0)) / 2;
}

/** Explicit plans must agree with the financial object's area and physical operation points. */
export function validateProjectSiteLayout(layout: SimLayout, expected?: Pick<SimLayoutParams, "activeAreaM2" | "receivingDocksCount" | "shippingDocksCount" | "chargers">): string[] {
  const graph = layout?.routingGraph;
  if (!Array.isArray(layout?.slots) || layout.slots.length > 500 || !graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || graph.nodes.length > 500 || graph.edges.length > 2000) return ["Исходный план должен содержать не больше 500 мест/узлов и 2000 рёбер"];
  const problems = validateSiteLayout(layout);
  if (problems.length) return problems;
  if (layout.routingGraph!.clearanceM < WAREHOUSE_BODY_RADIUS_M) return [`Отступ маршрутов от стен и границ должен быть не меньше радиуса корпуса ${WAREHOUSE_BODY_RADIUS_M} м; исходный план не изменён`];
  const area = siteAreaM2(layout);
  if (!Number.isFinite(area) || area <= 0 || area > LAYOUT_LIMITS.maxActiveAreaM2) return ["Площадь явной планировки вне допустимых границ модели"];
  const points = [layout.receiving, layout.shipping, layout.chargers];
  if (points.some(list => list.length > LAYOUT_LIMITS.maxPointsPerKind) ||
    layout.receiving.some(p => p.kind !== "receiving") || layout.shipping.some(p => p.kind !== "shipping") || layout.chargers.some(p => p.kind !== "charger")) return ["Неверные типы или количество точек явной планировки"];
  if (expected && (!Number.isFinite(expected.activeAreaM2) || Math.abs(area - expected.activeAreaM2) > Math.max(1e-6, area * 1e-8))) return ["Площадь явной планировки не совпадает с активной площадью финансового сценария"];
  if (expected && (layout.receiving.length !== expected.receivingDocksCount || layout.shipping.length !== expected.shippingDocksCount || layout.chargers.length !== expected.chargers)) return ["Количество ворот или зарядок явной планировки не совпадает с финансовым сценарием"];
  return [];
}
