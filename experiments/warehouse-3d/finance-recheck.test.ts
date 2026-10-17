import { describe, expect, it } from "vitest";
import { calculateCase, recheckSpatialFinanceInput } from "./core";
import { applyFleetComparison, compareWarehouseFleet } from "./comparison";
import { calculateSpatialFinance } from "./finance";
import { simInputIdentity } from "../../lib/sim/identity";

describe("chosen fleet to canonical finance verification", () => {
  it("offers a passing reserve fleet on the unchanged organizer demand and carries its N/C into finance", () => {
    const reserve = calculateCase("capacity-reserve"), baseline = calculateCase("baseline");
    expect(reserve.financialSourceInput!.demand).toEqual(baseline.financialSourceInput!.demand);
    expect(reserve.financialSourceInput!.layout).toEqual(baseline.financialSourceInput!.layout);
    expect(reserve.financialSourceInput!.robots.count).toBe(14);
    expect(reserve.assessment.status).toBe("OK");
    expect(reserve.summary.achievedPerH).toBeGreaterThanOrEqual(reserve.summary.requiredPerH);
    expect(reserve.assessment.checks.filter(c => c.category === "safety").every(c => c.status === "PASS")).toBe(true);
    const finance = calculateSpatialFinance(reserve, { annualCoverageShare: 1, cashRealizationShare: 0.5 });
    expect(finance.purchase.items[0]).toMatchObject({ n: 14, chargers: reserve.input.layout.chargers });
    expect(finance.assumptions.spatialMatchesFinancialInput).toBe(true);
    expect(finance.model.scenarios.find(s => s.key === "purchase")!.spatialEvidence!.assessment.status).toBe("OK");
  });

  it("rechecks a comparison candidate before using its N/C in the shared financial engine", async () => {
    const reference = calculateCase("baseline", { fleet: 3 });
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
  });
});
