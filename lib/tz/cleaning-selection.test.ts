import { describe, expect, it } from "vitest";
import { productForCalcFromSeed } from "../catalog/product-for-calc";
import type { OperatingEvidence } from "../catalog/operating-evidence";
import { VENDOR_CLEANING_PRODUCTS } from "../data/vendor-cleaning";
import { baseValuesFor, paramSpecsFor } from "../data/organizer/params";
import { warehouseCleaningInputs } from "../projects/cleaning-example";
import { cleaningWorkingProfile } from "../data/cleaning-assumptions";
import { resolveNorms } from "./norms";
import { buildCleaningSelectionScenarios, compareCleaningOptions, type CleaningSelectionInput } from "./cleaning-selection";

function input(): CleaningSelectionInput {
  const products = VENDOR_CLEANING_PRODUCTS.map(productForCalcFromSeed);
  const { params } = warehouseCleaningInputs(baseValuesFor("warehouse"), products);
  return { facility: "warehouse", params, products, norms: resolveNorms(), paramDefs: paramSpecsFor("warehouse"), mode: "scrubbing", asOf: "2026-10-20", windowH: 8, automatableLabourShare: 0.5 };
}
const evidence: OperatingEvidence = { schemaVersion: "operating-evidence-1", productSlug: "pudu-cc1", process: "cleaning", facility: "warehouse", mode: "scrubbing", unit: "м²/ч", site: "Обезличенный тестовый участок", measuredAt: "2026-10-18", verifiedAt: "2026-10-19", sourceRef: "Тестовый акт", measuredBy: "Тест", samples: 3, output: 400, operatingMinutes: 60, elapsedMinutes: 90, basis: "operating-hour", confirmed: true };

describe("cleaning model selection on a shared finite day", () => {
  it.each(["warehouse", "airport", "medical"])("compares all three and runs the priced option for %s with explicit cleaning staff", facility => {
    const i = input();
    const rows = compareCleaningOptions({ ...i, facility, params: { ...baseValuesFor(facility), cleaningAreaM2: 8000, cleaningsPerDay: 1, cleanersCount: 8, cleanerSalaryRubMonth: 65000, workDaysPerYear: 300 },
      quotes: { "pudu-cc1": { purchaseRub: 2790000, source: "Синтетическое предложение для проверки интеграции объектов" } } });
    expect(rows.every(row => row.status === "candidate")).toBe(true);
    expect(rows.map(row => row.day?.capacityM2PerDay)).toEqual([2200, 3450, 8625]);
    expect(rows[0]!.purchase.result?.status, rows[0]!.purchase.reason).toBe("ok");
    expect(rows[1]!.purchase.rank).toBeNull();
  });
  it("compares all three models on the same demand/window/labour without passport or extra availability factors", () => {
    const i = input(), before = structuredClone(i), rows = compareCleaningOptions(i);
    expect(rows.map(row => [row.productSlug, row.status, row.day?.activeHoursPerDay, row.day?.capacityM2PerDay, row.quantity])).toEqual([
      ["pudu-cc1", "candidate", 4, 2200, 5], ["agibot-c5", "candidate", 5.75, 3450, 3], ["viggo-sc80", "candidate", 5.75, 8625, 2],
    ]);
    for (const row of rows) {
      expect(row.demandM2PerDay).toBe(8000); expect(row.profile?.windowH).toBe(8); expect(row.profile?.automatableLabourShare).toBe(0.5);
      expect(row.chargers).toBe(row.quantity); expect(row.coverage).toBe(1);
      expect(row.purchase.priceRub).toBeNull(); expect(row.raas.priceRub).toBeNull(); expect(row.purchase.rank).toBeNull(); expect(row.raas.rank).toBeNull();
      expect(row.profileBasis).toBe("working");
    }
    expect(i).toEqual(before);
    const changed = compareCleaningOptions({ ...i, windowH: 4, params: { ...i.params, cleaningsPerDay: 2 } });
    expect(changed.every(row => row.demandM2PerDay === 16000 && row.profile?.windowH === 4)).toBe(true);
    expect(changed[0]!.quantity).toBeGreaterThan(rows[0]!.quantity!);
  });

  it("gives an explicit exclusion reason for a wrong facility, narrow aisle and invalid daily recovery", () => {
    const i = input();
    i.products = i.products.map(product => product.slug === "pudu-cc1" ? { ...product, facilityTypes: ["airport"] } : product.slug === "agibot-c5" ? { ...product, minAisleM: 4 } : product);
    i.profiles = { "viggo-sc80": { ...cleaningWorkingProfile("viggo-sc80")!, workBeforeChargeH: 3, chargeH: 4 } };
    const rows = compareCleaningOptions({ ...i, windowH: 24 });
    expect(rows.every(row => row.status === "excluded")).toBe(true);
    expect(rows[0]!.reasons.join(" ")).toContain("не применяется");
    expect(rows[1]!.reasons.join(" ")).toContain("4");
    expect(rows[2]!.reasons.join(" ")).toContain("заряд");
    expect(() => buildCleaningSelectionScenarios(rows[0]!)).toThrow();
  });

  it("caps only a qualified active-hour measurement and carries its provenance into the proposal", () => {
    const i = input();
    i.products = i.products.map(product => product.slug === "pudu-cc1" ? { ...product, operatingEvidence: evidence, operatingEvidenceConfirmed: true } : product);
    const row = compareCleaningOptions(i)[0]!;
    expect(row.evidence.applied).toBe(true); expect(row.profileBasis).toBe("evidence-capped");
    expect(row.profile?.throughputM2PerH).toBe(400); expect(row.day?.capacityM2PerDay).toBe(1600); expect(row.quantity).toBe(6);
    expect(buildCleaningSelectionScenarios(row)[0]!.items[0]!.cleaningProfile?.source).toContain("Тестовый акт");
    const mismatched = compareCleaningOptions({ ...i, mode: "sweeping" })[0]!;
    expect(mismatched.evidence.applied).toBe(false); expect(mismatched.profile?.throughputM2PerH).toBe(550);
    i.products = i.products.map((product, index) => index === 0 ? { ...product, operatingEvidence: { ...evidence, basis: "shift-hour" } } : product);
    const shift = compareCleaningOptions(i)[0]!;
    expect(shift.evidence.applied).toBe(false); expect(shift.evidence.reason).toContain("повторной зарядкой");
    expect(shift.profile?.throughputM2PerH).toBe(550);
  });

  it("does not substitute zero-output evidence or make care labour free", () => {
    const i = input();
    i.products = i.products.map((product, index) => index === 0 ? { ...product, operatingEvidence: { ...evidence, output: 0 }, operatingEvidenceConfirmed: true } : product);
    expect(compareCleaningOptions(i)[0]!.reasons.join(" ")).toContain("нулевую выработку");
    const noLabour = compareCleaningOptions({ ...input(), automatableLabourShare: 0 });
    expect(noLabour.every(row => row.status === "excluded" && row.reasons.join(" ").includes("уход"))).toBe(true);
  });

  it("requires actual prices and explicit RaaS scope before financial ranking, preserves a supplied quote and unknowns", () => {
    const i = input();
    const fixture = warehouseCleaningInputs(i.params, i.products);
    i.scenarios = fixture.scenarios;
    const rows = compareCleaningOptions(i);
    expect(rows[0]!.purchase.rank).toBe(1); expect(rows[0]!.raas.rank).toBe(1);
    expect(rows[1]!.purchase.rank).toBeNull(); expect(rows[2]!.purchase.rank).toBeNull();
    const differentReserve = structuredClone(fixture.scenarios);
    differentReserve[1]!.normOverrides = { ...differentReserve[1]!.normOverrides, reservePct: 0.5 };
    const sharedReserve = compareCleaningOptions({ ...i, scenarios: differentReserve })[0]!;
    expect(sharedReserve.purchase.result?.items[0]?.n).toBe(sharedReserve.quantity);
    const oldFleet = structuredClone(fixture.scenarios);
    oldFleet[1]!.items[0]!.quantityOverride = 12;
    oldFleet[1]!.terminalResidualRub = 20000000;
    oldFleet[1]!.terminalResidualSource = "Продажа исходного парка из 12 машин, синтетический контрпример";
    const resized = compareCleaningOptions({ ...i, scenarios: oldFleet })[0]!;
    expect(resized.quantity).toBe(5);
    expect(resized.specs[0]!.terminalResidualRub).toBeUndefined(); expect(resized.specs[0]!.terminalResidualSource).toBeUndefined();
    expect(resized.warnings.join(" ")).toContain("Остаточная стоимость прежнего парка не перенесена");
    expect(resized.purchase.result?.status === "ok" && resized.purchase.result.npvRub).toBe(rows[0]!.purchase.result?.status === "ok" && rows[0]!.purchase.result.npvRub);
    const proposal = buildCleaningSelectionScenarios(rows[0]!);
    expect(proposal[0]!.items[0]!.costPackage?.allChargersIncluded).toBe(true);
    expect(proposal[1]!.items[0]!.raasPackage?.firstMonthRub).toBe(250000);
    const afterApply = compareCleaningOptions({ ...i, scenarios: [...i.scenarios!, ...proposal] })[0]!;
    expect(afterApply.purchase.priceRub).toBe(2790000); expect(afterApply.raas.priceRub).toBe(185000);
    expect(afterApply.specs[0]!.items[0]!.costPackage?.allChargersIncluded).toBe(true);
    const repriced = compareCleaningOptions({ ...i, quotes: { "pudu-cc1": { purchaseRub: 3000000, raasRubMonth: 190000, source: "Новое предложение для синтетического теста" } } })[0]!;
    const repricedSpecs = buildCleaningSelectionScenarios(repriced);
    expect(repricedSpecs[0]!.items[0]!.costPackage?.reason).toContain("Новое предложение");
    expect(repricedSpecs[0]!.items[0]!.costPackage?.allChargersIncluded).toBe(true);
    expect(repricedSpecs[1]!.items[0]!.raasPackage?.reason).toContain("Новое предложение");
    expect(repricedSpecs[1]!.items[0]!.raasPackage?.firstMonthRub).toBe(250000);
    proposal[0]!.items[0]!.cleaningProfile!.throughputM2PerH = 1;
    expect(rows[0]!.profile!.throughputM2PerH).toBe(550);
    const priced = compareCleaningOptions({ ...input(), quotes: { "agibot-c5": { purchaseRub: 4000000, raasRubMonth: 200000, source: "Тестовая оценка для проверки, не реальная цена" } } })[1]!;
    expect(priced.purchase.result?.status).toBe("ok"); expect(priced.purchase.rank).toBe(1);
    expect(priced.raas.result?.status).toBe("refused"); expect(priced.raas.rank).toBeNull();
    expect(priced.raas.reason).toContain("Не оценены статьи");
    const cleared = compareCleaningOptions({ ...i, quotes: { "pudu-cc1": { purchaseRub: undefined, raasRubMonth: undefined, source: "Предложение больше не действует" } } })[0]!;
    expect(cleared.purchase.priceRub).toBeNull(); expect(cleared.purchase.rank).toBeNull();
    expect(cleared.raas.priceRub).toBeNull(); expect(cleared.raas.rank).toBeNull();
  });

  it("rejects fake zero/negative prices and missing sources rather than ranking them", () => {
    for (const quote of [{ purchaseRub: 0, source: "test" }, { purchaseRub: -1, source: "test" }, { purchaseRub: Infinity, source: "test" }, { purchaseRub: 2000000, source: " " }]) {
      const row = compareCleaningOptions({ ...input(), quotes: { "pudu-cc1": quote } })[0]!;
      expect(row.status).toBe("excluded"); expect(row.purchase.rank).toBeNull(); expect(() => buildCleaningSelectionScenarios(row)).toThrow();
    }
  });
});
