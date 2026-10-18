import { describe, expect, it, vi } from "vitest";
import * as norms from "../../lib/tz/norms";
import { calculateCase, recheckSpatialFinanceInput } from "./core";
import { applyFleetComparison, compareWarehouseFleet } from "./comparison";
import { calculateSpatialFinance } from "./finance";
import { simInputIdentity } from "../../lib/sim/identity";
import { businessExampleInputs } from "../../lib/projects/business-examples";
import { resultsFromInputs } from "../../lib/projects/recalc";
import { baseValuesFor, paramSpecsFor } from "../../lib/data/organizer/params";
import { CATALOG } from "../../lib/data/organizer/catalog";
import { productForCalcFromSeed } from "../../lib/catalog/product-for-calc";

describe("chosen fleet to canonical finance verification", () => {
  it("does not turn the fourteen-robot reserve into a capacity proof on unchanged organizer demand", () => {
    const reserve = calculateCase("capacity-reserve"), baseline = calculateCase("baseline");
    expect(reserve.financialSourceInput!.demand).toEqual(baseline.financialSourceInput!.demand);
    const { chargers: reserveChargers, ...reserveGeometry } = reserve.financialSourceInput!.layout;
    const { chargers: baselineChargers, ...baselineGeometry } = baseline.financialSourceInput!.layout;
    expect(reserveGeometry).toEqual(baselineGeometry);
    expect(reserveChargers).toBe(1); expect(baselineChargers).toBe(2);
    expect(reserve.financialSourceInput!.robots.count).toBe(14);
    expect(reserve.assessment.status).toBe("PARTIAL");
    expect(reserve.summary.achievedPerH).toBeLessThan(reserve.summary.requiredPerH);
    expect(reserve.assessment.checks.filter(c => c.category === "safety").every(c => c.status === "PASS")).toBe(true);
    const finance = calculateSpatialFinance(reserve, { annualCoverageShare: 1, cashRealizationShare: 0.5 });
    expect(finance.purchase.items[0]).toMatchObject({ n: 14, chargers: reserve.input.layout.chargers });
    expect(finance.assumptions.spatialMatchesFinancialInput).toBe(true);
    expect(finance.model.scenarios.find(s => s.key === "purchase")!.spatialEvidence!.assessment.status).toBe("PARTIAL");
  }, 60_000); // Two complete 135-minute physical runs, including the reserve's charging failure.

  it("carries the actually qualified six-robot workload and its exact physical receipt into finance", () => {
    const products = CATALOG.map(productForCalcFromSeed);
    const data = businessExampleInputs("steady-flow", baseValuesFor("warehouse"), products);
    const { model: project, results } = resultsFromInputs({ products, paramDefs: paramSpecsFor("warehouse"),
      norms: norms.resolveNorms(), paramDefsFrom: "code" }, { facility: "warehouse", params: data.params, scenarios: data.scenarios });
    const input = project.simInputs.purchase!.calculated!;
    const evidence = project.scenarios.find(s => s.key === "purchase")!.spatialEvidence!;
    expect(evidence.assessment.status).toBe("OK");
    expect(evidence.summary.achievedPerH).toBeGreaterThanOrEqual(evidence.summary.requiredPerH);
    const purchase = results.results.find(result => result.key === "purchase");
    if (purchase?.status !== "ok") throw new Error("Expected valid canonical financial result");
    expect(purchase.items[0]).toMatchObject({ n: 6, chargers: 2 });
    expect(purchase.npvRub).toBeGreaterThan(0);
    expect(evidence.sourceInputKey).toBe(simInputIdentity(input));
    expect(results.sim.purchase).toMatchObject({ fleet: 6, verdict: "CONFIRMED", achievedPerH: evidence.summary.achievedPerH });
    const standalone = calculateCase("steady-flow");
    expect(simInputIdentity(standalone.financialSourceInput!)).toBe(evidence.sourceInputKey);
    expect(standalone.input).toMatchObject({ demoIncidents: { enabled: false }, layout: { chargers: 2 } });
    expect(standalone.assessment.status).toBe(evidence.assessment.status);
    expect(standalone.summary).toMatchObject(evidence.summary);
  }, 30_000);

  it("rechecks a comparison candidate before using its N/C in the shared financial engine", async () => {
    // This identity/recheck test needs a terminal run, not the full capacity proof above.
    const resolve = norms.resolveNorms;
    const shortWindow = vi.spyOn(norms, "resolveNorms").mockImplementation((...args) => ({ ...resolve(...args), simWarmupMin: 0, simPeakMin: 2 }));
    try {
    const reference = calculateCase("baseline", { fleet: 3, areaM2: 5000 });
    const comparison = await compareWarehouseFleet(reference, { maxFleet: 2 });
    const candidate = applyFleetComparison(reference, comparison, 1), before = structuredClone(candidate);
    expect(candidate.financialSourceInput!.robots.count).toBe(3);
    const verified = recheckSpatialFinanceInput(candidate);
    expect(candidate).toEqual(before);
    expect(verified.financialSourceInput!.robots.count).toBe(1);
    expect(verified.summary.fleet).toBe(1);
    expect(verified).not.toHaveProperty("comparisonOrigin");
    expect(verified.summary.requiredPerH).toBe(reference.summary.requiredPerH);
    expect(verified.input.layout.chargers).toBe(candidate.input.layout.chargers);
    const finance = calculateSpatialFinance(verified, { annualCoverageShare: 0.2, cashRealizationShare: 0.5 });
    expect(finance.purchase.items[0]!.n).toBe(1);
    expect(finance.assumptions.spatialMatchesFinancialInput).toBe(true);
    expect(finance.assumptions.sourceInputKey).toBe(simInputIdentity(verified.financialSourceInput!));
    expect(finance.model.scenarios.find(s => s.key === "purchase")!.spatialEvidence!.summary).toEqual({ fleet: 1, requiredPerH: verified.summary.requiredPerH, achievedPerH: verified.summary.achievedPerH, queueEnd: verified.summary.queueEnd, waitP95Min: verified.summary.waitP95Min });
    } finally { shortWindow.mockRestore(); }
  });
});
