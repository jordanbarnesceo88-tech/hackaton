import { LAYOUT_ASSUMPTIONS } from "@/lib/sim/layout";
import type { OpPoint, RobotPhase, SimLayout } from "@/lib/sim/types";

/**
 * Модель схемы склада, общая для экрана имитации, PNG-выгрузки и печатного отчёта: что рисовать
 * (сколько роботов, каким значком, где стоит очередь, где стеллажи) — без того, как рисовать.
 * Рисует изометрия (iso-scene.ts); здесь только чистые функции, проверяемые unit-тестами в Node.
 */

/** Шрифт подписей схемы. Системный набор с кириллицей: SVG, собранный в PNG, веб-шрифтов страницы не видит. */
export const SCENE_FONT_FAMILY = "system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";

/**
 * Сколько роботов рисовать. Больше 60 значков на схеме шириной в колонку сливаются в пятно;
 * тогда рисуются первые 60 по номеру, а в поле схемы пишется «показано 60 из M».
 */
export const MAX_DRAWN_ROBOTS = 60;

/** Сколько роботов из `count` будет нарисовано. */
export function robotsToDraw(count: number): number {
  if (!Number.isFinite(count) || count <= 0) return 0;
  return Math.min(Math.floor(count), MAX_DRAWN_ROBOTS);
}

/** Состояние робота на схеме: везёт паллету, едет пустым, заряжается. */
export type RobotGlyph = "loaded" | "empty" | "charging";

/**
 * Состояние робота по фазе. Зарядкой считается и путь к станции, и ожидание её, и сам заряд — как
 * в показателе «Зарядка» сводки. В остальных фазах решает наличие груза: робот, ожидающий у
 * ворот с паллетой, рисуется с паллетой.
 */
export function robotGlyph(phase: RobotPhase, loaded: boolean): RobotGlyph {
  if (phase === "toCharger" || phase === "waitCharger" || phase === "charging") return "charging";
  return loaded ? "loaded" : "empty";
}

/**
 * Ширина главного и стеллажного проходов, восстановленная по планировке: оси поперечных проездов
 * стоят на main/2 от стены, а шаг стеллажных проходов равен ширине прохода плюс двойной ряд
 * стеллажей (`LAYOUT_ASSUMPTIONS.rackRowDepthM`). Так схему можно нарисовать без входа прогона.
 * При одном стеллажном проходе его ширина неизвестна — берётся ширина главного проезда.
 */
export function aisleWidths(layout: SimLayout): { mainM: number; rackM: number } {
  const first = layout.crossAislesY[0];
  const mainM = first !== undefined && first > 0 ? 2 * first : 0;
  const x0 = layout.rackAislesX[0];
  const x1 = layout.rackAislesX[1];
  const rackM =
    x0 !== undefined && x1 !== undefined && x1 - x0 > LAYOUT_ASSUMPTIONS.rackRowDepthM
      ? x1 - x0 - LAYOUT_ASSUMPTIONS.rackRowDepthM
      : mainM;
  return { mainM, rackM };
}

/** Прямоугольник в координатах «сверху вниз»: x — вдоль планировки, y — от верхней стены (м). */
export type Rect = { x: number; y: number; w: number; h: number };

/**
 * Стеллажи зоны хранения: двойные ряды между соседними стеллажными проходами и одинарные с
 * внешней стороны крайних (проход обслуживает стеллажи с обеих сторон), разрезанные поперечными
 * проездами. Ось Y перевёрнута (y — от верхней стены), как у изометрии и печатной схемы.
 */
export function rackRects(layout: SimLayout): Rect[] {
  const zone = layout.zones.find((z) => z.kind === "storage");
  if (!zone) return [];
  const { mainM, rackM } = aisleWidths(layout);
  const halfRow = LAYOUT_ASSUMPTIONS.rackRowDepthM / 2;
  const xs = layout.rackAislesX;
  const rows: [number, number][] = [];
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i] as number;
    const left = x - rackM / 2;
    const right = x + rackM / 2;
    if (i === 0) rows.push([left - halfRow, left]);
    const next = xs[i + 1];
    if (next !== undefined) rows.push([right, next - rackM / 2]);
    else rows.push([right, right + halfRow]);
  }
  const bands: [number, number][] = [];
  const cuts = [...layout.crossAislesY].sort((a, b) => a - b);
  let y0 = zone.y;
  for (const c of cuts) {
    const lo = c - mainM / 2;
    if (lo > y0) bands.push([y0, lo]);
    y0 = Math.max(y0, c + mainM / 2);
  }
  if (zone.y + zone.h > y0) bands.push([y0, zone.y + zone.h]);

  const out: Rect[] = [];
  for (const [xa, xb] of rows) {
    const x0 = Math.max(zone.x, xa);
    const x1 = Math.min(zone.x + zone.w, xb);
    if (x1 <= x0) continue;
    for (const [ya, yb] of bands) {
      if (yb <= ya) continue;
      out.push({ x: x0, y: layout.heightM - yb, w: x1 - x0, h: yb - ya });
    }
  }
  return out;
}

/**
 * Смещение робота, стоящего в очереди к точке, в шагах очереди вдоль планировки: очередь
 * вытягивается от ворот внутрь склада (от приёмки — вправо, от отгрузки — влево), от зарядки —
 * вправо. Так очередь у ворот видна на схеме, а не складывается в один значок. `index` — место в
 * очереди среди стоящих у точки (0 — первый за работающим).
 */
export function queueOffset(kind: OpPoint["kind"], index: number): { dx: number; dy: number } {
  const step = 1.3 * (index + 1);
  return kind === "shipping" ? { dx: -step, dy: 0 } : { dx: step, dy: 0 };
}

/** Часы модели «чч:мм» от начала прогона (прогрев + пик). */
export function formatSimClock(tS: number): string {
  const t = Number.isFinite(tS) && tS > 0 ? Math.floor(tS) : 0;
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Фаза прогона для подписи часов. */
export function simPhaseLabel(tS: number, warmupS: number, endS: number): string {
  if (tS >= endS) return "окончен";
  return tS < warmupS ? "прогрев" : "пик";
}
