import { describe, expect, it } from "vitest";
import { complexSite } from "../../experiments/warehouse-3d/site";
import { paramSpecsFor } from "../data/organizer/params";
import { simInputIdentity } from "../sim/identity";
import { SPATIAL_MODEL_VERSION } from "../sim/spatial-bridge";
import { FIXTURE_DMR600, FIXTURE_H1500, WAREHOUSE_BASE_PARAMS } from "./econ/fixtures";
import { buildMatchedComparison, matchedComparisonCsv, matchedComparisonExport } from "./matched-comparison";
import { buildProjectModel, type BuildProjectModelInput } from "./model";
import { resolveNorms } from "./norms";
import type { ProductForCalc, ScenarioSpec } from "./types";

const ALT: ProductForCalc = { ...structuredClone(FIXTURE_H1500), slug: "alternative-fast", name: "Альтернативная модель", speedMps: 2.2, priceRub: 3_100_000, raasRubMonth: 90_000 };
function setup() {
  const source: ScenarioSpec = { key: "source", name: "Исходный состав", kind: "purchase", items: [{ process: "pallet-transport", productSlug: FIXTURE_H1500.slug, quantityOverride: 14, chargersOverride: 1, automationCoverageOverride: 0.7 }], cashRealizationShare: 0.25, simSeed: 23, terminalResidualRub: 500_000,
    terminalResidualSource: "Синтетическая оценка чистой продажи собственных активов для теста; после налогов, демонтажа и вывоза",
    operationsStaffing: { mode: "shared-existing", incrementalHoursYear: 100, grossHourlyRub: 500, payrollMultiplier: 1.302, reason: "Оценка дополнительных оплачиваемых часов" } };
  const input: BuildProjectModelInput = { facility: "warehouse", params: structuredClone(WAREHOUSE_BASE_PARAMS), paramDefs: paramSpecsFor("warehouse"), products: [structuredClone(FIXTURE_H1500), structuredClone(ALT), structuredClone(FIXTURE_DMR600)], norms: resolveNorms(), scenarios: [source] };
  return { source, input };
}
function withEvidence(source: ScenarioSpec, input: BuildProjectModelInput) {
  const expected = buildProjectModel(input).simInputs[source.key]?.calculated;
  if (!expected) throw Error("fixture missing physical input");
  source.spatialEvidence = { input: structuredClone(expected), sourceInputKey: simInputIdentity(expected), executionInputKey: "fixture-prepared", simModelVersion: SPATIAL_MODEL_VERSION, assessment: { status: "OK", terminal: true, headline: "Фикстурная проверка" }, summary: { fleet: expected.robots.count, requiredPerH: expected.demand.peakPerH, achievedPerH: 133.5, queueEnd: 0, waitP95Min: 1 } };
}

describe("bounded matched warehouse comparison", () => {
  it("uses the existing engine for pairs and keeps source, data and assumptions immutable", () => {
    const { source, input } = setup(), before = structuredClone({ source, input });
    const compared = buildMatchedComparison({ source, input });
    expect(compared.rows).toHaveLength(4);
    expect(compared.excludedProducts).toBeGreaterThan(0);
    expect(compared.rows.some(row => row.product.slug === FIXTURE_DMR600.slug)).toBe(false);
    expect({ source, input }).toEqual(before);
    const exact = buildProjectModel({ ...input, sims: undefined, scenarios: compared.rows.map(row => row.spec) });
    expect(compared.rows.map(row => row.result)).toEqual(exact.results);
    for (const row of compared.rows) {
      expect(row.spec.operationsStaffing).toEqual(source.operationsStaffing);
      expect(row.spec.cashRealizationShare).toBe(0.25);
      expect(row.spec.items[0]?.automationCoverageOverride).toBe(0.7);
      expect(row.spec.simSeed).toBe(23);
      expect(row.spec.terminalResidualRub).toBe(0);
      expect(row.physical.status).toBe("not-checked");
      expect(row.expectedInput?.demand).toEqual(compared.rows[0]?.expectedInput?.demand);
      expect(row.expectedInput?.seed).toBe(23);
    }
    const incumbent = compared.rows.find(row => row.product.slug === FIXTURE_H1500.slug)!;
    const alternative = compared.rows.find(row => row.product.slug === ALT.slug)!;
    expect(incumbent.result.items[0]?.n).toBe(14);
    expect(incumbent.fleetBasis).toBe("source-fixed");
    expect(alternative.fleetBasis).toBe("auto");
    expect(alternative.spec.items[0]?.quantityOverride).toBeUndefined();
    expect(alternative.result.items[0]?.n).not.toBe(14);
  });

  it("retains only the source product's explicit purchase contract and clears every pilot", () => {
    const { source, input } = setup();
    source.logistics = { mode: "included", source: "КП только для покупки исходной модели" };
    source.items[0]!.priceRubOverride = 2_000_000;
    source.items[0]!.serviceRubYearOverride = 100_000;
    source.items[0]!.costPackage = { softwareIncludedInIntegration: true, repairsIncludedInService: true, includedChargers: 1, reason: "Пакет только этой модели" };
    const comparison = buildMatchedComparison({ source, input });
    const purchase = comparison.rows.find(r => r.product.slug === FIXTURE_H1500.slug && r.spec.kind === "purchase")!;
    expect(purchase.spec.items[0]?.costPackage).toEqual(source.items[0]?.costPackage);
    expect(purchase.spec.logistics).toEqual(source.logistics);
    for (const row of comparison.rows.filter(row => row !== purchase)) {
      expect(row.spec.logistics).toBeUndefined();
      expect(row.costBasis.join(" ")).toContain("Доставка полного внедрения не оценена");
    }
    expect(purchase.spec.items[0]?.priceRubOverride).toBe(2_000_000);
    for (const row of comparison.rows) {
      expect(row.spec.pilotPlan).toBeUndefined();
      if (row.spec.kind === "raas") expect(row.spec.items[0]?.costPackage).toBeUndefined();
      if (row.product.slug !== FIXTURE_H1500.slug) {
        expect(row.spec.items[0]?.costPackage).toBeUndefined();
        expect(row.spec.items[0]?.priceRubOverride).toBeUndefined();
        expect(row.spec.items[0]?.serviceRubYearOverride).toBeUndefined();
      }
    }
  });

  it("does not invent unknown purchase prices, RaaS rates or charge parameters", () => {
    const { source, input } = setup();
    input.products = [{ ...FIXTURE_H1500, priceRub: null, raasRubMonth: null }, { ...ALT, chargeMin: null }];
    const comparison = buildMatchedComparison({ source, input });
    const own = comparison.rows.filter(r => r.product.slug === FIXTURE_H1500.slug);
    expect(own.map(row => row.result.status === "refused" ? row.result.refusal.reason : "ok")).toEqual(["price_required", "raas_rate_required"]);
    const missingCharge = comparison.rows.filter(r => r.product.slug === ALT.slug);
    expect(missingCharge).toHaveLength(2);
    for (const row of missingCharge) {
      expect(row.expectedInput).toBeNull();
      expect(row.physical.status).toBe("unavailable");
      expect(row.canAdopt).toBe(false);
      expect(row.physical.reason).toMatch(/заряд/i);
      expect(row.spec.items[0]?.raasFromEstimate).toBeUndefined();
    }
  });

  it("retains RaaS service scope only for the same model's RaaS row, never for purchase or another supplier", () => {
    const { source, input } = setup();
    source.kind = "raas";
    source.items[0]!.raasPackage = { firstMonthRub: 250000, startup: { mode: "included" },
      platform: { mode: "separate", amountRub: 12200, basis: "per-site" }, service: { mode: "included" },
      consumables: { mode: "included" }, repair: { mode: "included" }, battery: { mode: "included" },
      reason: "Тестовое условие только этой услуги; не переносится на другие предложения" };
    const before = structuredClone(source);
    const compared = buildMatchedComparison({ source, input });
    for (const row of compared.rows) {
      if (row.spec.kind === "raas" && row.product.slug === source.items[0]!.productSlug) {
        expect(row.spec.items[0]!.raasPackage).toEqual(source.items[0]!.raasPackage);
      } else expect(row.spec.items[0]!.raasPackage).toBeUndefined();
      expect(row.result.status).toBe("ok");
    }
    expect(source).toEqual(before);
  });

  it("reuses only matching canonical source evidence, including for the other acquisition kind", () => {
    const { source, input } = setup();
    withEvidence(source, input);
    const comparison = buildMatchedComparison({ source, input });
    for (const row of comparison.rows) {
      if (row.product.slug === source.items[0]!.productSlug) {
        expect(row.physical.status).toBe("confirmed");
        expect(row.spec.spatialEvidence).toEqual(source.spatialEvidence);
      } else {
        expect(row.physical.status).toBe("not-checked");
        expect(row.spec.spatialEvidence).toBeUndefined();
      }
    }
    source.items[0]!.quantityOverride = 15;
    const changed = buildMatchedComparison({ source, input });
    expect(changed.rows.filter(r => r.product.slug === FIXTURE_H1500.slug).every(r => r.physical.status === "stale" && !r.spec.spatialEvidence)).toBe(true);
  });

  it("does not reuse an identical-looking competitor's proof, or turn PARTIAL into OK", () => {
    const { source, input } = setup();
    input.products = [FIXTURE_H1500, { ...FIXTURE_H1500, slug: "same-characteristics", name: "Другой производитель" }];
    withEvidence(source, input); source.spatialEvidence!.assessment.status = "PARTIAL";
    const comparison = buildMatchedComparison({ source, input });
    expect(comparison.rows.filter(r => r.product.slug === FIXTURE_H1500.slug).every(r => r.physical.status === "partial")).toBe(true);
    expect(comparison.rows.filter(r => r.product.slug !== FIXTURE_H1500.slug).every(r => r.physical.status === "not-checked" && !r.spec.spatialEvidence)).toBe(true);
  });

  it("keeps an explicit source plan and its physical chargers identical for every product", () => {
    const { source, input } = setup();
    source.siteLayout = complexSite(10_000, 1);
    input.params = { ...input.params, receivingDocksCount: 2, shippingDocksCount: 2 };
    const comparison = buildMatchedComparison({ source, input });
    for (const row of comparison.rows) {
      expect(row.result.status).toBe("ok");
      expect(row.expectedInput).not.toBeNull();
      expect(row.spec.siteLayout).toEqual(source.siteLayout);
      expect(row.spec.items[0]?.chargersOverride).toBe(source.siteLayout.chargers.length);
      expect(row.chargersBasis).toBe("fixed-site");
    }
    source.items[0]!.chargersOverride = 2;
    const inconsistent = buildMatchedComparison({ source, input });
    expect(inconsistent.rows).toHaveLength(0);
    expect(inconsistent.reason).toMatch(/расходится/);
  });

  it("is bounded to three models and six rows with unique new keys", () => {
    const { source, input } = setup();
    input.products = [FIXTURE_H1500, ...Array.from({ length: 10 }, (_, i) => ({ ...ALT, slug: `alt-${i}`, name: `Модель ${i}` }))];
    input.scenarios = [source, { ...source, key: "match-source-1-purchase", name: "Занятый ключ" }];
    const comparison = buildMatchedComparison({ source, input, maxProducts: 100 });
    expect(comparison.rows).toHaveLength(6);
    expect(new Set(comparison.rows.map(r => r.spec.key)).size).toBe(6);
    expect(comparison.rows.every(r => !input.scenarios.some(s => s.key === r.spec.key))).toBe(true);
    expect(comparison.additionalEligibleProducts).toBe(8);
    expect(comparison.rows.every(r => r.spec.name.length <= 80)).toBe(true);
  });

  it("keeps negative economics and different cash realization explicit instead of optimizing the inputs", () => {
    const { source, input } = setup();
    source.cashRealizationShare = 0;
    const retained = buildMatchedComparison({ source, input });
    expect(retained.rows.every(r => r.spec.cashRealizationShare === 0)).toBe(true);
    expect(retained.rows.filter(r => r.result.status === "ok").every(r => r.result.status === "ok" && r.result.npvRub! < 0)).toBe(true);
    source.cashRealizationShare = 1;
    const released = buildMatchedComparison({ source, input });
    const zero = retained.rows[0]!.result, full = released.rows[0]!.result;
    expect(zero.status).toBe("ok");expect(full.status).toBe("ok");
    if (zero.status === "ok" && full.status === "ok") expect(zero.npvRub).toBeLessThan(full.npvRub!);
  });

  it("exports the table with geometry once and preserves statuses, missing amounts and CSV safety", () => {
    const { source, input } = setup();
    source.siteLayout = complexSite(10_000, 1);
    input.params = { ...input.params, receivingDocksCount: 2, shippingDocksCount: 2 };
    input.products = [{ ...FIXTURE_H1500, name: "=unsafe", raasRubMonth: null }, ALT];
    const comparison = buildMatchedComparison({ source, input }), exported = matchedComparisonExport(comparison);
    expect(exported.sharedSiteLayout).toEqual(source.siteLayout);
    expect(exported.rows).toHaveLength(4);
    expect(exported.rows.every(r => !Object.hasOwn(r, "expectedInput") && !Object.hasOwn(r.spec, "siteLayout") && !Object.hasOwn(r.spec, "spatialEvidence"))).toBe(true);
    expect(exported.products).toHaveLength(2);
    const csv = matchedComparisonCsv(comparison);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("'=unsafe");
    expect(csv).toContain("Нет ставки RaaS");
    expect(csv).toContain("not-checked");
    expect(csv).toContain("Остаточная стоимость");
    expect(JSON.stringify(exported)).not.toContain('"executionInput"');
    expect(exported.paramsUsed).toEqual(buildProjectModel(input).paramsUsed);
  });

  it("rejects unsupported scope and never mutates the original multi-process scenario", () => {
    const { source, input } = setup();source.items.push({ ...source.items[0]!, process: "piece-picking" });
    const before = structuredClone(source), comparison = buildMatchedComparison({ source, input });
    expect(comparison.rows).toHaveLength(0);expect(comparison.reason).toMatch(/одного процесса/);expect(source).toEqual(before);
  });
});
