import type { NormValues } from "../norms";
import type { ProcessDef } from "../processes";
import type {
  ItemResult,
  Refusal,
  ScenarioItem,
  ScenarioOk,
  ScenarioRefused,
  ScenarioResult,
  ScenarioSpec,
  TraceStep,
} from "../types";
import { purchaseCapexLines, raasCapexLines } from "./capex";
import {
  RefusalError,
  horizonOf,
  normsForSpec,
  refuse,
  workHours,
  type ScenarioContext,
  type WorkHours,
} from "./context";
import { processDemand, type DemandResult } from "./demand";
import { cashflows, dpbOf, npvOf, payback, roiNet, roiTz, tcoAsis, tcoOf, type PeriodicCost } from "./finance";
import { chargersNeeded, coverage, sizeFleet, throughputFor, type ChargersResult, type ThroughputResult } from "./fleet";
import { FORMULAS } from "./formulas";
import { sumLines, type ItemCalc } from "./internal";
import { interpretBand } from "./interpret";
import {
  operatingStaff,
  operatorPosts,
  processBaseline,
  releasedFte,
  remaining,
  type ProcessBaseline,
} from "./labour";
import { asisOpexLines, batteryOf, equipmentRub, lifeOf, purchaseOpexLines, raasOpexLines } from "./opex";
import { fx, q, rub, share, yearsNom } from "./text";

/**
 * Сборка сценариев без анализа чувствительности, рисков и пороговой зарплаты — «ядро»,
 * которое многократно перезапускают чувствительность, пороговая зарплата и смена вывода по
 * горизонту. Публичная точка входа с полным результатом — `computeScenarios` (scenario.ts).
 *
 * Охват сравнения (ТЗ §3.5.5 — сценарии сравниваются на одном и том же объёме работ): все
 * процессы, которые роботизирует хотя бы один сценарий. «Как есть» — ФОТ персонала всех
 * процессов охвата; сценарий роботизации платит за процессы охвата, которые он не
 * роботизирует, их базовый ФОТ. Поэтому эффект E = OPEXкак есть − OPEXсценария сравним между
 * сценариями.
 *
 * Движок тотален: отказ (нет цены, производительности, персонала и т. п.) возвращается как
 * `ScenarioRefused` с сообщением, какое поле заполнить; NaN и ±∞ наружу не выходят.
 */

type BaseOk = {
  ok: true;
  list: ProcessBaseline[];
  byProcess: Map<string, ProcessBaseline>;
  totalRub: number;
  trace: TraceStep[];
};
type Base = BaseOk | { ok: false; refusal: Refusal };

/** Процессы охвата сравнения и первый процесс без экономики (для отказа «Как есть»). */
export function comparisonScope(
  ctx: Pick<ScenarioContext, "processes">,
  specs: readonly ScenarioSpec[],
): { scope: ProcessDef[]; unsupported: ProcessDef | null } {
  const scope: ProcessDef[] = [];
  const seen = new Set<string>();
  let unsupported: ProcessDef | null = null;
  for (const spec of specs) {
    if (spec.kind === "asis") continue;
    for (const item of spec.items ?? []) {
      const p = ctx.processes[item.process];
      if (!p) continue;
      if (!p.calcSupported) {
        unsupported ??= p;
        continue;
      }
      if (seen.has(p.slug)) continue;
      seen.add(p.slug);
      scope.push(p);
    }
  }
  return { scope, unsupported };
}

function baseOf(ctx: ScenarioContext, specs: readonly ScenarioSpec[]): Base {
  const { scope, unsupported } = comparisonScope(ctx, specs);
  if (scope.length === 0) {
    const refusal: Refusal = unsupported
      ? {
          reason: "calc_not_supported",
          fields: [],
          message: `Экономика для процесса «${unsupported.name}» в прототипе не рассчитывается (§5.7)`,
        }
      : {
          reason: "invalid_inputs",
          fields: ["scenario:add"],
          message:
            "Нет сценария роботизации с рассчитываемым процессом — охват сравнения не определён: добавьте сценарий покупки или услуги",
        };
    return { ok: false, refusal };
  }
  try {
    const list = scope.map((p) => processBaseline(ctx, p, ctx.norms));
    return {
      ok: true,
      list,
      byProcess: new Map(list.map((b) => [b.process.slug, b])),
      totalRub: list.reduce((a, b) => a + b.baselineRub, 0),
      trace: list.flatMap((b) => b.trace),
    };
  } catch (e) {
    if (e instanceof RefusalError) return { ok: false, refusal: e.refusal };
    throw e;
  }
}

function refused(
  spec: ScenarioSpec,
  refusal: Refusal,
  items: ItemResult[],
  trace: TraceStep[],
): ScenarioRefused {
  return {
    key: spec.key,
    name: spec.name,
    kind: spec.kind,
    status: "refused",
    refusal,
    // Посчитанное до отказа показывается, но только конечные числа.
    items: items.filter(allFinite),
    risks: [],
    trace: trace.filter(allFinite),
  };
}

function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Отказ-страховка: расчёт дал NaN или ±∞ (вырожденный ввод, который не поймали проверки). */
const NON_FINITE: Refusal = {
  reason: "invalid_inputs",
  fields: [],
  message: "Расчёт дал нечисловой результат — проверьте параметры объекта и корректировки сценария",
};

/**
 * Все числа в результате конечны. Последний рубеж обещания «без NaN и ±∞»: если вырожденный
 * ввод прошёл проверки, сценарий становится отказом invalid_inputs, а не числом на экране.
 */
export function allFinite(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(allFinite);
  if (value !== null && typeof value === "object") return Object.values(value).every(allFinite);
  return true;
}

/**
 * Проверка ручных корректировок позиции: отрицательная или нулевая цена — ошибка ввода. Число
 * роботов — только целое: дробное не округляется молча, иначе трассировка показала бы «задано
 * вами» число, которого пользователь не вводил.
 */
function validateOverrides(item: ScenarioItem, productName: string): void {
  const f = (what: string) => `item:${item.process}:${what}`;
  if (item.quantityOverride !== undefined && !(Number.isInteger(item.quantityOverride) && item.quantityOverride >= 1)) {
    refuse("invalid_inputs", `Число роботов ${q(productName)} должно быть целым числом не меньше 1`, [f("quantity")]);
  }
  if (item.priceRubOverride !== undefined && !(finite(item.priceRubOverride) && item.priceRubOverride > 0)) {
    refuse("invalid_inputs", `Цена ${q(productName)} должна быть больше нуля, ₽ за единицу`, [f("price")]);
  }
  if (item.throughputPerHOverride !== undefined && !(finite(item.throughputPerHOverride) && item.throughputPerHOverride > 0)) {
    refuse("invalid_inputs", `Производительность ${q(productName)} должна быть больше нуля`, [f("throughput")]);
  }
  if (item.serviceRubYearOverride !== undefined && !(finite(item.serviceRubYearOverride) && item.serviceRubYearOverride >= 0)) {
    refuse("invalid_inputs", `Сервис ${q(productName)} не может быть отрицательным, ₽/год за робота`, [f("service")]);
  }
  if (item.raasRubMonthOverride !== undefined && !(finite(item.raasRubMonthOverride) && item.raasRubMonthOverride > 0)) {
    refuse("invalid_inputs", `Ставка RaaS ${q(productName)} должна быть больше нуля, ₽/мес за робота`, [f("raasRate")]);
  }
}

/** Физическая часть позиции: спрос, производительность, парк, зарядки. */
type Physical = {
  item: ScenarioItem;
  process: ProcessDef;
  demand: DemandResult;
  thr: ThroughputResult & { thrEff: number };
  nExact: number;
  nAuto: number;
  n: number;
  kappa: number;
  chargers: ChargersResult;
  trace: TraceStep[];
};

function physicalOf(ctx: ScenarioContext, item: ScenarioItem, norms: NormValues, hours: WorkHours): Physical {
  const process = ctx.processes[item.process];
  const product = ctx.products[item.productSlug];
  // Наличие проверено до вызова; повтор — для сужения типов.
  if (!process || !product) refuse("invalid_inputs", "Позиция сценария ссылается на неизвестный процесс или продукт");
  const demand = processDemand(ctx, process, hours);
  const thr = throughputFor(ctx, item);
  if (thr.thrEff === null) {
    refuse(
      "throughput_required",
      `Нет производительности для ${q(product.name)}: укажите её вручную в поле «Производительность, ${process.throughputUnit}» или выберите другой продукт`,
      [`item:${process.slug}:throughput`],
    );
  }
  const thrEff = thr.thrEff;
  const U = norms.utilization;
  const A = norms.availability;
  if (!(U > 0 && A > 0 && norms.reservePct >= 0)) {
    refuse("invalid_inputs", "Коэффициенты загрузки и доступности должны быть больше нуля: проверьте нормативы");
  }
  const { nExact, nAuto } = sizeFleet({
    peakPerH: demand.peakPerHour,
    thrEff,
    utilization: U,
    availability: A,
    reservePct: norms.reservePct,
  });
  if (!Number.isFinite(nExact)) {
    refuse("invalid_inputs", `Расчёт парка ${q(product.name)} не дал конечного числа: проверьте объёмы и производительность`, [
      `item:${process.slug}:throughput`,
    ]);
  }
  // Ручное N уже проверено: целое не меньше 1 (validateOverrides).
  const overridden = item.quantityOverride !== undefined;
  const n = item.quantityOverride ?? nAuto;
  const kappa = coverage(n, thrEff, U, A, demand.peakPerHour);
  const chargers = chargersNeeded(n, product, norms);

  const trace: TraceStep[] = [
    ...demand.trace,
    ...thr.trace,
    {
      key: "fleet",
      label: `${FORMULAS.fleet.title} — ${product.name}`,
      formula: FORMULAS.fleet.expression,
      substituted:
        `Nточн = ${fx(demand.peakPerHour)} / (${fx(thrEff)} × ${fx(U)} × ${fx(A)}) × (1 + ${fx(norms.reservePct)}) = ${fx(nExact)}; ` +
        (overridden ? `N = ${n} (задано вами, расчёт даёт ${nAuto})` : `N = max(1; ⌈${fx(nExact)}⌉) = ${n}`),
      value: n,
      unit: "шт.",
      origin: overridden ? "user" : "derived",
    },
    {
      key: "coverage",
      label: FORMULAS.coverage.title,
      formula: FORMULAS.coverage.expression,
      substituted: `min(1; ${n} × ${fx(thrEff)} × ${fx(U)} × ${fx(A)} / ${fx(demand.peakPerHour)}) = ${fx(kappa, 3)}`,
      value: kappa,
      unit: "доля",
      origin: "derived",
    },
    {
      key: "chargers",
      label: FORMULAS.chargers.title,
      formula: FORMULAS.chargers.expression,
      substituted: chargers.substituted,
      value: chargers.count,
      unit: "шт.",
      origin: "derived",
    },
  ];
  return { item, process, demand, thr: { ...thr, thrEff }, nExact, nAuto, n, kappa, chargers, trace };
}

/** Труд позиции и итоговый ItemResult. */
function withLabour(
  ctx: ScenarioContext,
  ph: Physical,
  base: BaseOk,
  norms: NormValues,
  hours: WorkHours,
): { calc: ItemCalc; trace: TraceStep[] } {
  const product = ctx.products[ph.item.productSlug];
  const pb = base.byProcess.get(ph.process.slug);
  if (!product || !pb) refuse("invalid_inputs", "Позиция сценария вне охвата сравнения");
  const F = releasedFte(pb.headcount, norms.laborShareAutomatable, ph.demand.excludeSharePct, ph.kappa);
  const remainingRub = remaining(pb.headcount, F, pb.roleCost);
  const posts = operatorPosts(ph.n, norms);
  const opStaff = operatingStaff(posts, hours.Hd, hours.D, norms, pb.roleCost);
  const result: ItemResult = {
    process: ph.process.slug,
    productSlug: product.slug,
    productName: product.name,
    manuallyAdded: Boolean(ph.item.manuallyAdded),
    demandPerDay: ph.demand.perDay,
    avgPerHour: ph.demand.avgPerHour,
    peakPerHour: ph.demand.peakPerHour,
    thrNorm: ph.thr.thrNorm,
    thrCycle: ph.thr.thrCycle,
    thrEff: ph.thr.thrEff,
    thrSource: ph.thr.thrSource,
    routeLoadedM: ph.thr.routeLoadedM,
    routeEmptyM: ph.thr.routeEmptyM,
    nExact: ph.nExact,
    nAuto: ph.nAuto,
    n: ph.n,
    nOverridden: ph.item.quantityOverride !== undefined,
    coverage: ph.kappa,
    chargers: ph.chargers.count,
    operatorPosts: posts,
    headcount: pb.headcount,
    roleCostRubYear: pb.roleCost,
    releasedFte: F,
    baselineLabourRub: pb.baselineRub,
    remainingLabourRub: remainingRub,
    operatingStaffRub: opStaff,
  };
  const trace: TraceStep[] = [
    {
      key: "releasedFte",
      label: FORMULAS.releasedFte.title,
      formula: FORMULAS.releasedFte.expression,
      substituted: `${fx(pb.headcount)} × ${fx(norms.laborShareAutomatable)} × (1 − ${fx(ph.demand.excludeSharePct)}/100) × ${fx(ph.kappa, 3)} = ${fx(F, 3)}`,
      value: F,
      unit: "ставок",
      origin: "derived",
    },
    {
      key: "remainingLabour",
      label: FORMULAS.remainingLabour.title,
      formula: FORMULAS.remainingLabour.expression,
      substituted: `(${fx(pb.headcount)} − ${fx(F, 3)}) × ${rub(pb.roleCost)} = ${rub(remainingRub)}`,
      value: remainingRub,
      unit: "₽/год",
      origin: "derived",
    },
    {
      key: "operatingStaff",
      label: FORMULAS.operatingStaff.title,
      formula: FORMULAS.operatingStaff.expression,
      substituted: `⌈${ph.n} / ${fx(norms.robotsPerOperatorPost)}⌉ = ${posts}; ${posts} × ${fx(hours.Hd)} × ${fx(hours.D)} / ${fx(norms.annualHoursPerFte)} × ${rub(pb.roleCost)} = ${rub(opStaff)}`,
      value: opStaff,
      unit: "₽/год",
      origin: "derived",
    },
  ];
  const calc: ItemCalc = {
    item: ph.item,
    process: ph.process,
    product,
    norms,
    hours,
    n: ph.n,
    chargers: ph.chargers.count,
    roleCost: pb.roleCost,
    priceRub: null,
    priceOverridden: false,
    raasRubMonth: null,
    raasOverridden: false,
    result,
  };
  return { calc, trace };
}

/** Деньги позиции: цена для покупки, ставка для RaaS; нет данных — типизированный отказ. */
function withMoney(calc: ItemCalc, kind: ScenarioSpec["kind"]): void {
  const p = calc.product;
  const item = calc.item;
  if (kind === "purchase") {
    const override = item.priceRubOverride;
    const price = override ?? p.priceRub;
    if (price === null || !finite(price) || price <= 0) {
      refuse("price_required", `Нет цены ${q(p.name)}: укажите цену за единицу, ₽`, [`item:${item.process}:price`]);
    }
    calc.priceRub = price;
    calc.priceOverridden = override !== undefined;
  } else if (kind === "raas") {
    const override = item.raasRubMonthOverride;
    const rate = override ?? p.raasRubMonth;
    if (rate === null || !finite(rate) || rate <= 0) {
      refuse(
        "raas_rate_required",
        `Нет ставки RaaS для ${q(p.name)}: укажите ставку, ₽/мес за робота, или нажмите «Подставить оценку (${share(calc.norms.raasMonthlyPctOfPrice)} цены в месяц)»`,
        [`item:${item.process}:raasRate`],
      );
    }
    calc.raasRubMonth = rate;
    calc.raasOverridden = override !== undefined;
    // Цена нужна RaaS только для справки (оценка ставки); в расчёт не идёт.
    calc.priceRub = item.priceRubOverride ?? p.priceRub;
  }
}

function asisResult(ctx: ScenarioContext, spec: ScenarioSpec, base: Base): ScenarioResult {
  if (!base.ok) return refused(spec, base.refusal, [], []);
  const norms = normsForSpec(ctx, spec);
  const trace: TraceStep[] = [...base.trace];
  try {
    // H «Как есть» не нужен (нет CAPEX и NPV), но проверяется: без горизонта нет и T.
    const { T } = horizonOf(ctx, norms);
    const opexLines = asisOpexLines(base.list);
    const opex = sumLines(opexLines);
    const rows = cashflows({
      capexRub: 0,
      opexYearRub: opex,
      opexAsisRub: opex,
      batteryAvgRub: 0,
      batteryEvents: [],
      reinvestEvents: [],
      tcoYears: T,
      discountRate: norms.discountRate,
    });
    const tco = tcoAsis(opex, T);
    trace.push({
      key: "tco",
      label: `${FORMULAS.tco.title} (как есть)`,
      formula: FORMULAS.tco.expression,
      substituted: `${T} × ${rub(opex)} = ${rub(tco)}`,
      value: tco,
      unit: "₽",
      origin: "derived",
    });
    const ok: ScenarioOk = {
      key: spec.key,
      name: spec.name,
      kind: spec.kind,
      status: "ok",
      items: [],
      capexRub: 0,
      capexLines: [],
      opexYearRub: opex,
      opexLines,
      processLabourYearRub: opex,
      effectYearRub: 0,
      paybackYears: null,
      band: "none",
      roiTzPct: null,
      roiNetPct: null,
      npvRub: null,
      discountedPaybackYears: null,
      tcoRub: tco,
      tcoYears: T,
      tcoDeltaVsAsIsRub: 0,
      cashflows: rows,
      sensitivity: [],
      risks: [],
      trace,
      breakEvenSalaryRubMonth: null,
    };
    return allFinite(ok) ? ok : refused(spec, NON_FINITE, [], []);
  } catch (e) {
    if (e instanceof RefusalError) return refused(spec, e.refusal, [], trace);
    throw e;
  }
}

function robotResult(ctx: ScenarioContext, spec: ScenarioSpec, base: Base): ScenarioResult {
  const norms = normsForSpec(ctx, spec);
  const trace: TraceStep[] = [];
  const items: ItemResult[] = [];
  try {
    if (spec.kind !== "purchase" && spec.kind !== "raas") {
      refuse("invalid_inputs", `Неизвестный вид сценария ${q(String(spec.kind))}`);
    }
    const specItems = spec.items ?? [];
    if (specItems.length === 0) {
      refuse("invalid_inputs", `В сценарии ${q(spec.name)} не выбрано ни одного решения: добавьте продукт`, [
        "scenario:items",
      ]);
    }
    const seen = new Set<string>();
    for (const item of specItems) {
      if (seen.has(item.process)) {
        refuse(
          "invalid_inputs",
          `В сценарии ${q(spec.name)} несколько решений для одного процесса ${q(ctx.processes[item.process]?.name ?? item.process)}: оставьте одно`,
          [`item:${item.process}:manual`],
        );
      }
      seen.add(item.process);
      const process = ctx.processes[item.process];
      if (!process) refuse("invalid_inputs", `Неизвестный процесс ${q(item.process)}`, [`item:${item.process}:manual`]);
      if (!process.calcSupported) {
        refuse("calc_not_supported", `Экономика для процесса ${q(process.name)} в прототипе не рассчитывается (§5.7)`);
      }
      const product = ctx.products[item.productSlug];
      if (!product) {
        refuse("invalid_inputs", `Продукт ${q(item.productSlug)} не найден в каталоге — выберите другой`, [
          `item:${item.process}:manual`,
        ]);
      }
      validateOverrides(item, product.name);
    }

    const hours = workHours(ctx);
    trace.push(hours.trace);
    const physical = specItems.map((item) => {
      const ph = physicalOf(ctx, item, norms, hours);
      trace.push(...ph.trace);
      return ph;
    });

    if (!base.ok) throw new RefusalError(base.refusal);
    const covered = new Set(physical.map((p) => p.process.slug));
    for (const b of base.list) if (covered.has(b.process.slug)) trace.push(...b.trace);

    const calcs = physical.map((ph) => {
      const { calc, trace: t } = withLabour(ctx, ph, base, norms, hours);
      trace.push(...t);
      items.push(calc.result);
      return calc;
    });
    for (const c of calcs) withMoney(c, spec.kind);

    const { H, T } = horizonOf(ctx, norms);
    const uncovered = base.list.filter((b) => !covered.has(b.process.slug));
    const purchase = spec.kind === "purchase";
    const capexLines = purchase ? purchaseCapexLines(ctx, calcs, norms) : raasCapexLines(calcs, norms);
    const opexLines = purchase ? purchaseOpexLines(calcs, uncovered) : raasOpexLines(calcs, uncovered);
    const capex = sumLines(capexLines);
    const opex = sumLines(opexLines);
    const opexAsis = base.totalRub;
    const effect = opexAsis - opex;

    const batteryEvents: PeriodicCost[] = [];
    const reinvestEvents: PeriodicCost[] = [];
    let batteryAvg = 0;
    if (purchase) {
      for (const c of calcs) {
        const b = batteryOf(c);
        batteryAvg += (c.n * b.costPerRobot) / b.years;
        batteryEvents.push({ everyYears: b.years, costRub: c.n * b.costPerRobot });
        reinvestEvents.push({ everyYears: lifeOf(c), costRub: equipmentRub(c) });
      }
    }
    const rows = cashflows({
      capexRub: capex,
      opexYearRub: opex,
      opexAsisRub: opexAsis,
      batteryAvgRub: batteryAvg,
      batteryEvents,
      reinvestEvents,
      tcoYears: T,
      discountRate: norms.discountRate,
    });
    const pb = payback(capex, effect);
    const { band } = interpretBand(pb, norms);
    const roi = roiTz(rows, H, capex);
    const net = roiNet(roi);
    const npvRub = npvOf(rows, H, norms.discountRate);
    const dpb = dpbOf(rows, H, norms.discountRate);
    const tco = tcoOf(rows);
    const tcoBase = tcoAsis(opexAsis, T);
    // Полная стоимость труда процессов охвата в сценарии: оставшийся персонал, диспетчеры
    // парка и базовый ФОТ процессов, которые сценарий не роботизирует.
    const labour =
      calcs.reduce((a, c) => a + c.result.remainingLabourRub + c.result.operatingStaffRub, 0) +
      uncovered.reduce((a, b) => a + b.baselineRub, 0);

    trace.push(...financeTrace({ capexLines, opexLines, capex, opex, opexAsis, effect, pb, roi, net, npvRub, dpb, tco, rows, H, T, rate: norms.discountRate }));

    const ok: ScenarioOk = {
      key: spec.key,
      name: spec.name,
      kind: spec.kind,
      status: "ok",
      items,
      capexRub: capex,
      capexLines,
      opexYearRub: opex,
      opexLines,
      processLabourYearRub: labour,
      effectYearRub: effect,
      paybackYears: pb,
      band,
      roiTzPct: roi,
      roiNetPct: net,
      npvRub,
      discountedPaybackYears: dpb,
      tcoRub: tco,
      tcoYears: T,
      tcoDeltaVsAsIsRub: tco - tcoBase,
      cashflows: rows,
      sensitivity: [],
      risks: [],
      trace,
      breakEvenSalaryRubMonth: null,
    };
    return allFinite(ok) ? ok : refused(spec, NON_FINITE, [], []);
  } catch (e) {
    if (e instanceof RefusalError) return refused(spec, e.refusal, items, trace);
    throw e;
  }
}

function financeTrace(f: {
  capexLines: { label: string; valueRub: number }[];
  opexLines: { label: string; valueRub: number }[];
  capex: number;
  opex: number;
  opexAsis: number;
  effect: number;
  pb: number | null;
  roi: number | null;
  net: number | null;
  npvRub: number;
  dpb: number | null;
  tco: number;
  rows: ReturnType<typeof cashflows>;
  H: number;
  T: number;
  rate: number;
}): TraceStep[] {
  const out: TraceStep[] = [
    {
      key: "capexTotal",
      label: FORMULAS.capexTotal.title,
      formula: FORMULAS.capexTotal.expression,
      substituted: `${f.capexLines.filter((l) => l.valueRub !== 0).map((l) => rub(l.valueRub)).join(" + ") || "0"} = ${rub(f.capex)}`,
      value: f.capex,
      unit: "₽",
      origin: "derived",
    },
    {
      key: "opexTotal",
      label: FORMULAS.opexTotal.title,
      formula: FORMULAS.opexTotal.expression,
      substituted: `${f.opexLines.filter((l) => l.valueRub !== 0).map((l) => rub(l.valueRub)).join(" + ") || "0"} = ${rub(f.opex)}`,
      value: f.opex,
      unit: "₽/год",
      origin: "derived",
    },
    {
      key: "effect",
      label: FORMULAS.effect.title,
      formula: FORMULAS.effect.expression,
      substituted: `${rub(f.opexAsis)} − ${rub(f.opex)} = ${rub(f.effect)}`,
      value: f.effect,
      unit: "₽/год",
      origin: "derived",
    },
  ];
  if (f.pb !== null) {
    out.push({
      key: "payback",
      label: FORMULAS.payback.title,
      formula: FORMULAS.payback.expression,
      substituted: `${rub(f.capex)} / ${rub(f.effect)} = ${fx(f.pb, 2)} г.`,
      value: f.pb,
      unit: "лет",
      origin: "derived",
    });
  }
  const sumH = f.rows.slice(1, f.H + 1).reduce((a, r) => a + r.cashflowRub, 0);
  if (f.roi !== null) {
    out.push({
      key: "roiTz",
      label: FORMULAS.roiTz.title,
      formula: FORMULAS.roiTz.expression,
      substituted: `${rub(sumH)} / ${rub(f.capex)} × 100 % = ${fx(f.roi, 1)} %`,
      value: f.roi,
      unit: "%",
      origin: "derived",
    });
  }
  if (f.net !== null) {
    out.push({
      key: "roiNet",
      label: FORMULAS.roiNet.title,
      formula: FORMULAS.roiNet.expression,
      substituted: `${fx(f.roi ?? 0, 1)} − 100 = ${fx(f.net, 1)} %`,
      value: f.net,
      unit: "%",
      origin: "derived",
    });
  }
  for (const r of f.rows) {
    if (r.batteryRub > 0) {
      out.push({
        key: "batteryYear",
        label: `Замена АКБ, год ${r.year}`,
        formula: FORMULAS.batteryYear.expression,
        substituted: `год ${r.year}: ${rub(r.batteryRub)}`,
        value: r.batteryRub,
        unit: "₽",
        origin: "derived",
      });
    }
    if (r.reinvestRub > 0) {
      out.push({
        key: "reinvest",
        label: `${FORMULAS.reinvest.title}, год ${r.year}`,
        formula: FORMULAS.reinvest.expression,
        substituted: `год ${r.year}: ${rub(r.reinvestRub)}`,
        value: r.reinvestRub,
        unit: "₽",
        origin: "derived",
      });
    }
  }
  out.push({
    key: "npv",
    label: FORMULAS.npv.title,
    formula: FORMULAS.npv.expression,
    substituted: `${f.rows
      .slice(0, f.H + 1)
      .map((r) => `${rub(r.cashflowRub)} / ${fx(1 + f.rate, 2)}^${r.year}`)
      .join(" + ")} = ${rub(f.npvRub)}`,
    value: f.npvRub,
    unit: "₽",
    origin: "derived",
  });
  if (f.dpb !== null) {
    out.push({
      key: "discountedPayback",
      label: FORMULAS.discountedPayback.title,
      formula: FORMULAS.discountedPayback.expression,
      substituted: `${fx(f.dpb, 2)} г. при ставке ${share(f.rate)} на горизонте ${yearsNom(f.H)}`,
      value: f.dpb,
      unit: "лет",
      origin: "derived",
    });
  }
  out.push({
    key: "tco",
    label: FORMULAS.tco.title,
    formula: FORMULAS.tco.expression,
    substituted: `${rub(f.capex)} + Σ за ${yearsNom(f.T)} (OPEXt + докупкаt) = ${rub(f.tco)}`,
    value: f.tco,
    unit: "₽",
    origin: "derived",
  });
  return out;
}

/**
 * Расчёт сценариев без чувствительности, рисков и пороговой зарплаты. Используется ядром
 * перебора (чувствительность, порог по зарплате, смена вывода по горизонту) и сборкой модели
 * проекта для быстрых временных сценариев подбора.
 */
export function computeScenariosCore(ctx: ScenarioContext, specs: readonly ScenarioSpec[]): ScenarioResult[] {
  const base = baseOf(ctx, specs);
  return specs.map((spec) => (spec.kind === "asis" ? asisResult(ctx, spec, base) : robotResult(ctx, spec, base)));
}
