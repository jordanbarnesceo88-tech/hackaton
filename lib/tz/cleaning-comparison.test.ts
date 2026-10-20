import { describe, expect, it } from "vitest";
import { paramSpecsFor } from "../data/organizer/params";
import { comparisonReportRows } from "../report/tz/tables";
import { cleaningContext, cleaningSpecs, TEST_CLEANER } from "./econ/cleaning-fixtures";
import { buildProjectModel, storedPartOf } from "./model";
import type { ScenarioSpec } from "./types";

function model(scenarios = cleaningSpecs(), product = TEST_CLEANER) {
  const ctx = cleaningContext();
  return buildProjectModel({ facility: "warehouse", params: ctx.params, products: [product], norms: ctx.norms,
    paramDefs: paramSpecsFor("warehouse"), scenarios });
}

describe("cleaning comparison is tied to an explicit scenario", () => {
  it("shows the actual profile, fleet and purchase costs rather than accepting the catalogue passport", () => {
    const m = model(), result = m.results.find(row => row.key === "c1");
    if (result?.status !== "ok") throw new Error(JSON.stringify(result));
    const row = m.comparison.find(row => row.productSlug === TEST_CLEANER.slug)!;
    expect(row.thrEff).toBe(result.items[0]!.thrEff);
    expect(row.thrEff).not.toBe(TEST_CLEANER.throughputPerH);
    expect(row.n).toBe(result.items[0]!.n);
    expect(row.capexPurchaseRub).toBe(result.capexRub);
    expect(row.npvPurchaseRub).toBe(result.npvRub);
    expect(row.calculationBasis).toContain("Уборка");
    expect(comparisonReportRows(storedPartOf(m))[0]!.productTitle).toContain(row.calculationBasis);
  });

  it("does not substitute passport output when the profile is missing", () => {
    const specs = cleaningSpecs(); delete specs[1]!.items[0]!.cleaningProfile;
    const row = model(specs).comparison[0]!;
    expect(row.thrEff).toBeNull(); expect(row.n).toBeNull();
    expect(row.capexPurchaseRub).toBeNull();
    expect(row.calculationBasis).toContain("Профиль");
  });

  it("does not choose silently between two differently configured purchase scenarios", () => {
    const specs = cleaningSpecs();
    const second: ScenarioSpec = structuredClone(specs[1]!); second.key = "c2"; second.name = "Другой профиль";
    second.items[0]!.cleaningProfile!.throughputM2PerH = 1100; specs.push(second);
    const row = model(specs).comparison[0]!;
    expect(row.thrEff).toBeNull(); expect(row.npvPurchaseRub).toBeNull();
    expect(row.calculationBasis).toContain("несколько");
  });

  it("can show a RaaS profile without relabelling its subscription CAPEX as purchase CAPEX", () => {
    const specs = cleaningSpecs(); specs[1]!.kind = "raas";
    const m = model(specs), result = m.results.find(row => row.key === "c1");
    if (result?.status !== "ok") throw new Error(JSON.stringify(result));
    expect(m.comparison[0]!.thrEff).toBe(result.items[0]!.thrEff);
    expect(m.comparison[0]!.n).toBe(result.items[0]!.n);
    expect(m.comparison[0]!.capexPurchaseRub).toBeNull();
    expect(m.comparison[0]!.npvPurchaseRub).toBeNull();
  });

  it("explains a refused purchase rather than claiming its finances were calculated", () => {
    const m = model(cleaningSpecs(), { ...TEST_CLEANER, priceRub: null });
    const result = m.results.find(row => row.key === "c1");
    if (result?.status !== "refused") throw new Error(JSON.stringify(result));
    const row = m.comparison[0]!;
    expect(row.calculationBasis).toContain("не рассчитан");
    expect(row.calculationBasis).toContain(result.refusal.message);
    expect(row.calculationBasis).not.toContain("Покупка рассчитана");
    expect(row.thrEff).toBe(result.items[0]!.thrEff); expect(row.n).toBe(result.items[0]!.n);
    expect(row.capexPurchaseRub).toBeNull();
    expect(comparisonReportRows(storedPartOf(m))[0]!.productTitle).toContain("не рассчитан");
  });
});
