import { describe, expect, it } from "vitest";
import { simInputIdentity } from "../../lib/sim/identity";
import { calculateCase } from "./core";
import { buildPilotPlan } from "./pilot";
import { warehouseBaseInput } from "../../lib/sim/fixtures";
import { createSpatialProjectSnapshot } from "../../lib/sim/spatial-bridge";
import { calculateProjectPreview } from "./project-input";

describe("model evidence to pilot plan", () => {
  it("keeps an incomplete warehouse result as a measurement pilot with exact failed criteria", () => {
    const input = warehouseBaseInput(1, { demand: { avgPerH: 30, peakPerH: 30, warmupMin: 0, peakMin: 1 } });
    input.robots.handlingSec = 3600;
    const model = calculateProjectPreview(createSpatialProjectSnapshot({ requestId: "pilot-unit", scenarioKey: "purchase", scenarioName: "Bounded incomplete work", variantId: "calculated", input }));
    const before = structuredClone(model), plan = buildPilotPlan(model);
    expect(plan.mode).toBe("measure-and-resolve"); expect(plan.siteReadiness).toBe("NOT_EVALUATED");
    expect(plan.blockers.some(b => b.id === "throughput")).toBe(true);
    expect(plan.source.executionInputKey).toBe(simInputIdentity(model.input));
    expect(plan.economics.status).toBe("NOT_EVALUATED"); expect(plan.economics.requiredEvidence).toHaveLength(4);
    expect(plan.economics).not.toHaveProperty("npvRub"); expect(plan.economics).not.toHaveProperty("budgetRub");
    plan.blockers[0]!.evidence.push({ tS: 0 });
    expect(model).toEqual(before);
  });
  it("does not turn full modeled cleaning into verified site readiness or annual savings", () => {
    const model = calculateCase("sections", { areaM2: 1000, fleet: 2 }), plan = buildPilotPlan(model);
    expect(model.assessment.status).toBe("OK"); expect(plan.mode).toBe("verify-model-on-site");
    expect(plan.siteReadiness).toBe("NOT_EVALUATED"); expect(plan.economics.status).toBe("NOT_EVALUATED");
    expect(plan.acceptance.some(c => c.id === "section_tasks" && c.status === "PASS")).toBe(true);
    expect(plan.steps.join(" ")).toContain("качество уборки");
  });
});
