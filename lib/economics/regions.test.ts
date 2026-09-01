import { describe, it, expect } from "vitest";
import { REGION_PRESETS } from "./regions";

describe("REGION_PRESETS", () => {
  it("has ≥4 presets with unique ids", () => {
    expect(REGION_PRESETS.length).toBeGreaterThanOrEqual(4);
    const ids = REGION_PRESETS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(REGION_PRESETS.map((r) => [r.name, r] as const))("%s is well-formed", (_n, r) => {
    expect(r.id.trim().length).toBeGreaterThan(0);
    expect(r.name.trim().length).toBeGreaterThan(0);
    expect(r.laborCostPerHourUsd).toBeGreaterThan(0);
    expect(r.energyCostFactor).toBeGreaterThanOrEqual(0.5);
    expect(r.energyCostFactor).toBeLessThanOrEqual(1.5);
  });

  it("includes a Москва reference at energy factor 1.0", () => {
    const msk = REGION_PRESETS.find((r) => r.id === "moscow");
    expect(msk).toBeDefined();
    expect(msk!.energyCostFactor).toBeCloseTo(1.0, 6);
  });
});
