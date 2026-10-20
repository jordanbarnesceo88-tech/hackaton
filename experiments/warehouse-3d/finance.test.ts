import { beforeAll, describe, expect, it, vi } from "vitest";
import { productForCalcFromSeed } from "../../lib/catalog/product-for-calc";
import { CATALOG } from "../../lib/data/organizer/catalog";
import { paramSpecsFor } from "../../lib/data/organizer/params";
import { simInputIdentity } from "../../lib/sim/identity";
import { buildProjectModel } from "../../lib/tz/model";
import { resolveNorms } from "../../lib/tz/norms";
import { calculateCase, recheckSpatialFinanceInput, type DemoModel } from "./core";
import { calculateSpatialFinance } from "./finance";

// These tests check financial arithmetic and input identity, not full-window capacity.
// Both the actual and reference financial model use this same bounded exposure.
vi.mock("../../lib/tz/norms", async importOriginal => {
  const actual = await importOriginal<typeof import("../../lib/tz/norms")>();
  return { ...actual, resolveNorms: (...args: Parameters<typeof actual.resolveNorms>) => ({
    ...actual.resolveNorms(...args), simWarmupMin: 0, simPeakMin: 2,
  }) };
});

let baseline: DemoModel;
beforeAll(() => { baseline = calculateCase("baseline", { areaM2: 5000, fleet: 3 }); });
const shares = { annualCoverageShare: 0.6, cashRealizationShare: 0.5 };

describe("standalone financial scenario uses the shared project engine", () => {
  it("reproduces the existing financial engine exactly without mutating the demo", () => {
    const before = structuredClone(baseline), result = calculateSpatialFinance(baseline, shares);
    const expected = buildProjectModel({ facility: "warehouse", params: baseline.financialParams!, paramDefs: paramSpecsFor("warehouse"), products: CATALOG.map(productForCalcFromSeed), scenarios: result.model.scenarios, norms: resolveNorms() });
    expect(result.purchase).toEqual(expected.results.find(row => row.key === "purchase"));
    expect(result.raas).toEqual(expected.results.find(row => row.key === "raas"));
    expect(baseline).toEqual(before);
    expect(result.assumptions.spatialMatchesFinancialInput).toBe(true);
    expect(result.assumptions.sourceInputKey).toBe(simInputIdentity(baseline.financialSourceInput!));
    expect(result.model.scenarios.find(row => row.key === "purchase")).toMatchObject({ cashRealizationShare: 0.5, items: [{ quantityOverride: baseline.input.robots.count, chargersOverride: baseline.input.layout.chargers, automationCoverageOverride: 0.6 }] });
  });

  it("uses the selected N/C for equipment and infrastructure costs instead of scaling NPV by output", () => {
    const changed = structuredClone(baseline);
    changed.input.robots.count = changed.financialSourceInput!.robots.count = changed.summary.fleet = 20;
    changed.input.layout.chargers = changed.financialSourceInput!.layout.chargers = 4;
    const previous = calculateSpatialFinance(baseline, shares), next = calculateSpatialFinance(recheckSpatialFinanceInput(changed), shares);
    expect(next.purchase.items[0]).toMatchObject({ n: 20, chargers: 4 });
    expect(next.purchase.capexRub).toBeGreaterThan(previous.purchase.capexRub);
    expect(next.purchase.npvRub).not.toBe(previous.purchase.npvRub);
    const ratesOnly = structuredClone(baseline); ratesOnly.summary.achievedPerH *= 0.25;
    const withoutRateScaling = calculateSpatialFinance(ratesOnly, shares);
    expect(withoutRateScaling.purchase.npvRub).toBe(previous.purchase.npvRub);
  // Rechecks a real N20 spatial input before comparing financial results; retain all engine limits.
  }, 60_000);

  it("separates annual work coverage from cash realization at both endpoints", () => {
    const zero = calculateSpatialFinance(baseline, { annualCoverageShare: 0.6, cashRealizationShare: 0 });
    const full = calculateSpatialFinance(baseline, { annualCoverageShare: 0.6, cashRealizationShare: 1 });
    expect(zero.purchase.items[0]!.releasedFte).toBe(full.purchase.items[0]!.releasedFte);
    expect(zero.purchase.items[0]!.remainingLabourRub).toBe(zero.purchase.items[0]!.baselineLabourRub);
    expect(full.purchase.items[0]!.remainingLabourRub).toBeLessThan(zero.purchase.items[0]!.remainingLabourRub);
    const uncovered = calculateSpatialFinance(baseline, { annualCoverageShare: 0, cashRealizationShare: 1 });
    expect(uncovered.purchase.items[0]!.coverage).toBe(0);
    expect(uncovered.purchase.items[0]!.releasedFte).toBe(0);
  });

  it("uses the same real complex source geometry in finance and evidence without rewriting an identity", () => {
    const complex = calculateCase("complex", { areaM2: 5000, fleet: 3 }), before = structuredClone(complex);
    const result = calculateSpatialFinance(complex, shares);
    expect(result.assumptions.spatialMatchesFinancialInput).toBe(true);
    expect(result.assumptions.financialGeometry).toBe("explicit-site");
    expect(result.purchase.risks.some(risk => risk.code === "SPATIAL_STALE")).toBe(false);
    expect(result.model.simInputs.purchase!.calculated).toEqual(complex.financialSourceInput);
    expect(result.model.scenarios.find(row => row.key === "purchase")!.siteLayout).toEqual(complex.financialSourceInput!.siteLayout);
    expect(result.model.scenarios.find(row => row.key === "purchase")!.spatialEvidence!.input.siteLayout).toEqual(complex.financialSourceInput!.siteLayout);
    expect(complex).toEqual(before);
    const changed = structuredClone(complex); changed.financialSourceInput!.siteLayout!.widthM++;
    expect(() => calculateSpatialFinance(changed, shares)).toThrow(/геометрия/);
  // Complex geometry preparation and terminal replay are CPU work even with the short fixture horizon.
  }, 30_000);

  it("rejects project handoffs, missing parameters, stale counts and nonfinite shares", () => {
    const project = structuredClone(baseline);
    project.projectOrigin = { requestId: "project", scenarioKey: "purchase", variantId: "calculated", sourceInput: baseline.financialSourceInput!, sourceInputKey: "source", executionInputKey: "execution" };
    expect(() => calculateSpatialFinance(project, shares)).toThrow(/в проекте/);
    const missing = structuredClone(baseline); delete missing.financialParams;
    expect(() => calculateSpatialFinance(missing, shares)).toThrow(/Нет исходных/);
    const missingInput = structuredClone(baseline); delete missingInput.financialSourceInput;
    expect(() => calculateSpatialFinance(missingInput, shares)).toThrow(/Нет исходных/);
    const mismatched = structuredClone(baseline); mismatched.input.robots.count++;
    expect(() => calculateSpatialFinance(mismatched, shares)).toThrow(/не соответствует парку/);
    for (const n of [-0.1, 1.1, NaN, Infinity]) {
      expect(() => calculateSpatialFinance(baseline, { ...shares, annualCoverageShare: n })).toThrow(/Доли/);
      expect(() => calculateSpatialFinance(baseline, { ...shares, cashRealizationShare: n })).toThrow(/Доли/);
    }
    const invalidParams = structuredClone(baseline); invalidParams.financialParams!.forkliftSalaryRubMonth = NaN;
    expect(() => calculateSpatialFinance(invalidParams, shares)).toThrow();
  });

  it("keeps explicit staffing and purchase package in finance and exports without changing the physical evidence", () => {
    const old = calculateSpatialFinance(baseline, shares);
    const result = calculateSpatialFinance(baseline, { ...shares,
      operationsStaffing: { mode: "shared-existing", incrementalHoursYear: 365, grossHourlyRub: 600, payrollMultiplier: 1.302, reason: "Пример: оплачивается час работы мастера в день; требует проверки" },
      costPackage: { softwareIncludedInIntegration: true, repairsIncludedInService: true, includedChargers: 0, reason: "Условная комплектация для проверки; не предложение поставщика" },
    });
    expect(result.assumptions.sourceInputKey).toBe(old.assumptions.sourceInputKey);
    expect(result.model.simInputs.purchase?.calculated).toEqual(old.model.simInputs.purchase?.calculated);
    expect(result.purchase.operationsStaffing?.annualCostRub).toBeCloseTo(365 * 600 * 1.302);
    expect(result.raas?.operationsStaffing?.annualCostRub).toBe(result.purchase.operationsStaffing?.annualCostRub);
    expect(result.purchase.items[0]!.releasedFte).toBe(old.purchase.items[0]!.releasedFte);
    expect(result.purchase.capexLines.find(line => line.key === "software")!.valueRub).toBe(0);
    expect(result.purchase.opexLines.find(line => line.key === "repair")!.valueRub).toBe(0);
    expect(result.model.scenarios.find(row => row.kind === "raas")!.items[0]!.costPackage).toBeUndefined();
    expect(result.assumptions.operationsStaffing?.reason).toContain("требует проверки");
    expect(() => calculateSpatialFinance(baseline, { ...shares, operationsStaffing: { mode: "shared-existing", incrementalHoursYear: NaN, grossHourlyRub: 0, payrollMultiplier: 1.302, reason: "неизвестно" } })).toThrow();
  });
});
