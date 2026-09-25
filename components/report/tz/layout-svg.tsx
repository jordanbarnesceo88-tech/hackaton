import { CHARGER_COLOR, DOCK_COLOR, ROUTE_COLOR, ZONE_COLORS, ZONE_PALETTE, aisleWidths } from "@/components/sim/draw-scene";
import { LAYOUT_ASSUMPTIONS, LAYOUT_LIMITS, buildWarehouseLayout } from "@/lib/sim/layout";
import type { SimLayout, SimLayoutParams } from "@/lib/sim/types";
import type { ParamValues } from "@/lib/tz/types";

/**
 * Схема склада для печатного отчёта (ТЗ §3.6.1 — типовые зоны, маршруты, точки операций и
 * зарядка; §3.7.2 — отчёт). Рисуется на сервере в SVG из той же планировки
 * `buildWarehouseLayout`, что использует имитация и по которой экономика считает плечо
 * перевозки, поэтому схема в отчёте не расходится с расчётом (§3.6.2). Векторная картинка
 * печатается чётко, не требует canvas и не упирается в CSP.
 *
 * Цвета зон, ворот, зарядок и маршрутов — те же, что у схемы имитации на экране
 * (components/sim/draw-scene), но фон светлый: отчёт печатается на бумаге. Роботов на схеме
 * нет — это планировка, а не кадр прогона; прогон с роботами показывает экран имитации.
 */

/** Ключи параметров объекта, из которых строится планировка (как у модели проекта). */
export const LAYOUT_PARAM_KEYS = {
  activeAreaM2: "activeAreaM2",
  mainAisleWidthM: "mainAisleWidthM",
  rackAisleWidthM: "rackAisleWidthM",
  receivingDocksCount: "receivingDocksCount",
  shippingDocksCount: "shippingDocksCount",
} as const;

/** Число из значения параметра: число или строка с десятичной запятой; иначе null. */
function num(v: number | string | null | undefined): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const t = v.trim().replace(/\s/g, "").replace(",", ".");
    if (t === "") return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Параметры планировки из параметров объекта и числа зарядных станций сценария. Те же правила,
 * что у модели проекта (lib/tz/model): площадь больше 0 и не больше предела модели, проходы
 * шире 0 м, ворот от 1 до предела. Если правило нарушено, схемы нет (null) — достраивать
 * планировку запасными значениями нельзя: она разошлась бы с расчётом.
 */
export function layoutParamsFrom(params: ParamValues, chargers: number): SimLayoutParams | null {
  const K = LAYOUT_PARAM_KEYS;
  const area = num(params[K.activeAreaM2]);
  if (area === null || !(area > 0) || area > LAYOUT_LIMITS.maxActiveAreaM2) return null;
  const main = num(params[K.mainAisleWidthM]);
  const rack = num(params[K.rackAisleWidthM]);
  if (main === null || !(main > 0) || rack === null || !(rack > 0)) return null;
  const docks: number[] = [];
  for (const key of [K.receivingDocksCount, K.shippingDocksCount]) {
    const v = num(params[key]);
    const n = v === null ? null : Math.round(v);
    if (n === null || n < 1 || n > LAYOUT_LIMITS.maxPointsPerKind) return null;
    docks.push(n);
  }
  const c = Number.isFinite(chargers) ? Math.max(0, Math.min(LAYOUT_LIMITS.maxPointsPerKind, Math.round(chargers))) : 0;
  return {
    activeAreaM2: area,
    mainAisleWidthM: main,
    rackAisleWidthM: rack,
    receivingDocksCount: docks[0] ?? 1,
    shippingDocksCount: docks[1] ?? 1,
    chargers: c,
  };
}

/** Прямоугольник в координатах SVG (ось Y вниз) по прямоугольнику планировки (ось Y вверх). */
type Rect = { x: number; y: number; w: number; h: number };

/** Полосы стеллажей зоны хранения — как на экране имитации (draw-scene, drawStorage). */
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

/** Число без хвоста двоичной арифметики — для атрибутов SVG. */
function r2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Пункт легенды: цвет, форма и подпись. */
export const LAYOUT_LEGEND: readonly { key: string; label: string; color: string; shape: "zone" | "point" | "route" }[] = [
  { key: "receiving", label: "Приёмка", color: ZONE_COLORS.receiving, shape: "zone" },
  { key: "storage", label: "Хранение (стеллажи)", color: ZONE_COLORS.storage, shape: "zone" },
  { key: "shipping", label: "Отгрузка", color: ZONE_COLORS.shipping, shape: "zone" },
  { key: "charging", label: "Зона зарядки", color: ZONE_COLORS.charging, shape: "zone" },
  { key: "dock", label: "Ворота (точка операции)", color: DOCK_COLOR, shape: "point" },
  { key: "charger", label: "Зарядная станция", color: CHARGER_COLOR, shape: "point" },
  { key: "route", label: "Маршруты по осям проездов", color: ROUTE_COLOR, shape: "route" },
];

/**
 * SVG-схема планировки. `viewBox` — в метрах планировки плюс поле; размеры значков и линий
 * считаются от размера схемы, поэтому малый и большой склад читаются одинаково.
 */
export function WarehouseLayoutSvg({ layout, label }: { layout: SimLayout; label: string }) {
  const W = layout.widthM;
  const H = layout.heightM;
  const span = Math.max(W, H);
  const pad = span * 0.02;
  const line = span / 500;
  const flip = (y: number) => H - y;
  const strip = layout.zones.find((z) => z.kind === "receiving")?.w ?? W / 10;
  const dockSize = Math.max(span / 120, Math.min(strip * 0.45, span / 45));
  const cross = layout.crossAislesY;
  const yLo = cross.length > 0 ? Math.min(...cross) : 0;
  const yHi = cross.length > 0 ? Math.max(...cross) : H;
  const xLeft = layout.receiving[0]?.x ?? 0;
  const xRight = layout.shipping[0]?.x ?? W;
  const routes: string[] = [];
  for (const y of cross) routes.push(`M${r2(xLeft)} ${r2(flip(y))}H${r2(xRight)}`);
  for (const x of [xLeft, ...layout.rackAislesX, xRight]) routes.push(`M${r2(x)} ${r2(flip(yHi))}V${r2(flip(yLo))}`);

  return (
    <svg
      viewBox={`${r2(-pad)} ${r2(-pad)} ${r2(W + 2 * pad)} ${r2(H + 2 * pad)}`}
      role="img"
      aria-label={label}
      className="h-auto w-full"
      preserveAspectRatio="xMidYMid meet"
    >
      <rect x={0} y={0} width={r2(W)} height={r2(H)} fill="#ffffff" stroke="#475569" strokeWidth={r2(line * 1.5)} />
      {layout.zones.map((z) => (
        <rect
          key={z.kind}
          x={r2(z.x)}
          y={r2(flip(z.y + z.h))}
          width={r2(z.w)}
          height={r2(z.h)}
          fill={ZONE_COLORS[z.kind]}
          fillOpacity={z.kind === "storage" ? 0.12 : 0.35}
          stroke={ZONE_COLORS[z.kind]}
          strokeWidth={r2(line)}
        />
      ))}
      <g fill={ZONE_PALETTE.rack} fillOpacity={0.6}>
        {rackRects(layout).map((r, i) => (
          <rect key={i} x={r2(r.x)} y={r2(r.y)} width={r2(r.w)} height={r2(r.h)} />
        ))}
      </g>
      <path d={routes.join("")} fill="none" stroke={ROUTE_COLOR} strokeWidth={r2(line)} strokeDasharray={`${r2(line * 4)} ${r2(line * 3)}`} />
      {[...layout.receiving, ...layout.shipping].map((p) => (
        <rect
          key={p.id}
          x={r2(p.x - dockSize / 2)}
          y={r2(flip(p.y) - dockSize / 2)}
          width={r2(dockSize)}
          height={r2(dockSize)}
          fill="#ffffff"
          stroke={DOCK_COLOR}
          strokeWidth={r2(line * 1.5)}
        >
          <title>{p.kind === "receiving" ? `Ворота приёмки ${p.id}` : `Ворота отгрузки ${p.id}`}</title>
        </rect>
      ))}
      {layout.chargers.map((p) => (
        <rect
          key={p.id}
          x={r2(p.x - dockSize / 2)}
          y={r2(flip(p.y) - dockSize / 2)}
          width={r2(dockSize)}
          height={r2(dockSize)}
          fill={CHARGER_COLOR}
          stroke="#92400e"
          strokeWidth={r2(line)}
        >
          <title>{`Зарядная станция ${p.id}`}</title>
        </rect>
      ))}
    </svg>
  );
}

/** Легенда схемы — HTML под картинкой: подписи остаются текстом и не мельчат вместе со схемой. */
export function LayoutLegend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {LAYOUT_LEGEND.map((l) => (
        <li key={l.key} className="inline-flex items-center gap-1.5">
          <svg viewBox="0 0 12 12" className="size-3 shrink-0" aria-hidden="true">
            {l.shape === "route" ? (
              <path d="M0 6H12" stroke={l.color} strokeWidth={2} strokeDasharray="3 2" />
            ) : l.shape === "point" ? (
              <rect x={1.5} y={1.5} width={9} height={9} fill={l.key === "charger" ? l.color : "#ffffff"} stroke={l.color} strokeWidth={2} />
            ) : (
              <rect x={0.5} y={0.5} width={11} height={11} fill={l.color} fillOpacity={0.45} stroke={l.color} />
            )}
          </svg>
          {l.label}
        </li>
      ))}
    </ul>
  );
}

/** Планировка для схемы отчёта по параметрам объекта и числу зарядок; null — параметры неполны. */
export function reportLayout(params: ParamValues, chargers: number): SimLayout | null {
  const p = layoutParamsFrom(params, chargers);
  return p ? buildWarehouseLayout(p) : null;
}
