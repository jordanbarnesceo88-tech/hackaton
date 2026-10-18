import type { SimLayout, SimLayoutParams } from "./types";
import { siteSegmentIsClear } from "./site-layout";
import { buildWarehouseLayout } from "./layout";
import { packPodRows } from "./pod-layout";
export type Dock = {
  x: number;
  y: number;
  entry: { x: number; y: number };
  heading: number;
};
export type UnderliftConfig = { version: "underlift-1"; docks: Dock[] };
type Point = { x: number; y: number };
export type Bounds = { x0: number; x1: number; y0: number; y1: number };
const EPS = 1e-8;
const same = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-7;
const pointKey = (p: Point) => `${p.x};${p.y}`;
/** All docking and routing directions are cardinal; their oriented boxes are exact AABBs. */
export function orientedBounds(
  point: Point,
  lengthM: number,
  widthM: number,
  heading: number,
): Bounds {
  const c = Math.abs(Math.cos(heading)),
    s = Math.abs(Math.sin(heading));
  if (Math.min(c, s) > EPS)
    throw new Error(
      "Подстеллажный маршрут должен сохранять ортогональную ориентацию",
    );
  const x = (lengthM * c + widthM * s) / 2,
    y = (lengthM * s + widthM * c) / 2;
  return { x0: point.x - x, x1: point.x + x, y0: point.y - y, y1: point.y + y };
}

export function rectangleGap(a: Bounds, b: Bounds): number {
  const dx = Math.max(a.x0 - b.x1, b.x0 - a.x1),
    dy = Math.max(a.y0 - b.y1, b.y0 - a.y1);
  return dx > 0 || dy > 0
    ? Math.hypot(Math.max(0, dx), Math.max(0, dy))
    : -Math.min(-dx, -dy);
}
export function pointBoxDistance(p: Point, b: Bounds) {
  return Math.hypot(
    Math.max(0, b.x0 - p.x, p.x - b.x1),
    Math.max(0, b.y0 - p.y, p.y - b.y1),
  );
}
/** Source graph pod-home nodes have exactly one straight, two-metre extraction spur. */
export function prepareUnderliftLayout(layout: SimLayout): UnderliftConfig {
  const graph = layout.routingGraph!;
  graph.clearanceM = Math.max(0.95, graph.clearanceM);
  const nodes = new Map(graph.nodes.map((n) => [n.id, n])),
    homes = layout.slots,
    points = [...homes, ...layout.receiving, ...layout.shipping],
    unique = points.filter((p, i) => points.findIndex((q) => same(p, q)) === i);
  const docks: Dock[] = [],
    named = new Map<string, Dock>(),
    homeKeys = new Set(homes.map(pointKey)),
    linksByNode = new Map<string, string[]>();
  for (const edge of graph.edges) {
    linksByNode.set(edge.from, [
      ...(linksByNode.get(edge.from) ?? []),
      edge.to,
    ]);
    linksByNode.set(edge.to, [...(linksByNode.get(edge.to) ?? []), edge.from]);
  }
  for (const node of graph.nodes.filter((n) => homeKeys.has(pointKey(n)))) {
    const links = linksByNode.get(node.id) ?? [],
      entry = links.length === 1 ? nodes.get(links[0]!) : undefined;
    if (
      entry &&
      Math.abs(Math.hypot(entry.x - node.x, entry.y - node.y) - 2) < 1e-8 &&
      (Math.abs(entry.x - node.x) < 1e-8 || Math.abs(entry.y - node.y) < 1e-8)
    )
      named.set(pointKey(node), {
        x: node.x,
        y: node.y,
        entry: { x: entry.x, y: entry.y },
        heading: Math.atan2(node.y - entry.y, node.x - entry.x),
      });
    else if (node.id.startsWith("pod-home-"))
      throw new Error(
        "Домашнее место должно иметь единственный прямой заезд из рабочего прохода",
      );
  }
  const stock = homes.map((p) => ({
    point: p,
    bounds: orientedBounds(p, 1.4, 1, named.get(pointKey(p))?.heading ?? 0),
  }));
  const sweptClear = (
    p: { x: number; y: number },
    entry: { x: number; y: number },
    heading: number,
  ) => {
    const box = orientedBounds(p, 1.4, 1, heading),
      dx = entry.x - p.x,
      dy = entry.y - p.y;
    const swept = {
      x0: Math.min(box.x0, box.x0 + dx),
      x1: Math.max(box.x1, box.x1 + dx),
      y0: Math.min(box.y0, box.y0 + dy),
      y1: Math.max(box.y1, box.y1 + dy),
    };
    return stock.every(
      (q) => same(q.point, p) || rectangleGap(swept, q.bounds) >= 0.15 - 1e-8,
    );
  };
  const add = (p: { x: number; y: number }) => {
    const found = graph.nodes.find((n) => same(n, p));
    if (found) return found.id;
    const id = `pod-dock-${graph.nodes.length}`;
    graph.nodes.push({ ...p, id });
    return id;
  };
  const baseNodes = [...graph.nodes].filter((n) => !homeKeys.has(pointKey(n)));
  for (const point of unique) {
    let chosen = named.get(pointKey(point));
    if (chosen) {
      docks.push(chosen);
      continue;
    }
    for (const [dx, dy] of [
      [0, -2],
      [0, 2],
      [-2, 0],
      [2, 0],
    ]) {
      const entry = { x: point.x + dx!, y: point.y + dy! },
        heading = Math.atan2(point.y - entry.y, point.x - entry.x);
      if (
        !siteSegmentIsClear(layout, point, entry) ||
        !sweptClear(point, entry, heading)
      )
        continue;
      const candidates = [...baseNodes]
        .filter((n) => !same(n, point))
        .sort(
          (a, b) =>
            Math.abs(a.x - entry.x) +
            Math.abs(a.y - entry.y) -
            Math.abs(b.x - entry.x) -
            Math.abs(b.y - entry.y),
        );
      let connection:
        | { node: (typeof baseNodes)[number]; elbow: { x: number; y: number } }
        | undefined;
      for (const node of candidates) {
        for (const elbow of [
          { x: entry.x, y: node.y },
          { x: node.x, y: entry.y },
        ]) {
          if (
            !siteSegmentIsClear(layout, entry, elbow) ||
            !siteSegmentIsClear(layout, elbow, node)
          )
            continue;
          const clear = (
            a: { x: number; y: number },
            b: { x: number; y: number },
          ) =>
            stock.every((q) => {
              const box = {
                x0: Math.min(a.x, b.x) - 1.05,
                x1: Math.max(a.x, b.x) + 1.05,
                y0: Math.min(a.y, b.y) - 1.05,
                y1: Math.max(a.y, b.y) + 1.05,
              };
              return rectangleGap(box, q.bounds) >= -1e-8;
            });
          if (!clear(entry, elbow) || !clear(elbow, node)) continue;
          connection = { node, elbow };
          break;
        }
        if (connection) break;
      }
      if (!connection) continue;
      const center = add(point),
        start = add(entry),
        elbow = add(connection.elbow);
      for (const [from, to] of [
        [center, start],
        [start, elbow],
        [elbow, connection.node.id],
      ])
        if (from !== to) graph.edges.push({ from: from!, to: to! });
      chosen = { x: point.x, y: point.y, entry, heading };
      break;
    }
    if (!chosen)
      throw new Error(
        `План не поддерживает подстеллажный заезд и выезд в точке ${point.x.toFixed(2)}, ${point.y.toFixed(2)}; нужны свободный прямой участок 2 м и габарит 0,95 м`,
      );
    docks.push(chosen);
  }
  const config = { version: "underlift-1" as const, docks };
  validateUnderliftConfig(layout, config);
  return config;
}
export function validateUnderliftConfig(
  layout: SimLayout,
  config: UnderliftConfig,
): void {
  const points = [...layout.slots, ...layout.receiving, ...layout.shipping],
    unique = points.filter((p, i) => points.findIndex((q) => same(p, q)) === i),
    graph = layout.routingGraph;
  if (
    config.version !== "underlift-1" ||
    !Array.isArray(config.docks) ||
    config.docks.length !== unique.length ||
    !graph ||
    graph.clearanceM < 0.95
  )
    throw new Error(
      "Повреждён подстеллажный план: неполная карта заездов или недостаточный габарит",
    );
  const stock = layout.slots.map((p) => {
    const d = config.docks.find((d) => same(d, p));
    if (!d) throw new Error("Нет заезда домашнего места");
    return { point: p, bounds: orientedBounds(p, 1.4, 1, d.heading) };
  });
  for (const p of unique) {
    const matches = config.docks.filter((d) => same(d, p)),
      d = matches[0];
    if (
      matches.length !== 1 ||
      !d ||
      ![d.entry.x, d.entry.y, d.heading].every(Number.isFinite) ||
      Math.abs(Math.hypot(d.x - d.entry.x, d.y - d.entry.y) - 2) > 1e-8 ||
      (Math.abs(d.x - d.entry.x) > 1e-8 && Math.abs(d.y - d.entry.y) > 1e-8) ||
      Math.abs(d.heading - Math.atan2(d.y - d.entry.y, d.x - d.entry.x)) >
        1e-8 ||
      !siteSegmentIsClear(layout, d, d.entry) ||
      !graph.nodes.some((n) => same(n, d.entry))
    )
      throw new Error("Повреждён подстеллажный план: неверный прямой заезд");
    const box = orientedBounds(d, 1.4, 1, d.heading),
      dx = d.entry.x - d.x,
      dy = d.entry.y - d.y,
      sweep = {
        x0: Math.min(box.x0, box.x0 + dx),
        x1: Math.max(box.x1, box.x1 + dx),
        y0: Math.min(box.y0, box.y0 + dy),
        y1: Math.max(box.y1, box.y1 + dy),
      };
    if (
      stock.some(
        (q) =>
          !same(q.point, p) &&
          (rectangleGap(sweep, q.bounds) < 0.15 - 1e-8 ||
            pointBoxDistance(d.entry, q.bounds) - Math.hypot(1.4, 1) / 2 <
              0.15 - 1e-8),
      )
    )
      throw new Error(
        "Подстеллажный заезд пересекает соседний стеллаж или не оставляет места для поворота в проходе",
      );
  }
}
/** Pure source recipe. Customer walls/points are cloned, never repacked. */
export function buildClosedPodLayout(
  params: SimLayoutParams,
  source?: SimLayout,
): { layout: SimLayout; config: UnderliftConfig } {
  let layout = structuredClone(source ?? buildWarehouseLayout(params));
  if (!source) {
    layout.obstacles = [];
    layout = packPodRows(layout).layout;
  }
  if (!layout.routingGraph)
    throw new Error(
      "Для подстеллажного процесса нужен проверенный граф маршрутов",
    );
  const config = prepareUnderliftLayout(layout);
  return { layout, config };
}

export function prepareClosedPodSource(source: SimLayout): {
  layout: SimLayout;
  config: UnderliftConfig;
} {
  const layout = structuredClone(source);
  if (!layout.routingGraph)
    throw new Error(
      "Для подстеллажного процесса нужен проверенный граф маршрутов",
    );
  return { layout, config: prepareUnderliftLayout(layout) };
}
