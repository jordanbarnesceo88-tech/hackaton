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
