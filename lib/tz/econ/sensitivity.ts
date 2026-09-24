import { normDef, type NormKey } from "../norms";
import type { ProcessDef } from "../processes";
import type { ScenarioItem, ScenarioOk, ScenarioResult, ScenarioSpec, SensitivityRow } from "../types";
import {
  FACILITY_PARAM_KEYS,
  HORIZON_MAX_YEARS,
  HORIZON_SCAN,
  normsForSpec,
  optNum,
  type ScenarioContext,
} from "./context";
import { comparisonScope, computeScenariosCore } from "./core";

/**
 * Анализ чувствительности (ТЗ §3.5.6: для каждого сценария — минимум к трём параметрам).
 * Каждое плечо — полный пересчёт всех сценариев с одним изменённым входом: парк
 * пересчитывается, охват сравнения и «Как есть» остаются согласованными.
 *
 * Границы плеча: диапазон организатора для параметра объекта (ctx.paramBounds; для горизонта
 * склада без него — встроенный диапазон организатора 3–10 лет, HORIZON_SCAN), иначе диапазон
 * норматива, иначе ±sensitivityDeltaPct от базового значения. Если текущее значение лежит вне
 * диапазона организатора, диапазон расширяется до него: плечо обязано накрывать анализируемый
 * сценарий. Затем значение прижимается к физическим пределам (загрузка не больше 1, пик не
 * меньше 1, горизонт — целые годы от 1 до HORIZON_MAX_YEARS).
 *
 * Флаги clampedLow/clampedHigh означают, что граница отличается от диапазона источника:
 * прижата к физическому пределу или расширена до текущего значения (baseOutsideSourceRange).
 *
 * Для сценариев роботизации размах — по NPV, для «Как есть» (у него нет NPV) — по TCO.
 */

/** Границы плеча и их источник. */
export type LeverBounds = Bounds;

type Bounds = {
  low: number;
  high: number;
  source: SensitivityRow["boundsSource"];
  clampedLow: boolean;
  clampedHigh: boolean;
};

type Lever = {
  lever: string;
  label: string;
  unit: string;
  base: number;
  bounds: Bounds;
  run: (value: number) => ScenarioResult | undefined;
};

/** Подписи зарплатных рычагов по ключу параметра (иначе — общая подпись). */
const SALARY_LABELS: Readonly<Record<string, string>> = {
  forkliftSalaryRubMonth: "Зарплата оператора погрузчика",
  pickerSalaryRubMonth: "Зарплата отборщика",
  cleanerSalaryRubMonth: "Зарплата уборщика",
  rampSalaryRubMonth: "Зарплата сотрудника перрона",
  terminalCleanerSalaryRubMonth: "Зарплата уборщика терминала",
  orderlySalaryRubMonth: "Зарплата санитара",
};

const HEADCOUNT_LABELS: Readonly<Record<string, string>> = {
  forkliftOperatorsCount: "Численность операторов погрузчиков",
  pickersCount: "Численность отборщиков",
  cleanersCount: "Численность уборщиков",
};

function salaryLabel(key: string): string {
  return SALARY_LABELS[key] ?? "Зарплата персонала процесса";
}

type BoundsOpts = {
  paramKey?: string;
  normKey?: NormKey;
  /**
   * Диапазон организатора, встроенный в движок, — когда ctx.paramBounds не передаёт границ
   * параметра (горизонт: HORIZON_SCAN).
   */
  organizerDefault?: readonly [number, number];
  hard?: [number, number];
  integer?: boolean;
};

/** Диапазон [min, max], если обе границы — конечные числа и min < max; иначе null. */
function rangeOf(min: number | null | undefined, max: number | null | undefined): [number, number] | null {
  return typeof min === "number" && typeof max === "number" && Number.isFinite(min) && Number.isFinite(max) && min < max
    ? [min, max]
    : null;
}

/**
 * Границы плеча: организатор → норматив → ±δ; диапазон расширяется до текущего значения,
 * если оно вне диапазона; затем физические пределы.
 */
export function leverBounds(ctx: ScenarioContext, base: number, o: BoundsOpts): Bounds {
  let low: number;
  let high: number;
  let source: SensitivityRow["boundsSource"];
  const pb = o.paramKey ? ctx.paramBounds?.[o.paramKey] : undefined;
  const def = o.normKey ? normDef(o.normKey) : undefined;
  const organizer = (pb ? rangeOf(pb.min, pb.max) : null) ?? (o.organizerDefault ? rangeOf(...o.organizerDefault) : null);
  const norm = def ? rangeOf(def.min, def.max) : null;
  if (organizer) {
    [low, high] = organizer;
    source = "организатор";
  } else if (norm) {
    [low, high] = norm;
    source = "норматив";
  } else {
    const d = Math.min(1, Math.max(0, ctx.norms.sensitivityDeltaPct));
    low = base * (1 - d);
    high = base * (1 + d);
    source = "±20 %";
  }
  // У отрицательного базового значения ±δ даёт границы в обратном порядке.
  if (low > high) [low, high] = [high, low];
  if (o.integer) {
    low = Math.round(low);
    high = Math.round(high);
  }
  let clampedLow = false;
  let clampedHigh = false;
  // Текущее значение вне диапазона источника (например, зарплата 200 000 ₽/мес при диапазоне
  // организатора 80 000–170 000): диапазон расширяется до него, граница помечается.
  if (Number.isFinite(base) && base < low) {
    low = base;
    clampedLow = true;
  }
  if (Number.isFinite(base) && base > high) {
    high = base;
    clampedHigh = true;
  }
  const [lo, hi] = o.hard ?? [-Infinity, Infinity];
  if (low < lo) {
    low = lo;
    clampedLow = true;
  }
  if (high > hi) {
    high = hi;
    clampedHigh = true;
  }
  if (low > hi) {
    low = hi;
    clampedLow = true;
  }
  if (high < lo) {
    high = lo;
    clampedHigh = true;
  }
  if (low > high) [low, high] = [high, low];
  return { low, high, source, clampedLow, clampedHigh };
}

/**
 * Опции границ горизонта: ctx.paramBounds.horizonYears, для склада без него — диапазон
 * организатора HORIZON_SCAN (3–10 лет), для других типов объектов — ±δ (у аэропорта и
 * медучреждения диапазон организатора 5–15 лет, и подпись «организатор» для 3–10 была бы
 * неверной). Целые годы от 1 до HORIZON_MAX_YEARS.
 */
function horizonBoundsOpts(ctx: Pick<ScenarioContext, "facility">): Omit<BoundsOpts, "paramKey"> {
  return {
    hard: [1, HORIZON_MAX_YEARS],
    integer: true,
    organizerDefault: ctx.facility === "warehouse" ? HORIZON_SCAN : undefined,
  };
}

/**
 * Диапазон горизонтов, лет, вокруг текущего горизонта `base`: границы рычага «Горизонт
 * расчёта» и диапазон, на котором вывод ищет смену рекомендации (conclusion.horizonFlip).
 */
export function horizonBounds(ctx: ScenarioContext, base: number): Bounds {
  return leverBounds(ctx, base, { ...horizonBoundsOpts(ctx), paramKey: FACILITY_PARAM_KEYS.horizonYears });
}

/**
 * Текущее значение рычага лежало вне диапазона организатора или норматива, и диапазон
 * расширен до него: граница совпадает с текущим значением и помечена флагом. У ±20 % такого
 * не бывает — этот диапазон строится вокруг текущего значения.
 */
export function baseOutsideSourceRange(row: Pick<SensitivityRow, "base" | "low" | "high" | "boundsSource" | "clampedLow" | "clampedHigh">): boolean {
  if (row.boundsSource === "±20 %") return false;
  return (row.clampedLow && row.low === row.base) || (row.clampedHigh && row.high === row.base);
}

function findResult(results: ScenarioResult[], key: string): ScenarioResult | undefined {
  return results.find((r) => r.key === key);
}

function withParams(ctx: ScenarioContext, patch: Record<string, number>): ScenarioContext {
  return { ...ctx, params: { ...ctx.params, ...patch } };
}

function patchSpec(
  specs: readonly ScenarioSpec[],
  key: string,
  fn: (s: ScenarioSpec) => ScenarioSpec,
): ScenarioSpec[] {
  return specs.map((s) => (s.key === key ? fn(s) : s));
}

/** Плечо по параметру объекта (зарплата, пик, горизонт, численность). */
function paramLever(
  ctx: ScenarioContext,
  specs: readonly ScenarioSpec[],
  targetKey: string,
  def: {
    lever: string;
    label: string;
    unit: string;
    paramKey: string;
    base: number;
    bounds: Omit<BoundsOpts, "paramKey">;
  },
): Lever {
  return {
    lever: def.lever,
    label: def.label,
    unit: def.unit,
    base: def.base,
    bounds: leverBounds(ctx, def.base, { ...def.bounds, paramKey: def.paramKey }),
    run: (v) => findResult(computeScenariosCore(withParams(ctx, { [def.paramKey]: v }), specs), targetKey),
  };
}

/** Плечо «Горизонт расчёта» (у всех сценариев, включая «Как есть»); null — горизонт не задан. */
function horizonLever(ctx: ScenarioContext, specs: readonly ScenarioSpec[], targetKey: string): Lever | null {
  const h = optNum(ctx.params, FACILITY_PARAM_KEYS.horizonYears);
  if (h === null) return null;
  return paramLever(ctx, specs, targetKey, {
    lever: "horizon",
    label: "Горизонт расчёта",
    unit: "лет",
    paramKey: FACILITY_PARAM_KEYS.horizonYears,
    base: Math.round(h),
    bounds: horizonBoundsOpts(ctx),
  });
}

/** Плечо по нормативу: переопределение в самом сценарии (перекрывает и его собственные). */
function normLever(
  ctx: ScenarioContext,
  specs: readonly ScenarioSpec[],
  spec: ScenarioSpec,
  def: { lever: string; label: string; unit: string; normKey: NormKey },
): Lever {
  const base = normsForSpec(ctx, spec)[def.normKey];
  return {
    lever: def.lever,
    label: def.label,
    unit: def.unit,
    base,
    bounds: leverBounds(ctx, base, { normKey: def.normKey }),
    run: (v) =>
      findResult(
        computeScenariosCore(
          ctx,
          patchSpec(specs, spec.key, (s) => ({ ...s, normOverrides: { ...s.normOverrides, [def.normKey]: v } })),
        ),
        spec.key,
      ),
  };
}

type ItemField = "priceRubOverride" | "raasRubMonthOverride" | "throughputPerHOverride" | "serviceRubYearOverride";

/**
 * Плечо по корректировке позиций: все позиции сценария масштабируются одним множителем
 * (значение / базовое значение первой позиции), показывается первая позиция.
 */
function itemLever(
  ctx: ScenarioContext,
  specs: readonly ScenarioSpec[],
  spec: ScenarioSpec,
  def: { lever: string; label: string; unit: string; field: ItemField; bases: number[]; hard: [number, number] },
): Lever | null {
  const base = def.bases[0];
  if (base === undefined || !(base > 0)) return null;
  return {
    lever: def.lever,
    label: def.label,
    unit: def.unit,
    base,
    bounds: leverBounds(ctx, base, { hard: def.hard }),
    run: (v) => {
      const factor = v / base;
      const patched = patchSpec(specs, spec.key, (s) => ({
        ...s,
        items: s.items.map((it: ScenarioItem, i: number) => ({ ...it, [def.field]: (def.bases[i] ?? base) * factor })),
      }));
      return findResult(computeScenariosCore(ctx, patched), spec.key);
    },
  };
}

function volumeLever(ctx: ScenarioContext, specs: readonly ScenarioSpec[], spec: ScenarioSpec, base: ScenarioOk): Lever | null {
  const first = base.items[0];
  if (!first || !(first.demandPerDay > 0)) return null;
  const keys = new Set<string>();
  let unit = "ед./сут";
  let pallets = false;
  for (const it of spec.items) {
    const p = ctx.processes[it.process];
    if (!p?.demand) continue;
    if (it === spec.items[0]) {
      unit = p.demandUnit;
      pallets = p.demandUnit.startsWith("паллет");
    }
    for (const k of p.demand.sumParams) keys.add(k);
  }
  const perDay = first.demandPerDay;
  return {
    lever: "volume",
    label: pallets ? "Объём паллет" : "Объём операций",
    unit,
    base: perDay,
    bounds: leverBounds(ctx, perDay, { hard: [0, Infinity] }),
    run: (v) => {
      const factor = v / perDay;
      const patch: Record<string, number> = {};
      for (const k of keys) patch[k] = (optNum(ctx.params, k) ?? 0) * factor;
      return findResult(computeScenariosCore(withParams(ctx, patch), specs), spec.key);
    },
  };
}

function robotLevers(ctx: ScenarioContext, spec: ScenarioSpec, specs: readonly ScenarioSpec[], base: ScenarioOk): Lever[] {
  const levers: (Lever | null)[] = [];
  const first = spec.items[0];
  const proc: ProcessDef | undefined = first ? ctx.processes[first.process] : undefined;
  const products = spec.items.map((it) => ctx.products[it.productSlug]);

  if (proc?.salaryParam) {
    const s = optNum(ctx.params, proc.salaryParam);
    if (s !== null) {
      levers.push(
        paramLever(ctx, specs, spec.key, {
          lever: "salary",
          label: salaryLabel(proc.salaryParam),
          unit: "₽/мес",
          paramKey: proc.salaryParam,
          base: s,
          bounds: { hard: [0, Infinity] },
        }),
      );
    }
  }
  if (spec.kind === "purchase") {
    levers.push(
      itemLever(ctx, specs, spec, {
        lever: "equipmentPrice",
        label: "Цена робота",
        unit: "₽",
        field: "priceRubOverride",
        bases: spec.items.map((it, i) => it.priceRubOverride ?? products[i]?.priceRub ?? 0),
        hard: [1, Infinity],
      }),
    );
  } else {
    levers.push(
      itemLever(ctx, specs, spec, {
        lever: "raasRate",
        label: "Ставка RaaS",
        unit: "₽/мес",
        field: "raasRubMonthOverride",
        bases: spec.items.map((it, i) => it.raasRubMonthOverride ?? products[i]?.raasRubMonth ?? 0),
        hard: [1, Infinity],
      }),
    );
  }
  levers.push(
    itemLever(ctx, specs, spec, {
      lever: "throughput",
      label: "Производительность робота",
      unit: proc?.throughputUnit ?? "ед./ч",
      field: "throughputPerHOverride",
      bases: base.items.map((r) => r.thrEff ?? 0),
      hard: [1e-6, Infinity],
    }),
  );
  levers.push(
    normLever(ctx, specs, spec, { lever: "utilization", label: "Коэффициент загрузки", unit: "доля", normKey: "utilization" }),
  );
  if (proc?.peakFactorParam) {
    const pf = optNum(ctx.params, proc.peakFactorParam);
    if (pf !== null) {
      levers.push(
        paramLever(ctx, specs, spec.key, {
          lever: "peakFactor",
          label: "Пиковый коэффициент",
          unit: "коэф.",
          paramKey: proc.peakFactorParam,
          base: pf,
          bounds: { hard: [1, Infinity] },
        }),
      );
    }
  }
  levers.push(volumeLever(ctx, specs, spec, base));
  if (spec.kind === "purchase") {
    const fromNorm = spec.items.every(
      (it, i) => it.serviceRubYearOverride === undefined && (products[i]?.serviceRubYear ?? null) === null,
    );
    if (fromNorm) {
      levers.push(
        normLever(ctx, specs, spec, {
          lever: "servicePct",
          label: "Сервис, % цены",
          unit: "доля в год",
          normKey: "servicePctOfPriceYear",
        }),
      );
    } else {
      levers.push(
        itemLever(ctx, specs, spec, {
          lever: "service",
          label: "Сервис, ₽/год за робота",
          unit: "₽/год",
          field: "serviceRubYearOverride",
          bases: spec.items.map((it, i) => it.serviceRubYearOverride ?? products[i]?.serviceRubYear ?? 0),
          hard: [0, Infinity],
        }),
      );
    }
  }
  levers.push(
    normLever(ctx, specs, spec, {
      lever: "laborShare",
      label: "Доля автоматизируемого труда",
      unit: "доля",
      normKey: "laborShareAutomatable",
    }),
  );
  levers.push(horizonLever(ctx, specs, spec.key));
  levers.push(
    normLever(ctx, specs, spec, { lever: "discountRate", label: "Ставка дисконтирования", unit: "доля в год", normKey: "discountRate" }),
  );
  return levers.filter((l): l is Lever => l !== null);
}

function asisLevers(ctx: ScenarioContext, spec: ScenarioSpec, specs: readonly ScenarioSpec[]): Lever[] {
  const levers: Lever[] = [];
  const proc = comparisonScope(ctx, specs).scope[0];
  if (proc?.salaryParam) {
    const s = optNum(ctx.params, proc.salaryParam);
    if (s !== null) {
      levers.push(
        paramLever(ctx, specs, spec.key, {
          lever: "salary",
          label: salaryLabel(proc.salaryParam),
          unit: "₽/мес",
          paramKey: proc.salaryParam,
          base: s,
          bounds: { hard: [0, Infinity] },
        }),
      );
    }
  }
  if (proc?.headcountParam) {
    const hc = optNum(ctx.params, proc.headcountParam);
    if (hc !== null) {
      levers.push(
        paramLever(ctx, specs, spec.key, {
          lever: "headcount",
          label: HEADCOUNT_LABELS[proc.headcountParam] ?? "Численность персонала процесса",
          unit: "чел.",
          paramKey: proc.headcountParam,
          base: hc,
          bounds: { hard: [0, Infinity] },
        }),
      );
    }
  }
  const horizon = horizonLever(ctx, specs, spec.key);
  if (horizon) levers.push(horizon);
  return levers;
}

function okOf(r: ScenarioResult | undefined): ScenarioOk | null {
  return r && r.status === "ok" ? r : null;
}

/**
 * Чувствительность сценария к рычагам (ТЗ §3.5.6). `base` — уже посчитанный результат
 * сценария (если не передан, считается заново). Отказ сценария — пустой список.
 * Сортировка — по размаху результата, от сильнейшего рычага.
 */
export function scenarioSensitivity(
  ctx: ScenarioContext,
  spec: ScenarioSpec,
  allSpecs: readonly ScenarioSpec[],
  base?: ScenarioResult,
): SensitivityRow[] {
  const b = okOf(base ?? findResult(computeScenariosCore(ctx, allSpecs), spec.key));
  if (!b) return [];
  const asis = spec.kind === "asis";
  const levers = asis ? asisLevers(ctx, spec, allSpecs) : robotLevers(ctx, spec, allSpecs, b);
  const rows: SensitivityRow[] = levers.map((l) => {
    const lo = okOf(l.run(l.bounds.low));
    const hi = okOf(l.run(l.bounds.high));
    const npvLow = asis ? null : (lo?.npvRub ?? null);
    const npvHigh = asis ? null : (hi?.npvRub ?? null);
    const tcoLow = lo?.tcoRub ?? b.tcoRub;
    const tcoHigh = hi?.tcoRub ?? b.tcoRub;
    const swing = asis
      ? Math.abs(tcoHigh - tcoLow)
      : npvLow !== null && npvHigh !== null
        ? Math.abs(npvHigh - npvLow)
        : 0;
    return {
      lever: l.lever,
      label: l.label,
      unit: l.unit,
      base: l.base,
      low: l.bounds.low,
      high: l.bounds.high,
      boundsSource: l.bounds.source,
      clampedLow: l.bounds.clampedLow,
      clampedHigh: l.bounds.clampedHigh,
      npvBase: asis ? null : b.npvRub,
      npvLow,
      npvHigh,
      paybackLow: asis ? null : (lo?.paybackYears ?? null),
      paybackHigh: asis ? null : (hi?.paybackYears ?? null),
      tcoLow,
      tcoHigh,
      swing,
      signFlip: npvLow !== null && npvHigh !== null && (npvLow >= 0) !== (npvHigh >= 0),
    };
  });
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b2) => b2.r.swing - a.r.swing || a.i - b2.i)
    .map(({ r }) => r);
}
