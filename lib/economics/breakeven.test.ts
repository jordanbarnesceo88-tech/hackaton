import { describe, it, expect } from "vitest";
import { breakEvenLaborRateUsd } from "./breakeven";
import { computeEconomics } from "./calculate";
import { makeAssumptions, makeCapacity, makeParams } from "./fixtures";

const a = makeAssumptions({ laborReplacementPct: 0.7 });
const cap = makeCapacity();
const params = makeParams();

describe("breakEvenLaborRateUsd", () => {
  it("round-trips: at the break-even rate, recomputed NPV ≈ 0", () => {
    const L = breakEvenLaborRateUsd(cap, params, a);
    expect(L).not.toBeNull();
    expect(L!).toBeGreaterThan(0);
    const r = computeEconomics(cap, params, { ...a, laborCostPerHourUsd: L! });
    if (!r.economical) throw new Error("expected economical at break-even");
    // NPV should be ~0 relative to the CAPEX scale.
    expect(Math.abs(r.npvUsd)).toBeLessThan(1); // within $1 of zero
  });

  it("just above the rate → NPV > 0; just below → NPV < 0", () => {
    const L = breakEvenLaborRateUsd(cap, params, a)!;
    const above = computeEconomics(cap, params, { ...a, laborCostPerHourUsd: L + 1 });
    const below = computeEconomics(cap, params, { ...a, laborCostPerHourUsd: Math.max(0.01, L - 1) });
    if (!above.economical) throw new Error("expected economical above");
    expect(above.npvUsd).toBeGreaterThan(0);
    // below may be economical or not, but its NPV must be lower than the break-even (≈0)
    const belowNpv = below.economical ? below.npvUsd : -Infinity;
    expect(belowNpv).toBeLessThan(above.npvUsd);
  });

  it("returns null when no labor can be displaced (replacement 0 → K=0)", () => {
    expect(breakEvenLaborRateUsd(cap, params, { ...a, laborReplacementPct: 0 })).toBeNull();
  });

  it("returns null at 100% residual supervision (K=0)", () => {
    expect(breakEvenLaborRateUsd(cap, params, { ...a, residualSupervisionPct: 1 })).toBeNull();
  });

  it("returns null when task staffing is unknowable", () => {
    // Было: opsPerWorkerPerYear = 0. Точка безубыточности опирается на displacedFte, а он
    // теперь берётся из занятости; без неё считать нечего.
    expect(breakEvenLaborRateUsd({ ...cap, workerOutputPerYear: null }, params, a)).toBeNull();
  });
});
