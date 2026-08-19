import { capacityPerYear, demandPerYear } from "@/lib/economics/normalize";
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
    const peak = params.peakConcurrent ?? Math.ceil(params.opsPerDay / a.turnoverPerDay);
    const deployed = quantity * cap.capacityPerUnit;
    return deployed > 0 ? clamp((peak / deployed) * 100, 0, 100) : 0;
  }
  const deployed = quantity * capacityPerYear(cap, a);
  const demand = demandPerYear(params, a);
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
