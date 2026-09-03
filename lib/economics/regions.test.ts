import { describe, it, expect } from "vitest";
import { REGION_PRESETS, regionLaborCostUsd, WORK_HOURS_PER_MONTH } from "./regions";

describe("REGION_PRESETS", () => {
  it("has ≥4 presets with unique ids", () => {
    expect(REGION_PRESETS.length).toBeGreaterThanOrEqual(4);
    const ids = REGION_PRESETS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(REGION_PRESETS.map((r) => [r.name, r] as const))("%s is well-formed", (_n, r) => {
    expect(r.id.trim().length).toBeGreaterThan(0);
    expect(r.name.trim().length).toBeGreaterThan(0);
    expect(r.laborCostRubPerHour).toBeGreaterThan(0);
    expect(r.monthlyWageRub).toBeGreaterThan(0);
    expect(r.energyCostFactor).toBeGreaterThanOrEqual(0.5);
    expect(r.energyCostFactor).toBeLessThanOrEqual(1.5);
  });

  it("includes a Москва reference at energy factor 1.0", () => {
    const msk = REGION_PRESETS.find((r) => r.id === "moscow");
    expect(msk).toBeDefined();
    expect(msk!.energyCostFactor).toBeCloseTo(1.0, 6);
  });
});

describe("regionLaborCostUsd", () => {
  it("derives the hourly rate from the cited monthly wage", () => {
    for (const r of REGION_PRESETS) {
      expect(r.laborCostRubPerHour).toBe(Math.round(r.monthlyWageRub / WORK_HOURS_PER_MONTH));
    }
  });

  it("rounds to the cent, because the result lands in a field the user reads", () => {
    const msk = REGION_PRESETS.find((r) => r.id === "moscow")!;
    // 1077 / 90 is 11.9666… — a wage, not a float dump.
    expect(regionLaborCostUsd(msk, 90)).toBe(11.97);
    expect(regionLaborCostUsd(msk, 110)).toBe(9.79);
  });

  it("converts at the live rate, so an edited usdToRub no longer breaks the citation", () => {
    // The bug: the USD figure was baked in at 90 ₽/$, so at 110 the «Москва» preset implied a
    // wage of 1 320 ₽/h against a cited 1 077 — a 23% overstatement of a sourced number.
    // Within half a ruble at every rate, which is the cent-rounding and nothing more.
    const msk = REGION_PRESETS.find((r) => r.id === "moscow")!;
    for (const rate of [80, 90, 110, 150]) {
      expect(Math.abs(regionLaborCostUsd(msk, rate) * rate - msk.laborCostRubPerHour)).toBeLessThan(1);
    }
  });

  it("falls back to the documented 90 for a nonsensical rate rather than dividing by zero", () => {
    const msk = REGION_PRESETS.find((r) => r.id === "moscow")!;
    expect(regionLaborCostUsd(msk, 0)).toBe(regionLaborCostUsd(msk, 90));
    expect(regionLaborCostUsd(msk, NaN)).toBe(regionLaborCostUsd(msk, 90));
  });
});
