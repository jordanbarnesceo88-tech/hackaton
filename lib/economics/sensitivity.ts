import type {
  SolutionCapacity,
  FacilityParams,
  AssumptionValues,
  WorkloadStream,
} from "./types";
import { baseEconomics } from "./calculate";
import { ASSUMPTION_BOUNDS, DEFAULT_ASSUMPTIONS } from "./assumptions";
import { projectFinance } from "./finance";

/** NPV for a scenario, allowing negative savings (real negative NPV). null only if invalid. */
export function npvForScenario(
  cap: SolutionCapacity,
  params: FacilityParams,
  a: AssumptionValues
): number | null {
  const base = baseEconomics(cap, params, a);
  if (base === null) return null;
  return projectFinance(base.annualSavingsUsd, base.capexUsd, a).npvUsd;
}

export type SensitivityBar = {
  key: keyof AssumptionValues;
  kind: PerturbationKind;
  /**
   * The perturbation actually applied to this bar: the fraction for `percent` bars, `null` for
   * the whole-year ones. Carried on the bar rather than left for the chart to restate, because
   * the chart had «±25%» typed into its caption and its per-bar tooltip while `deltaPct` was a
   * parameter with a default — a caller passing 0.1 would have got bars labelled ±25%.
   */
  deltaPct: number | null;
  /**
   * Значения допущения, которые ДЕЙСТВИТЕЛЬНО подставлялись на плечах.
   *
   * Заведены потому, что `deltaPct` описывает запрошенное возмущение, а не применённое, и
   * подпись «±25 %» врала в обе стороны: нижнее плечо зажималось границей допущения, верхнее
   * не зажималось вовсе. У `cleaningsPerDay` со значением 1 при минимуме 1 нижнее плечо
   * совпадало с базой — столбец односторонний, а подписан симметрично.
   */
  baseValue: number;
  lowValue: number;
  highValue: number;
  /** Плечо упёрлось в границу диапазона допущения и короче запрошенного. */
  clampedLow: boolean;
  clampedHigh: boolean;
  baseNpv: number;
  lowNpv: number;
  highNpv: number;
  swing: number;
};

// Economically meaningful levers; excludes display-only usdToRub and basis/timing constants.
const PERTURBED_KEYS: (keyof AssumptionValues)[] = [
  "laborCostPerHourUsd",
  "laborReplacementPct",
  "residualSupervisionPct",
  "installPctOfCapex",
  "discountRate",
  "assetLifeYears",
  "roiHorizonYears",
];

// Делитель предела замещения зависит от потока — и рычаг обязан зависеть от него же.
// Иначе на решении потока площади диаграмма показывала «Операций на сотрудника в год» с
// размахом 0 ₽ (движок его для этого потока не читает), а настоящий делитель —
// «Площадь на уборщика в год» — в диаграмме отсутствовал. Торнадо заявляет, что ранжирует
// рычаги, двигающие NPV; для этого потока он ранжировал не тот набор.
const STREAM_KEYS: Record<WorkloadStream, (keyof AssumptionValues)[]> = {
  // Т-4: `opsPerWorkerPerYear` и `areaPerCleanerPerYear` отсюда УБРАНЫ. После подпроекта A
  // движок не читает ни то, ни другое: замещение считается от занятости, названной владельцем,
  // а норматив живёт на категории. Столбец с размахом 0 ₽ у рычага, которого в модели нет, —
  // это не «слабый рычаг», а обещание, что мы его учли.
  //
  // Погасить их как `inert` (что предлагал A-7) здесь было бы неверно вдвойне: сначала надо
  // отличить рычаг, который действительно ничего не двигает, от рычага, которого просто нет.
  OPERATION_FLOW: [],
  FLOOR_AREA: ["cleaningsPerDay"],
};

/**
 * Assumptions `projectFinance` rounds to whole years before using (Ч-3; it floored until then). A percentage perturbation on
 * these lands somewhere other than what it claims: at the defaults, ±25% on roiHorizonYears
 * gives 3.75 and 6.25, which floor to 3 and 6 — an actual −40% / +20%. That bar was then ranked
 * against seven others measured at a true ±25%, i.e. on a different ruler, and assetLifeYears
 * drew an empty bar because 5.25→5 and 8.75→8 both leave the 5-year horizon re-CAPEX-free.
 * Perturbing them by one whole year instead measures what the model actually consumes.
 */
const WHOLE_YEAR_KEYS = new Set<keyof AssumptionValues>(["roiHorizonYears", "assetLifeYears"]);

/** How a bar was perturbed, so the chart can label it honestly. */
export type PerturbationKind = "percent" | "whole-year";

/**
 * One-at-a-time tornado on NPV, sorted by swing desc. [] if base is invalid.
 * Continuous assumptions move by ±deltaPct; the year-valued ones move by ±1 whole year
 * (see WHOLE_YEAR_KEYS).
 */
export function sensitivity(
  cap: SolutionCapacity,
  params: FacilityParams,
  a: AssumptionValues,
  deltaPct = 0.25
): SensitivityBar[] {
  const baseNpv = npvForScenario(cap, params, a);
  if (baseNpv === null) return [];

  const bars: SensitivityBar[] = [];
  for (const key of [...PERTURBED_KEYS, ...STREAM_KEYS[cap.workloadStream]]) {
    const wholeYear = WHOLE_YEAR_KEYS.has(key);
    const bounds = ASSUMPTION_BOUNDS[key];
    const base = a[key];

    // Т-2: возмущение НУЛЯ мультипликативно равно нулю, и рычаг выглядит мёртвым, не будучи
    // им. Измерено: при `discountRate = 0` размах столбца 0 ₽, тогда как настоящий диапазон
    // NPV — 437 500 против 299 373 при ставке 0,12. То же у `installPctOfCapex = 0` и
    // `residualSupervisionPct = 0`. Опорой берётся штатное значение допущения: вопрос «как
    // выглядит сдвиг на четверть» осмыслен и тогда, когда сейчас стоит ноль.
    const scale = base !== 0 ? base : DEFAULT_ASSUMPTIONS[key] || bounds.max - bounds.min;
    const delta = wholeYear ? 1 : Math.abs(scale) * deltaPct;

    // Т-1: зажимаются ОБА плеча. Нижнее зажималось и раньше — иначе при горизонте ROI в один
    // год «минус год» давало ноль, baseEconomics возвращал null, и столбец МОЛЧА исчезал из
    // диаграммы. Верхнее не зажималось вовсе: при `laborReplacementPct = 1` (её максимум)
    // плечо уходило в 1,25 — замещение 125 % труда, недостижимое в интерфейсе и бессмысленное
    // в модели, — и размах доминирующего рычага получался ровно вдвое больше настоящего.
    const low = Math.max(base - delta, bounds.min);
    const high = Math.min(base + delta, bounds.max);
    const lowNpv = npvForScenario(cap, params, { ...a, [key]: low });
    const highNpv = npvForScenario(cap, params, { ...a, [key]: high });
    if (lowNpv === null || highNpv === null) continue;
    bars.push({
      key,
      kind: wholeYear ? "whole-year" : "percent",
      deltaPct: wholeYear ? null : deltaPct,
      baseValue: base,
      lowValue: low,
      highValue: high,
      clampedLow: low > base - delta,
      clampedHigh: high < base + delta,
      baseNpv,
      lowNpv,
      highNpv,
      swing: Math.abs(highNpv - lowNpv),
    });
  }
  return bars.sort((x, y) => y.swing - x.swing);
}
