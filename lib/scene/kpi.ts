import { capacityPerYear, demandPerYear, resolvePeakConcurrent } from "@/lib/economics/normalize";
import type {
  SolutionCapacity,
  FacilityParams,
  AssumptionValues,
} from "@/lib/economics/types";

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Deployed throughput in the solution's native unit (quantity × per-unit capacity). */
export function deployedCapacity(quantity: number, capacityPerUnit: number): number {
  return quantity * capacityPerUnit;
}

/** How much of deployed capacity the facility's demand uses, as a percent (0..100). */
export function utilizationPct(
  cap: SolutionCapacity,
  params: FacilityParams,
  a: AssumptionValues,
  quantity: number
): number {
  if (cap.capacityBasis === "CONCURRENT_STOCK") {
    // resolvePeakConcurrent, а не своя копия вывода: этот хелпер и заводился затем, чтобы
    // интерфейс и движок отвечали на вопрос «против чего размерен парк» одинаково. Копия
    // здесь молча расходилась бы с ним при любой правке.
    const peak = resolvePeakConcurrent(params, a);
    if (peak === null) return 0;
    const deployed = quantity * cap.capacityPerUnit;
    return deployed > 0 ? clamp((peak / deployed) * 100, 0, 100) : 0;
  }
  const deployed = quantity * capacityPerYear(cap, a);
  // Спрос обязан браться по потоку решения. Без этого загрузка решения потока площади
  // считалась как «операции в год ÷ квадратные метры в год» — число, у которого нет смысла,
  // и на схеме объекта оно расходилось с панелью результатов.
  const demand = demandPerYear(params, a, cap.workloadStream);
  return deployed > 0 ? clamp((demand / deployed) * 100, 0, 100) : 0;
}

/** USD accrued so far in the current animation loop (fills 0 -> annualSavings over loopMs). */
export function roiAccrued(
  elapsedMs: number,
  loopMs: number,
  annualSavingsUsd: number
): number {
  if (!(loopMs > 0) || !Number.isFinite(annualSavingsUsd)) return 0;
  const frac = (elapsedMs % loopMs) / loopMs;
  return annualSavingsUsd * frac;
}
