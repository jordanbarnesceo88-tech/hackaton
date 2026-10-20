import { describe, expect, it } from "vitest";
import { cleaningContext, cleaningSpecs, TEST_CLEANING_PROFILE } from "./cleaning-fixtures";
import { computeScenarios } from "./scenario";
import { FIXTURE_H1500 } from "./fixtures";

describe("cleaning sensitivity uses the same inputs as the actual cleaning calculation", () => {
  it("varies the active-hour profile instead of adding a conflicting generic throughput override", () => {
    const specs = cleaningSpecs(), before = structuredClone(specs);
    const result = computeScenarios(cleaningContext(), specs).find(row => row.key === "c1");
    if (result?.status !== "ok") throw new Error(JSON.stringify(result));
    const row = result.sensitivity.find(row => row.lever === "throughput")!;
    expect(row.base).toBe(550);
    expect(row.unit).toBe("м²/активный ч");
    expect(row.npvLow).not.toBeNull();
    expect(row.npvHigh).not.toBeNull();
    expect(row.swing).toBeGreaterThan(0);
    expect(result.sensitivity.some(row => row.lever === "utilization")).toBe(false);
    expect(specs).toEqual(before);
  });

  it("varies the profile's labour share rather than the unused transport norm", () => {
    const specs = cleaningSpecs({ ...TEST_CLEANING_PROFILE, automatableLabourShare: .65 });
    const ctx = cleaningContext(); ctx.norms.laborShareAutomatable = .2;
    const result = computeScenarios(ctx, specs).find(row => row.key === "c1");
    if (result?.status !== "ok") throw new Error(JSON.stringify(result));
    const row = result.sensitivity.find(row => row.lever === "laborShare")!;
    expect(row.base).toBe(.65);
    expect(row.npvLow).not.toBeNull();
    expect(row.npvHigh).not.toBeNull();
    expect(row.swing).toBeGreaterThan(0);
    expect(result.sensitivity.find(row => row.lever === "volume")?.label).toBe("Площадь уборки");
  });

  it.each([false, true])("respects every profile's throughput limit regardless of item order (%s)", cleaningFirst => {
    const specs = cleaningSpecs({ ...TEST_CLEANING_PROFILE, throughputM2PerH: 1_000_000 });
    const transport = { process: "pallet-transport", productSlug: FIXTURE_H1500.slug };
    if (cleaningFirst) specs[1]!.items.push(transport); else specs[1]!.items.unshift(transport);
    const result = computeScenarios(cleaningContext(), specs)[1];
    if (result?.status !== "ok") throw new Error(JSON.stringify(result));
    const row = result.sensitivity.find(row => row.lever === "throughput")!;
    expect(row.high).toBe(row.base);
    expect(row.clampedHigh).toBe(true);
    expect(row.npvHigh).toBeCloseTo(result.npvRub!, 6);
    expect(row.npvLow).not.toBeNull();
    expect(row.swing).toBeGreaterThan(0);
  });

  it("keeps the quoted first month fixed while varying the recurring RaaS rate", () => {
    const specs = cleaningSpecs(); specs[1]!.kind = "raas";
    const item = specs[1]!.items[0]!, included = { mode: "included" } as const;
    item.raasRubMonthOverride = 185_000;
    item.raasPackage = { startup: included, platform: included, service: included,
      consumables: included, repair: included, battery: included, firstMonthRub: 185_000, reason: "Одинаковый месячный тариф" };
    const result = computeScenarios(cleaningContext(), specs)[1];
    if (result?.status !== "ok") throw new Error(JSON.stringify(result));
    const row = result.sensitivity.find(row => row.lever === "raasRate")!;
    expect(row.high).toBe(185_000);
    expect(row.clampedHigh).toBe(true);
    expect(row.npvHigh).toBeCloseTo(result.npvRub!, 6);
    expect(row.npvLow).not.toBeNull();
    expect(row.swing).toBeGreaterThan(0);
    expect(item.raasPackage.firstMonthRub).toBe(185_000);
  });

  it("preserves a refused boundary as unknown rather than substituting baseline TCO or zero swing", () => {
    const specs = cleaningSpecs({ ...TEST_CLEANING_PROFILE, dailyCareMin: 120, automatableLabourShare: .4 });
    const ctx = cleaningContext(); ctx.params.cleanersCount = 3; ctx.params.cleaningAreaM2 = 4800;
    const result = computeScenarios(ctx, specs)[1];
    if (result?.status !== "ok") throw new Error(JSON.stringify(result));
    const row = result.sensitivity.find(row => row.lever === "throughput")!;
    expect(row.npvLow).toBeNull();
    expect(row.tcoLow).toBeNull();
    expect(row.swing).toBeNull();
  });

  it("keeps multiplied mixed-profile bounds inside the exact parser limit", () => {
    const specs = cleaningSpecs({ ...TEST_CLEANING_PROFILE, throughputM2PerH: 840_275 });
    specs[1]!.items.unshift({ process: "pallet-transport", productSlug: FIXTURE_H1500.slug });
    const result = computeScenarios(cleaningContext(), specs)[1];
    if (result?.status !== "ok") throw new Error(JSON.stringify(result));
    const row = result.sensitivity.find(row => row.lever === "throughput")!;
    expect(row.clampedHigh).toBe(true); expect(row.npvHigh).not.toBeNull();
  });

  it("does not let floating-point multiplication exceed the quoted first month", () => {
    const specs = cleaningSpecs(); specs[1]!.kind = "raas";
    const item = specs[1]!.items[0]!, included = { mode: "included" } as const;
    item.raasRubMonthOverride = 185_000;
    item.raasPackage = { startup: included, platform: included, service: included,
      consumables: included, repair: included, battery: included, firstMonthRub: 187_535, reason: "Цена первого месяца фиксирована" };
    const result = computeScenarios(cleaningContext(), specs)[1];
    if (result?.status !== "ok") throw new Error(JSON.stringify(result));
    const row = result.sensitivity.find(row => row.lever === "raasRate")!;
    expect(row.clampedHigh).toBe(true); expect(row.npvHigh).not.toBeNull();
  });
});
