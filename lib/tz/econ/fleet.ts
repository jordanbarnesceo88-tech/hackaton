import type { NormValues } from "../norms";
import type { ProcessDef } from "../processes";
import type { ItemResult, ProductForCalc, ScenarioItem, TraceStep } from "../types";
import type { ScenarioContext } from "./context";
import { FORMULAS } from "./formulas";
import { charOrigin } from "./internal";
import { fx, q } from "./text";

/**
 * Производительность и размер парка (ТЗ §3.5.2: «пиковая потребность в операциях /
 * эффективная производительность одного робота с учётом коэффициента загрузки, доступности и
 * резерва»).
 */

/** Защита от шума двоичной арифметики у ⌈…⌉: 3,0000000000000004 не должно давать 4. */
const CEIL_EPS = 1e-9;

export function ceilSafe(x: number): number {
  return Math.ceil(x - CEIL_EPS);
}

export type ThroughputResult = {
  thrNorm: number | null;
  thrCycle: number | null;
  thrEff: number | null;
  thrSource: ItemResult["thrSource"];
  routeLoadedM: number | null;
  routeEmptyM: number | null;
  /** Почему паспортная норма не пошла в расчёт (для подстановки); null — пошла или её нет. */
  normSkipped: string | null;
  trace: TraceStep[];
};

/** Сравнение единиц без учёта регистра, пробелов и синонимов «поддон/паллет», «час/ч». */
function normUnit(u: string): string {
  return u
    .toLowerCase()
    .replace(/[\s.]/g, "")
    .replace(/поддон(ов)?/g, "паллет")
    .replace(/час$/g, "ч");
}

/**
 * Паспортная норма продукта для процесса: только значение на один робот или станцию, в
 * единицах процесса и не «до X» (предел — не типичная производительность). Иначе null и
 * причина.
 */
export function normThroughput(
  product: ProductForCalc,
  process: ProcessDef,
): { value: number | null; skipped: string | null } {
  const v = product.throughputPerH;
  if (v === null || !Number.isFinite(v) || v <= 0) return { value: null, skipped: null };
  if (product.throughputScope !== "per-robot" && product.throughputScope !== "per-station") {
    return {
      value: null,
      skipped:
        product.throughputScope === "per-fleet"
          ? "паспортная цифра относится ко всему парку, а не к одному роботу"
          : "паспортная цифра не отнесена к одному роботу или станции",
    };
  }
  if (!product.throughputUnit || normUnit(product.throughputUnit) !== normUnit(process.throughputUnit)) {
    return {
      value: null,
      skipped: `единица паспортной цифры (${product.throughputUnit ?? "не указана"}) не совпадает с единицей процесса (${process.throughputUnit})`,
    };
  }
  if (product.throughputQualifier === "до") {
    return { value: null, skipped: `паспортная цифра «до ${fx(v)}» — предел, а не типичное значение` };
  }
  return { value: v, skipped: null };
}

/**
 * Производительность позиции сценария: паспортная норма, по циклу на планировке и принятая.
 * thrэфф = заданное вами, иначе min из известных; обе неизвестны — thrEff = null (вызывающий
 * код отказывает throughput_required).
 */
export function throughputFor(
  ctx: Pick<ScenarioContext, "products" | "processes" | "cycle"> & { norms?: NormValues },
  item: ScenarioItem,
): ThroughputResult {
  const product = ctx.products[item.productSlug];
  const process = ctx.processes[item.process];
  const empty: ThroughputResult = {
    thrNorm: null,
    thrCycle: null,
    thrEff: null,
    thrSource: null,
    routeLoadedM: null,
    routeEmptyM: null,
    normSkipped: null,
    trace: [],
  };
  if (!product || !process) return empty;

  const norm = normThroughput(product, process);
  const cyc = process.simSupported && product.mobile ? (ctx.cycle[product.slug] ?? null) : null;
  const thrCycle = cyc && Number.isFinite(cyc.thrPerH) && cyc.thrPerH > 0 ? cyc.thrPerH : null;
  const routeLoadedM = thrCycle !== null && cyc && Number.isFinite(cyc.loadedM) ? cyc.loadedM : null;
  const routeEmptyM = thrCycle !== null && cyc && Number.isFinite(cyc.emptyM) ? cyc.emptyM : null;

  const override = item.throughputPerHOverride;
  let thrEff: number | null = null;
  let thrSource: ItemResult["thrSource"] = null;
  if (typeof override === "number" && Number.isFinite(override) && override > 0) {
    thrEff = override;
    thrSource = "задано вами";
  } else if (norm.value !== null && thrCycle !== null) {
    thrEff = Math.min(norm.value, thrCycle);
    thrSource = thrCycle <= norm.value ? "цикл" : "норма";
  } else if (thrCycle !== null) {
    thrEff = thrCycle;
    thrSource = "цикл";
  } else if (norm.value !== null) {
    thrEff = norm.value;
    thrSource = "норма";
  }

  const unit = process.throughputUnit;
  const trace: TraceStep[] = [];
  if (norm.value !== null) {
    trace.push({
      key: "thrNorm",
      label: `${FORMULAS.thrNorm.title} — ${product.name}`,
      formula: FORMULAS.thrNorm.expression,
      substituted: `${fx(norm.value)} ${unit} (${product.throughputConfirmed ? "подтверждена" : "не подтверждена"} производителем)`,
      value: norm.value,
      unit,
      // Происхождение — из карточки продукта: у части продуктов норма взята организатором из
      // «Примеров решений», у остальных — из открытых источников (research).
      origin: charOrigin(product, "throughput", "research"),
    });
  }
  if (thrCycle !== null) {
    trace.push({
      key: "thrCycle",
      label: `${FORMULAS.thrCycle.title} — ${product.name}`,
      formula: FORMULAS.thrCycle.expression,
      substituted: cycleText(product, ctx.norms, routeLoadedM, routeEmptyM, thrCycle, unit),
      value: thrCycle,
      unit,
      origin: "derived",
    });
  }
  if (thrEff !== null) {
    const parts: string[] = [];
    if (thrSource === "задано вами") parts.push(`задано вами: ${fx(thrEff)}`);
    else if (norm.value !== null && thrCycle !== null) {
      parts.push(`min(${fx(norm.value)}; ${fx(thrCycle)}) = ${fx(thrEff)}`);
    } else parts.push(`${fx(thrEff)} (${thrSource === "цикл" ? "по циклу" : "паспортная норма"})`);
    if (norm.skipped) parts.push(`норма не применена: ${norm.skipped}`);
    trace.push({
      key: "thrEff",
      label: `${FORMULAS.thrEff.title} — ${product.name}`,
      formula: FORMULAS.thrEff.expression,
      substituted: parts.join("; "),
      value: thrEff,
      unit,
      origin: thrSource === "задано вами" ? "user" : "derived",
    });
  }
  return {
    thrNorm: norm.value,
    thrCycle,
    thrEff,
    thrSource,
    routeLoadedM,
    routeEmptyM,
    normSkipped: norm.skipped,
    trace,
  };
}

/** Время захвата груза по классу погрузки (нормативы handlingSec*); null — норматива нет. */
function handlingSecOf(product: ProductForCalc, norms: NormValues): number | null {
  if (product.handlingClass === "jacking") return norms.handlingSecJacking;
  if (product.handlingClass === "fork") return norms.handlingSecFork;
  if (product.handlingClass === "tug") return norms.handlingSecTug;
  return null;
}

/**
 * Подстановка для производительности по циклу. Само число приходит из имитации (та же формула
 * по той же планировке, lib/sim/analytic); здесь формула раскрывается числами, когда известны
 * скорость, доля скорости с грузом и время захвата.
 */
function cycleText(
  product: ProductForCalc,
  norms: NormValues | undefined,
  loadedM: number | null,
  emptyM: number | null,
  thr: number,
  unit: string,
): string {
  const v = product.speedMps;
  const h = norms ? handlingSecOf(product, norms) : null;
  if (norms && v !== null && v > 0 && h !== null && loadedM !== null && emptyM !== null) {
    const k = norms.loadedSpeedFactor;
    return `3600 / (${fx(emptyM, 1)} / ${fx(v)} + ${fx(loadedM, 1)} / (${fx(v)} × ${fx(k)}) + 2 × ${fx(h)}) = ${fx(thr)} ${unit}`;
  }
  return (
    `плечо с грузом ${fx(loadedM ?? 0, 1)} м, порожнее ${fx(emptyM ?? 0, 1)} м` +
    (v !== null ? `, v = ${fx(v)} м/с` : "") +
    ` → ${fx(thr)} ${unit}`
  );
}

/**
 * Размер парка: Nточн = λпик / (thrэфф × U × A) × (1 + резерв); Nавто = max(1, ⌈Nточн⌉).
 * Входы положительны (проверяет вызывающий код), поэтому деления на ноль нет.
 */
export function sizeFleet(i: {
  peakPerH: number;
  thrEff: number;
  utilization: number;
  availability: number;
  reservePct: number;
}): { nExact: number; nAuto: number } {
  const nExact = (i.peakPerH / (i.thrEff * i.utilization * i.availability)) * (1 + i.reservePct);
  return { nExact, nAuto: Math.max(1, ceilSafe(nExact)) };
}

/**
 * Доля пикового спроса, которую закрывает парк: κ = min(1; N × thrэфф × U × A / λпик). При
 * ручном N меньше расчётного κ < 1, и высвобождаемый труд снижается пропорционально.
 */
export function coverage(n: number, thrEff: number, utilization: number, availability: number, peakPerH: number): number {
  if (!(peakPerH > 0)) return 1;
  return Math.min(1, (n * thrEff * utilization * availability) / peakPerH);
}

export type ChargersResult = { count: number; method: "charge" | "ratio" | "none"; substituted: string };

/**
 * Число зарядных станций. Для мобильного робота с опубликованными автономностью и временем
 * зарядки — по доле времени на зарядке с запасом: C = max(1, ⌈N × tзар / (автономность × 60 +
 * tзар) × kзапас⌉); без этих данных — одна станция на robotsPerChargerDefault роботов. У
 * стационарных систем зарядных станций нет.
 */
export function chargersNeeded(n: number, product: ProductForCalc, norms: NormValues): ChargersResult {
  if (!product.mobile) return { count: 0, method: "none", substituted: "стационарная система — зарядные станции не нужны" };
  const a = product.autonomyH;
  const c = product.chargeMin;
  if (a !== null && c !== null && Number.isFinite(a) && Number.isFinite(c) && a > 0 && c > 0) {
    const shareCharging = c / (a * 60 + c);
    const count = Math.max(1, ceilSafe(n * shareCharging * norms.chargerSafetyFactor));
    return {
      count,
      method: "charge",
      substituted: `max(1; ⌈${fx(n)} × ${fx(c)} / (${fx(a)} × 60 + ${fx(c)}) × ${fx(norms.chargerSafetyFactor)}⌉) = ${count}`,
    };
  }
  const per = Math.max(1, norms.robotsPerChargerDefault);
  const count = Math.max(1, ceilSafe(n / per));
  return {
    count,
    method: "ratio",
    substituted: `нет данных о зарядке ${q(product.name)}: max(1; ⌈${fx(n)} / ${fx(per)}⌉) = ${count}`,
  };
}
