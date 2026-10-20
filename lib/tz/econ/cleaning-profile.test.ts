import { describe, expect, it } from "vitest";
import type { ScenarioOk } from "../types";
import { cleaningDay, parseCleaningProfile } from "./cleaning-profile";
import { fixtureContext, fixtureSpecs } from "./fixtures";
import { TEST_CLEANING_PROFILE, TEST_CLEANER, cleaningContext, cleaningSpecs } from "./cleaning-fixtures";
import { computeScenarios } from "./scenario";
import { computeScenariosCore } from "./core";

function calculated(specs = cleaningSpecs(), ctx = cleaningContext()): ScenarioOk {
  const result = computeScenarios(ctx, specs).find(row => row.key === "c1");
  if (result?.status !== "ok") throw new Error(JSON.stringify(result));
  return result;
}

describe("finite cleaning workday and financial assumptions", () => {
  it.each([[2, 2, 4], [2, 1, 6], [4, 2, 6]])("8h window with %sh work/%sh charge gives %sh active", (workBeforeChargeH, chargeH, active) => {
    expect(cleaningDay({ ...TEST_CLEANING_PROFILE, dailyCareMin: 0, workBeforeChargeH, chargeH }).activeHoursPerDay).toBe(active);
  });
  it.each([[2, 2, 4], [2, 1, 5.75], [4, 2, 5.75]])("reserves 15min care before finite %s/%s cycles, rather than prorating uptime", (workBeforeChargeH, chargeH, active) => {
    expect(cleaningDay({ ...TEST_CLEANING_PROFILE, workBeforeChargeH, chargeH }).activeHoursPerDay).toBe(active);
  });
  it("counts incomplete final work/charge intervals and never requires a final recharge", () => {
    for (const [windowH, active] of [[1, 1], [2, 2], [3, 2], [4, 2], [5, 3], [6, 4], [8, 4], [9, 5]]) {
      expect(cleaningDay({ ...TEST_CLEANING_PROFILE, dailyCareMin: 0, windowH: windowH! }).activeHoursPerDay).toBe(active);
    }
  });
  it("requires enough time after the window to restore tomorrow's initially full battery", () => {
    expect(() => parseCleaningProfile({ ...TEST_CLEANING_PROFILE, windowH: 24, workBeforeChargeH: 3, chargeH: 4 })).toThrow(/восстановить полный заряд/);
    expect(() => parseCleaningProfile({ ...TEST_CLEANING_PROFILE, windowH: 23, workBeforeChargeH: 2, chargeH: 2 })).toThrow(/восстановить полный заряд/);
    const day = cleaningDay(TEST_CLEANING_PROFILE);
    expect(day.remainingChargeH).toBe(.25); expect(day.overnightH).toBe(16);
    expect(parseCleaningProfile({ ...TEST_CLEANING_PROFILE, windowH: 24, dailyCareMin: 0, workBeforeChargeH: 2, chargeH: 2 })).toBeDefined();
  });
  it("uses daily area×frequency and explicit profile, without passport or repeated U/A/peak factors", () => {
    const ctx = cleaningContext(), specs = cleaningSpecs();
    ctx.norms = { ...ctx.norms, reservePct: 0, utilization: .1, availability: .1 };
    const row = calculated(specs, ctx), item = row.items[0]!;
    expect(item.demandPerDay).toBe(4400); expect(item.n).toBe(2); expect(item.coverage).toBe(1);
    expect(item.cleaning?.activeHoursPerDay).toBe(4); expect(item.cleaning?.capacityM2PerDay).toBe(2200);
    expect(item.thrEff).toBe(275); expect(item.thrNorm).toBeNull(); expect(item.thrSource).toBe("профиль уборки");
    expect(item.thrEvidence).toBeUndefined(); expect(item.chargers).toBe(2);
    const twice = calculated(specs, { ...ctx, params: { ...ctx.params, cleaningsPerDay: 2 } });
    expect(twice.items[0]!.n).toBe(4);
    expect(row.risks.find(r => r.code === "CLEANING_PROFILE_ASSUMPTION")!.text).toContain("не подтверждение 2D/3D");
  });
  it("compares only cleaners and subtracts care once from explicit released FTE before cash realization", () => {
    const ctx = cleaningContext(), specs = cleaningSpecs(); ctx.norms = { ...ctx.norms, reservePct: 0, laborShareAutomatable: .01 };
    specs[1]!.cashRealizationShare = .4;
    const row = calculated(specs, ctx), item = row.items[0]!;
    const careFte = 2 * .25 * 365 / ctx.norms.annualHoursPerFte;
    expect(item.releasedFte).toBeCloseTo(4 * .5 - careFte);
    expect(item.cleaning!.careFte).toBeCloseTo(careFte);
    expect(item.operatorPosts).toBe(0); expect(item.operatingStaffRub).toBe(0);
    expect(item.remainingLabourRub).toBeCloseTo(4 * item.roleCostRubYear - item.releasedFte * item.roleCostRubYear * .4);
    const asis = computeScenariosCore(ctx, specs)[0] as ScenarioOk;
    expect(asis.opexYearRub).toBe(4 * 65000 * 12 * 1.302);
    expect(row.processLabourYearRub).toBeCloseTo(item.remainingLabourRub);
  });
  it("scales under-capacity coverage and keeps pallet calculations exactly unchanged", () => {
    const specs = cleaningSpecs(); specs[1]!.items[0]!.quantityOverride = 1;
    expect(calculated(specs).items[0]!.coverage).toBe(.5);
    const ctx = fixtureContext();
    expect(computeScenariosCore(ctx, fixtureSpecs())).toEqual(computeScenariosCore({ ...ctx, products: { ...ctx.products, [TEST_CLEANER.slug]: TEST_CLEANER } }, fixtureSpecs()));
  });
  it("refuses unprovided care labour, accepts exact equality and does not confuse cash realization with physical hours", () => {
    const ctx = cleaningContext(); ctx.norms = { ...ctx.norms, reservePct: 0 };
    const careFte = 2 * .25 * 365 / ctx.norms.annualHoursPerFte;
    const profile = { ...TEST_CLEANING_PROFILE, automatableLabourShare: careFte / 4 };
    const specs = cleaningSpecs(profile); specs[1]!.cashRealizationShare = 0;
    const equal = calculated(specs, ctx);
    expect(equal.items[0]!.releasedFte).toBeCloseTo(0);
    expect(equal.items[0]!.remainingLabourRub).toBe(equal.items[0]!.baselineLabourRub);
    const insufficient = cleaningSpecs({ ...profile, automatableLabourShare: 0 });
    const row = computeScenarios(ctx, insufficient)[1]!;
    expect(row.status).toBe("refused");
    if (row.status === "refused") expect(row.refusal).toMatchObject({ reason: "staffing_required", message: expect.stringContaining("уход не обеспечен") });
    const normal = cleaningSpecs(); normal[1]!.cashRealizationShare = 0;
    expect(calculated(normal, ctx).items[0]!.releasedFte).toBeGreaterThan(0);
    const foreign = computeScenarios({ ...ctx, facility: "airport" }, cleaningSpecs())[1]!;
    expect(foreign.status).toBe("refused");
  });
  it("refuses insufficient chargers and missing/ambiguous operating profiles", () => {
    const ctx = cleaningContext();
    for (const patch of [{ cleaningProfile: undefined }, { chargersOverride: 0 }, { chargersOverride: 1 }, { throughputPerHOverride: 700 }]) {
      const specs = cleaningSpecs(); Object.assign(specs[1]!.items[0]!, patch);
      const row = computeScenarios(ctx, specs)[1]!;
      expect(row.status).toBe("refused");
      if (row.status === "refused") expect(row.refusal.message).toMatch(/профил|зарядк/);
    }
  });
  it("strictly validates profile boundaries and provenance without accepting evidence claims", () => {
    expect(parseCleaningProfile(TEST_CLEANING_PROFILE)).toEqual(TEST_CLEANING_PROFILE);
    for (const patch of [{ throughputM2PerH: 0 }, { workBeforeChargeH: 0 }, { chargeH: Infinity }, { dailyCareMin: 480 }, { dailyCareMin: -1 }, { initiallyCharged: false }, { careWithinWindow: false }, { automatableLabourShare: 1.1 }, { source: " " }, { reason: "" }, { date: "2026-02-30" }, { approved: true }, { basis: "shift-hour" }]) expect(() => parseCleaningProfile({ ...TEST_CLEANING_PROFILE, ...patch })).toThrow();
  });
});
