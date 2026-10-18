import type { SimLayout, SiteRect } from "./types";
import { siteSegmentIsClear } from "./site-layout";

type Point = { x: number; y: number };
type Segment = { a: Point; b: Point };
export type PodDock = Point & { entry: Point; heading: number };
export const POD_ROW_LAYOUT = {
  depthM: 1.4,
  widthM: 1,
  pitchM: 1.2,
  rearGapM: 0.2,
  workAisleM: 2.6,
  crossAisleM: 3.2,
  blockPods: 12,
  dockDistanceM: 2,
  clearanceM: 0.95,
  maxPods: 4096,
} as const;
const EPS = 1e-7;
const round = (v: number) => Math.round(v * 1e6) / 1e6;
const point = (x: number, y: number): Point => ({ x, y });
const key = (p: Point) => `${round(p.x)};${round(p.y)}`;
const length = (s: Segment) =>
  Math.abs(s.a.x - s.b.x) + Math.abs(s.a.y - s.b.y);
const inRange = (v: number, a: number, b: number) =>
  v >= Math.min(a, b) - EPS && v <= Math.max(a, b) + EPS;
const podRect = (p: Point): SiteRect => ({
  x: p.x - 0.7,
  y: p.y - 0.5,
  w: 1.4,
  h: 1,
});

/** Cut real solids out of aisle segments; do not retain a centre line through stock. */
function clip(segment: Segment, solids: SiteRect[], margin: number): Segment[] {
  const vertical = Math.abs(segment.a.x - segment.b.x) < EPS;
  const fixed = vertical ? segment.a.x : segment.a.y;
  const lo = Math.min(
    vertical ? segment.a.y : segment.a.x,
    vertical ? segment.b.y : segment.b.x,
  );
  const hi = Math.max(
    vertical ? segment.a.y : segment.a.x,
    vertical ? segment.b.y : segment.b.x,
  );
  const blocked: [number, number][] = [];
  for (const r of solids) {
    const fixedLo = (vertical ? r.x : r.y) - margin;
    const fixedHi = (vertical ? r.x + r.w : r.y + r.h) + margin;
    if (fixed < fixedLo - EPS || fixed > fixedHi + EPS) continue;
    const from = Math.max(lo, (vertical ? r.y : r.x) - margin);
    const to = Math.min(hi, (vertical ? r.y + r.h : r.x + r.w) + margin);
    if (to > from + EPS) blocked.push([from, to]);
  }
  blocked.sort((a, b) => a[0] - b[0]);
  const free: [number, number][] = [];
  let cursor = lo;
  for (const [from, to] of blocked) {
    if (from > cursor + EPS) free.push([cursor, from]);
    cursor = Math.max(cursor, to);
  }
  if (cursor < hi - EPS) free.push([cursor, hi]);
  return free
    .map(([from, to]) => {
      const start = from > lo + EPS ? from + EPS * 4 : from;
      const end = to < hi - EPS ? to - EPS * 4 : to;
      return {
        a: vertical ? point(fixed, start) : point(start, fixed),
        b: vertical ? point(fixed, end) : point(end, fixed),
      };
    })
    .filter((s) => length(s) > EPS);
}

function segmentsCross(a: Segment, b: Segment): Point | null {
  const av = Math.abs(a.a.x - a.b.x) < EPS,
    bv = Math.abs(b.a.x - b.b.x) < EPS;
  if (av === bv) return null;
  const v = av ? a : b,
    h = av ? b : a;
  return inRange(v.a.x, h.a.x, h.b.x) && inRange(h.a.y, v.a.y, v.b.y)
    ? point(v.a.x, h.a.y)
    : null;
}

/** Dense physical stock for owned/generated floors. Customer plan selection belongs to the caller. */
export function packPodRows(
  source: SimLayout,
  storageRects?: SiteRect[],
): { layout: SimLayout; docks: PodDock[] } {
  const layout = structuredClone(source);
  layout.footprint ??= [
    point(0, 0),
    point(layout.widthM, 0),
    point(layout.widthM, layout.heightM),
    point(0, layout.heightM),
  ];
  const rects =
    storageRects ??
    (layout.compartments?.filter((r) => r.kind === "storage").length
      ? layout.compartments.filter((r) => r.kind === "storage")
      : layout.zones.filter((r) => r.kind === "storage"));
  if (!rects.length)
    throw new Error("Для плотного размещения нужны объявленные зоны хранения");
  const clearance = POD_ROW_LAYOUT.clearanceM;
  layout.routingGraph = { nodes: [], edges: [], clearanceM: clearance };
  const docks: PodDock[] = [],
    spine: Segment[] = [];
  const solids = [
    ...(layout.walls ?? []),
    ...(layout.columns ?? []),
    ...(layout.obstacles ?? []),
  ];
  const clear = (a: Point, b: Point) => siteSegmentIsClear(layout, a, b);
  for (const r of rects) {
    if (![r.x, r.y, r.w, r.h].every(Number.isFinite) || r.w <= 0 || r.h <= 0)
      throw new Error("Неверные границы зоны хранения");
    const aisles: number[] = [];
    for (let x = r.x + 1.3; x + 5.6 <= r.x + r.w - clearance + EPS; x += 5.6) {
      aisles.push(round(x));
    }
    if (!aisles.length) continue;
    aisles.push(round(aisles[aisles.length - 1]! + 5.6));
    const crosses: number[] = [round(r.y + 1.6)];
    for (let start = r.y + 3.7; start + 2.1 <= r.y + r.h - clearance + EPS; ) {
      const count = Math.min(
        12,
        Math.floor((r.y + r.h - clearance - 2.1 - start + EPS) / 1.2) + 1,
      );
      if (count < 1) break;
      for (let row = 0; row < aisles.length - 1; row++) {
        for (let side = 0; side < 2; side++) {
          const homeX = aisles[row]! + (side === 0 ? 2 : 3.6);
          const entryX = side === 0 ? aisles[row]! : aisles[row + 1]!;
          for (let i = 0; i < count; i++) {
            const home = point(homeX, start + i * 1.2),
              entry = point(entryX, home.y);
            if (!clear(home, entry)) continue;
            const footprint = podRect(home);
            if (
              docks.some((d) => {
                const other = podRect(d);
                return (
                  footprint.x < other.x + other.w + 0.15 - EPS &&
                  footprint.x + footprint.w + 0.15 > other.x + EPS &&
                  footprint.y < other.y + other.h + 0.15 - EPS &&
                  footprint.y + footprint.h + 0.15 > other.y + EPS
                );
              })
            )
              continue;
            docks.push({ ...home, entry, heading: side === 0 ? 0 : Math.PI });
            if (docks.length > POD_ROW_LAYOUT.maxPods)
              throw new Error(
                `Плотный план превышает ${POD_ROW_LAYOUT.maxPods} реальных мест; уменьшите зону хранения`,
              );
          }
        }
      }
      const nextCross = round(start + (count - 1) * 1.2 + 2.1);
      crosses.push(nextCross);
      start = nextCross + 2.1;
    }
    const lastCross = crosses[crosses.length - 1]!;
    for (const x of aisles)
      spine.push({ a: point(x, crosses[0]!), b: point(x, lastCross) });
    for (const y of crosses)
      spine.push({
        a: point(aisles[0]!, y),
        b: point(aisles[aisles.length - 1]!, y),
      });
  }
  if (!docks.length)
    throw new Error(
      "Зоны хранения не вмещают доступный двойной ряд с рабочим проходом 2,6 м",
    );
  const stock = docks.map(podRect);
  const stockClear = (s: Segment) =>
    clear(s.a, s.b) &&
    Math.abs(
      clip(s, stock, clearance).reduce((sum, part) => sum + length(part), 0) -
        length(s),
    ) < EPS;
  const segments: Segment[] = [];
  const append = (s: Segment) => {
    if (length(s) < EPS) return;
    for (const part of clip(s, [...solids, ...stock], clearance))
      if (clear(part.a, part.b)) segments.push(part);
  };
  for (const s of spine) append(s);
  const originalNodes = new Map(
    source.routingGraph?.nodes.map((n) => [n.id, n]) ?? [],
  );
  for (const edge of source.routingGraph?.edges ?? []) {
    const a = originalNodes.get(edge.from),
      b = originalNodes.get(edge.to);
    if (a && b) append({ a, b });
  }
  const operations = [
    ...layout.receiving,
    ...layout.shipping,
    ...layout.chargers,
  ];
  // Generated floors have no source graph. Operation points connect to a genuine aisle, never a stock shortcut.
  for (const operation of operations) {
    const candidates = spine
      .flatMap((s) => [
        s.a,
        s.b,
        point(
          s.a.x,
          Math.max(
            Math.min(operation.y, Math.max(s.a.y, s.b.y)),
            Math.min(s.a.y, s.b.y),
          ),
        ),
      ])
      .sort(
        (a, b) =>
          Math.abs(a.x - operation.x) +
          Math.abs(a.y - operation.y) -
          Math.abs(b.x - operation.x) -
          Math.abs(b.y - operation.y),
      );
    for (const target of candidates) {
      let connected = false;
      for (const elbow of [
        point(target.x, operation.y),
        point(operation.x, target.y),
      ]) {
        const path = [
          { a: operation, b: elbow },
          { a: elbow, b: target },
        ].filter((s) => length(s) > EPS);
        if (!path.every(stockClear)) continue;
        segments.push(...path);
        connected = true;
        break;
      }
      if (connected) break;
    }
  }
  const graph = layout.routingGraph;
  const nodes = new Map<string, (typeof graph.nodes)[number]>();
  const entryIds = new Map<string, string>();
  for (const dock of docks)
    if (!entryIds.has(key(dock.entry)))
      entryIds.set(key(dock.entry), `pod-entry-${entryIds.size + 1}`);
  const add = (p: Point, id?: string) => {
    const k = key(p),
      existing = nodes.get(k);
    if (existing) return existing.id;
    const node = {
      ...point(p.x, p.y),
      id: id ?? entryIds.get(k) ?? `pod-aisle-${nodes.size + 1}`,
    };
    nodes.set(k, node);
    graph.nodes.push(node);
    return node.id;
  };
  const edges = new Set<string>();
  const connect = (a: Point, b: Point) => {
    if (key(a) === key(b)) return;
    const from = add(a),
      to = add(b),
      id = [from, to].sort().join(";");
    if (!edges.has(id)) {
      edges.add(id);
      graph.edges.push({ from, to });
    }
  };
  // Split intersections and collinear endpoints so crossing aisles are connected in the actual routing graph.
  const cuts = segments.map((s) => [s.a, s.b]);
  for (let i = 0; i < segments.length; i++) {
    const a = segments[i]!;
    for (let j = i + 1; j < segments.length; j++) {
      const b = segments[j]!,
        cross = segmentsCross(a, b);
      if (cross) {
        cuts[i]!.push(cross);
        cuts[j]!.push(cross);
        continue;
      }
      for (const [target, other, index] of [
        [a, b, i],
        [b, a, j],
      ] as const) {
        for (const p of [other.a, other.b])
          if (
            Math.abs(target.a.x - target.b.x) < EPS
              ? Math.abs(p.x - target.a.x) < EPS &&
                inRange(p.y, target.a.y, target.b.y)
              : Math.abs(p.y - target.a.y) < EPS &&
                inRange(p.x, target.a.x, target.b.x)
          )
            cuts[index]!.push(p);
      }
    }
  }
  for (let i = 0; i < segments.length; i++) {
    for (const dock of docks) {
      const p = dock.entry,
        s = segments[i]!;
      if (
        Math.abs(s.a.x - s.b.x) < EPS
          ? Math.abs(p.x - s.a.x) < EPS && inRange(p.y, s.a.y, s.b.y)
          : Math.abs(p.y - s.a.y) < EPS && inRange(p.x, s.a.x, s.b.x)
      )
        cuts[i]!.push(p);
    }
    const ordered = [
      ...new Map(cuts[i]!.map((p) => [key(p), p])).values(),
    ].sort((a, b) => a.x - b.x || a.y - b.y);
    for (let j = 1; j < ordered.length; j++)
      connect(ordered[j - 1]!, ordered[j]!);
  }
  // No intersections inside the docking spur: a robot can turn only after fully clearing the row.
  for (const [i, dock] of docks.entries()) {
    add(dock, `pod-home-${i + 1}`);
    connect(dock, dock.entry);
  }
  for (const op of operations) add(op);
  const adjacent = new Map(graph.nodes.map((n) => [n.id, [] as string[]]));
  for (const e of graph.edges) {
    adjacent.get(e.from)!.push(e.to);
    adjacent.get(e.to)!.push(e.from);
  }
  const seen = new Set<string>(),
    pending = [nodes.get(key(operations[0]!))!.id];
  while (pending.length) {
    const id = pending.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    pending.push(...adjacent.get(id)!);
  }
  const inaccessible = docks.filter((d) => !seen.has(nodes.get(key(d))!.id));
  if (
    operations.some((op) => !seen.has(nodes.get(key(op))!.id)) ||
    inaccessible.length
  )
    throw new Error(
      `Плотные ряды не связаны с воротами: недоступно ${inaccessible.length} мест. Добавьте свободный сквозной проезд в каждой зоне хранения`,
    );
  graph.nodes = graph.nodes.filter((n) => seen.has(n.id));
  graph.edges = graph.edges.filter((e) => seen.has(e.from) && seen.has(e.to));
  if (graph.nodes.length > 8192 || graph.edges.length > 20000)
    throw new Error(
      "Плотный граф превышает 8192 узла или 20000 рёбер; уменьшите объект",
    );
  layout.slots = docks.map(({ x, y }) => ({ x, y }));
  return { layout, docks };
}
