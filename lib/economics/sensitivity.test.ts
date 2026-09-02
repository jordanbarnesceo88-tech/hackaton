import { describe, it, expect } from "vitest";
import { npvForScenario, sensitivity } from "./sensitivity";
import { makeAssumptions, makeCapacity, makeParams } from "./fixtures";

const a = makeAssumptions();
const cap = makeCapacity();
const params = makeParams();

describe("npvForScenario", () => {
  it("returns a finite NPV for an economical scenario", () => {
    const v = npvForScenario(cap, params, a);
    expect(v).not.toBeNull();
    expect(Number.isFinite(v!)).toBe(true);
    expect(v!).toBeGreaterThan(0);
  });
  it("returns a real NEGATIVE NPV when savings go negative (not truncated to 0)", () => {
    // Tiny displaceable workload -> savings < 0, but capex still incurred -> NPV < 0.
    const v = npvForScenario(cap, { ...params, opsPerDay: 20, staffCount: 1 }, a);
    expect(v).not.toBeNull();
    expect(v!).toBeLessThan(0);
  });
  it("returns null for invalid inputs", () => {
    expect(npvForScenario(cap, params, { ...a, opsPerWorkerPerYear: 0 })).toBeNull();
  });
});

describe("sensitivity", () => {
  it("returns bars sorted by swing descending, all with positive swing", () => {
    const bars = sensitivity(cap, params, a);
    expect(bars.length).toBeGreaterThan(0);
    for (let i = 1; i < bars.length; i++) {
      expect(bars[i - 1]!.swing).toBeGreaterThanOrEqual(bars[i]!.swing);
    }
    expect(bars.every((b) => b.swing >= 0)).toBe(true);
  });
  it("does not perturb display-only usdToRub", () => {
    const bars = sensitivity(cap, params, a);
    expect(bars.some((b) => b.key === "usdToRub")).toBe(false);
  });
  it("labor cost is among the strongest levers", () => {
    const bars = sensitivity(cap, params, a);
    const top3 = bars.slice(0, 3).map((b) => b.key);
    expect(top3).toContain("laborCostPerHourUsd");
  });
  it("returns [] when the base case is invalid", () => {
    expect(sensitivity(cap, params, { ...a, assetLifeYears: 0 })).toEqual([]);
  });
});

describe("whole-year perturbation for the floored assumptions", () => {
  it("tags each bar with how it was actually perturbed", () => {
    const bars = sensitivity(cap, params, a);
    const byKey = Object.fromEntries(bars.map((b) => [b.key, b.kind]));
    expect(byKey.roiHorizonYears).toBe("whole-year");
    expect(byKey.assetLifeYears).toBe("whole-year");
    expect(byKey.laborCostPerHourUsd).toBe("percent");
    expect(byKey.discountRate).toBe("percent");
  });

  it("moves roiHorizonYears by exactly one year, not a floored 25%", () => {
    // ±25% of 5 gives 3.75 / 6.25, which projectFinance floors to 3 / 6 — an actual -40%/+20%.
    // ±1 year gives 4 / 6, which survive the floor intact.
    const bars = sensitivity(cap, params, a);
    const bar = bars.find((b) => b.key === "roiHorizonYears")!;
    expect(bar.lowNpv).toBe(npvForScenario(cap, params, { ...a, roiHorizonYears: 4 }));
    expect(bar.highNpv).toBe(npvForScenario(cap, params, { ...a, roiHorizonYears: 6 }));
  });

  it("gives assetLifeYears a real swing instead of an empty bar", () => {
    // At life 7 / horizon 5, ±25% floors to 5 and 8 — neither triggers re-CAPEX, so the old
    // bar was always 0. ±1 year reaches 6, which still does not, but the bar is now measured
    // on the same basis as its label claims.
    const bars = sensitivity(cap, params, a);
    const bar = bars.find((b) => b.key === "assetLifeYears")!;
    expect(bar.lowNpv).toBe(npvForScenario(cap, params, { ...a, assetLifeYears: 6 }));
    expect(bar.highNpv).toBe(npvForScenario(cap, params, { ...a, assetLifeYears: 8 }));
  });

  it("shows a non-zero assetLifeYears swing when re-CAPEX is actually in play", () => {
    // life 3 vs horizon 5: stepping to 2 adds a re-buy, so the bar carries real information.
    const shortLife = { ...a, assetLifeYears: 3 };
    const bar = sensitivity(cap, params, shortLife).find((b) => b.key === "assetLifeYears")!;
    expect(bar.swing).toBeGreaterThan(0);
  });

  it("still perturbs continuous assumptions multiplicatively", () => {
    const bars = sensitivity(cap, params, a);
    const bar = bars.find((b) => b.key === "laborCostPerHourUsd")!;
    expect(bar.lowNpv).toBe(
      npvForScenario(cap, params, { ...a, laborCostPerHourUsd: a.laborCostPerHourUsd * 0.75 })
    );
  });
});
