import { describe, it, expect } from "vitest";
import { resultsDiverged } from "./diverged";
import { computeEconomics } from "@/lib/economics/calculate";
import { DEFAULT_ASSUMPTIONS } from "@/lib/economics/assumptions";
import type { SolutionCapacity, FacilityParams, EconomicsResult } from "@/lib/economics/types";

const cap: SolutionCapacity = {
  capacityPerUnit: 400, capacityBasis: "PER_DAY_FLOW", priceUsd: 50000,
  maintenanceUsdYear: 6000, energyUsdYear: 1000, licensingUsdYear: 2000,
};
const params: FacilityParams = { areaM2: 1000, opsPerDay: 400, staffCount: 10 };
const r = computeEconomics(cap, params, DEFAULT_ASSUMPTIONS);

describe("resultsDiverged", () => {
  it("is false when stored equals the recompute", () => {
    expect(resultsDiverged({ ...r }, r)).toBe(false);
  });
  it("is true when a numeric field drifts beyond tolerance", () => {
    if (!r.economical) throw new Error("expected economical");
    expect(resultsDiverged({ ...r, npvUsd: r.npvUsd * 1.5 }, r)).toBe(true);
  });
  it("is true when the economical discriminant differs", () => {
    expect(resultsDiverged({ economical: false, reason: "no_savings" }, r)).toBe(true);
  });
  it("is true for a null / non-object stored blob", () => {
    expect(resultsDiverged(null, r)).toBe(true);
  });
  it("tolerates tiny float noise", () => {
    if (!r.economical) throw new Error("expected economical");
    expect(resultsDiverged({ ...r, npvUsd: r.npvUsd + 1e-9 }, r)).toBe(false);
  });
});

describe("null <-> number transitions on discountedPaybackYears", () => {
  const common = {
    quantity: 1, displacedFte: 8, capexUsd: 57500, opexAnnualUsd: 9000,
    baselineAnnualUsd: 240000, annualSavingsUsd: 99000,
    simplePaybackYears: 0.58, simpleRoiPct: 761, npvUsd: 299000,
  };

  it("flags a saved payback that no longer lands inside the horizon (number -> null)", () => {
    // The case the banner exists for: the analysis was saved when the solution paid back,
    // and the current model says it never does. Every other field is unchanged, so the
    // null is the only signal.
    const stored = { economical: true, ...common, discountedPaybackYears: 0.64 };
    const recomputed: EconomicsResult = {
      economical: true, ...common, discountedPaybackYears: null,
    };
    expect(resultsDiverged(stored, recomputed)).toBe(true);
  });

  it("flags the mirror case (null -> number)", () => {
    const stored = { economical: true, ...common, discountedPaybackYears: null };
    const recomputed: EconomicsResult = {
      economical: true, ...common, discountedPaybackYears: 0.64,
    };
    expect(resultsDiverged(stored, recomputed)).toBe(true);
  });

  it("does NOT flag two runs that both never pay back (null -> null)", () => {
    const stored = { economical: true, ...common, discountedPaybackYears: null };
    const recomputed: EconomicsResult = {
      economical: true, ...common, discountedPaybackYears: null,
    };
    expect(resultsDiverged(stored, recomputed)).toBe(false);
  });

  it("flags a stored blob missing the key entirely", () => {
    const { ...withoutKey } = { economical: true, ...common };
    const recomputed: EconomicsResult = {
      economical: true, ...common, discountedPaybackYears: 0.64,
    };
    expect(resultsDiverged(withoutKey, recomputed)).toBe(true);
  });
});
