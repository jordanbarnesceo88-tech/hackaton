import { describe, it, expect } from "vitest";
import { resultsDiverged } from "./diverged";
import { computeEconomics } from "@/lib/economics/calculate";
import { DEFAULT_ASSUMPTIONS } from "@/lib/economics/assumptions";
import type { SolutionCapacity, FacilityParams } from "@/lib/economics/types";

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
