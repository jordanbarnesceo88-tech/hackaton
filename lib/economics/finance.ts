// Pure time-value-of-money helpers for the economics engine (A3). Framework-free + unit
// tested. Cash-flow arrays are indexed by year, with index 0 = now (the initial outlay).

/** Net present value of a cash-flow series. Index 0 is undiscounted (t=0). */
export function npv(rate: number, cashflows: number[]): number {
  return cashflows.reduce((acc, cf, t) => acc + cf / Math.pow(1 + rate, t), 0);
}

/**
 * Fractional year at which cumulative *discounted* cash flow first turns non-negative.
 * `cashflows[0]` is the initial outlay at t=0 (typically negative). Returns `null` when the
 * series never recovers within its length — i.e. no payback within the modelled horizon.
 */
export function discountedPaybackYears(rate: number, cashflows: number[]): number | null {
  let cumulative = 0;
  for (const [t, cashflow] of cashflows.entries()) {
    const discounted = cashflow / Math.pow(1 + rate, t);
    const before = cumulative;
    cumulative += discounted;
    if (cumulative >= 0) {
      if (t === 0) return 0; // no upfront cost
      if (discounted <= 0) return t; // crossed at a year boundary, not mid-year
      const frac = -before / discounted; // portion of year t needed to reach break-even
      return t - 1 + Math.min(1, Math.max(0, frac));
    }
  }
  return null;
}

import type { AssumptionValues } from "./types";

/**
 * A3 finance projection over the ROI horizon. Re-buys the fleet when assets wear out with
 * productive years left (`t % lifeYears === 0 && t < horizon`); life floored to whole years.
 * Does NOT gate on savings sign — a negative annualSavings yields a real negative NPV (used by
 * the sensitivity tornado).
 */
export function projectFinance(
  annualSavingsUsd: number,
  capexUsd: number,
  a: AssumptionValues
): { npvUsd: number; simplePaybackYears: number; simpleRoiPct: number; discountedPaybackYears: number | null } {
  const horizon = Math.floor(a.roiHorizonYears);
  const lifeYears = Math.floor(a.assetLifeYears);
  const cashflows: number[] = [-capexUsd];
  let reCapexTotal = 0;
  for (let t = 1; t <= horizon; t++) {
    const reCapex = t % lifeYears === 0 && t < horizon ? capexUsd : 0;
    reCapexTotal += reCapex;
    cashflows.push(annualSavingsUsd - reCapex);
  }
  const investmentUsd = capexUsd + reCapexTotal;
  return {
    npvUsd: npv(a.discountRate, cashflows),
    simplePaybackYears: capexUsd / annualSavingsUsd,
    simpleRoiPct: ((annualSavingsUsd * horizon - investmentUsd) / investmentUsd) * 100,
    discountedPaybackYears: discountedPaybackYears(a.discountRate, cashflows),
  };
}
