import type {
  SolutionCapacity,
  FacilityParams,
  AssumptionValues,
  EconomicsResult,
} from "./types";
import { computeEconomics } from "./calculate";

export type SiblingSolution = SolutionCapacity & {
  id: string;
  name: string;
  vendor: string;
  capacityUnit: string;
  priceEstimated: boolean;
  priceLowUsd: number | null;
  priceHighUsd: number | null;
  priceBasis: string | null;
  sourceUrl: string | null;
};

export type RankedSolution = {
  id: string;
  name: string;
  vendor: string;
  result: EconomicsResult;
};

// Higher = ranked first. Economical (has NPV) beats no_savings beats invalid_inputs.
function tier(r: EconomicsResult): number {
  if (r.economical) return 2;
  return r.reason === "no_savings" ? 1 : 0;
}

/** Rank a category's solutions for the given facility: economical by NPV desc, others after. */
export function rankSolutions(
  siblings: SiblingSolution[],
  params: FacilityParams,
  a: AssumptionValues
): RankedSolution[] {
  const ranked: RankedSolution[] = siblings.map((s) => ({
    id: s.id,
    name: s.name,
    vendor: s.vendor,
    result: computeEconomics(
      {
        capacityPerUnit: s.capacityPerUnit,
        capacityBasis: s.capacityBasis,
        priceUsd: s.priceUsd,
        maintenanceUsdYear: s.maintenanceUsdYear,
        energyUsdYear: s.energyUsdYear,
        licensingUsdYear: s.licensingUsdYear,
      },
      params,
      a
    ),
  }));

  return ranked.sort((x, y) => {
    const dt = tier(y.result) - tier(x.result);
    if (dt !== 0) return dt;
    const xn = x.result.economical ? x.result.npvUsd : -Infinity;
    const yn = y.result.economical ? y.result.npvUsd : -Infinity;
    if (yn !== xn) return yn - xn;
    return x.name.localeCompare(y.name);
  });
}
