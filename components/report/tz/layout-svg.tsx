import { SWATCH_H, SWATCH_W, isoSceneSvg, isoSwatchMarkup, type IsoSwatch } from "@/components/sim/iso-scene";
import { LAYOUT_LIMITS, buildWarehouseLayout } from "@/lib/sim/layout";
import type { SimLayout, SimLayoutParams } from "@/lib/sim/types";
import type { ParamValues } from "@/lib/tz/types";

/**
 * Схема склада для печатного отчёта (ТЗ §3.6.1 — типовые зоны, маршруты, точки операций и
 * зарядка; §3.7.2 — отчёт). Рисуется на сервере в SVG из той же планировки
 * `buildWarehouseLayout`, что использует имитация и по которой экономика считает плечо
 * перевозки, поэтому схема в отчёте не расходится с расчётом (§3.6.2). Векторная картинка
 * печатается чётко, не требует canvas и не упирается в CSP.
 *
 * Картинка — та же изометрия, что у схемы имитации на экране (components/sim/iso-scene): на
 * экране — в палитре темы, при печати — в светлой. Роботов на схеме нет — это планировка, а не
 * кадр прогона; прогон с роботами показывает экран имитации.
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

export { rackRects } from "@/components/sim/scene-model";

/** Пункт легенды: образец изометрии и подпись. */
export const LAYOUT_LEGEND: readonly { key: string; label: string; swatch: IsoSwatch }[] = [
  { key: "dock", label: "Ворота и зарядки (точки операций)", swatch: { kind: "pad", busy: false } },
  { key: "charger", label: "Зарядная станция", swatch: { kind: "charger" } },
  { key: "rack", label: "Стеллажи зоны хранения", swatch: { kind: "rack" } },
  { key: "route", label: "Маршруты по осям проездов", swatch: { kind: "aisle" } },
];

/**
 * Изометрическая схема планировки. Размер берётся из viewBox: картинка тянется по ширине блока,
 * а малый и большой склад вписываются в неё одинаково.
 */
export function WarehouseLayoutSvg({ layout, label }: { layout: SimLayout; label: string }) {
  const svg = isoSceneSvg(layout, null, { style: "auto", label, className: "h-auto w-full" });
  return <div className="w-full" dangerouslySetInnerHTML={{ __html: svg }} />;
}

/** Легенда схемы — HTML под картинкой: подписи остаются текстом и не мельчат вместе со схемой. */
export function LayoutLegend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {LAYOUT_LEGEND.map((l) => (
        <li key={l.key} className="inline-flex items-center gap-1.5">
          <svg
            className="iso-root shrink-0"
            width={SWATCH_W}
            height={SWATCH_H}
            viewBox={`0 0 ${SWATCH_W} ${SWATCH_H}`}
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: isoSwatchMarkup(l.swatch) }}
          />
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
