import { describe, expect, it } from "vitest";
import { calculateProjectPreview } from "../../experiments/warehouse-3d/project-input";
import { productForCalcFromSeed } from "../catalog/product-for-calc";
import { CATALOG } from "../data/organizer/catalog";
import { baseValuesFor, paramSpecsFor } from "../data/organizer/params";
import { businessExampleInputs } from "../projects/business-examples";
import { simInputIdentity } from "../sim/identity";
import { createSpatialProjectSnapshot } from "../sim/spatial-bridge";
import { runSimSync } from "../sim/runner";
import { buildProjectModel } from "./model";
import { resolveNorms } from "./norms";
import type { SpatialEvidence } from "./types";

describe("рекомендация и актуальная проверка потока", () => {
  it("положительная финансовая оценка не перекрывает реальный PARTIAL closed-pod; stale не выдаётся за проверку", () => {
    const products = CATALOG.map(productForCalcFromSeed);
    const example = businessExampleInputs("steady-flow", baseValuesFor("warehouse"), products);
    const scenarios = example.scenarios.filter(s => s.kind !== "raas");
    scenarios.forEach(spec => spec.items.forEach(item => { item.quantityOverride = 5; }));
    const key = "purchase";
    const input = {
      facility: "warehouse",
      params: example.params,
      paramDefs: paramSpecsFor("warehouse"), products, scenarios,
      // A bounded actual physical replay proves recommendation gating, not steady-state capacity.
      norms: { ...resolveNorms(), simWarmupMin: 0, simPeakMin: 3 },
    };
    const base = buildProjectModel(input), physical = base.simInputs[key]?.calculated;
    if (!physical) throw new Error("Нет входа проверки контрольного парка");
    const financial = base.results.find(r => r.key === key);
    expect(financial?.status).toBe("ok");
    if (financial?.status !== "ok") throw new Error("Контрольная экономика не рассчитана");
    expect(financial.npvRub).toBeGreaterThan(0);
    expect(physical.transportWorkflow).toBe("closed-pod-1");
    expect(() => runSimSync(physical)).toThrow(/пространственную проверку/);
    const actual = calculateProjectPreview(createSpatialProjectSnapshot({ requestId: "recommendation-test",
      scenarioKey: key, scenarioName: scenarios[1]!.name, variantId: "calculated", input: physical }));
    expect(actual.assessment.status, JSON.stringify(actual.assessment)).toBe("PARTIAL");
    expect(actual.summary.fleet).toBe(5);
    expect(actual.summary.achievedPerH).toBeLessThan(physical.demand.peakPerH);
    const proof: SpatialEvidence = { input: physical, sourceInputKey: simInputIdentity(physical),
      executionInputKey: simInputIdentity(actual.input), simModelVersion: actual.simModelVersion,
      assessment: { status: actual.assessment.status as "PARTIAL", headline: actual.assessment.headline, terminal: true },
      summary: { fleet: actual.summary.fleet, requiredPerH: actual.summary.requiredPerH,
        achievedPerH: actual.summary.achievedPerH, queueEnd: actual.summary.queueEnd, waitP95Min: actual.summary.waitP95Min } };
    const withProof = structuredClone(scenarios); withProof[1]!.spatialEvidence = proof;
    const fresh = buildProjectModel({ ...input, scenarios: withProof });
    const result = fresh.results.find(r => r.key === key);
    expect(result?.status).toBe("ok");
    if (result?.status !== "ok") throw new Error("Контрольная экономика не рассчитана");
    expect(result.npvRub).toBeGreaterThan(0);
    expect(result.risks.some(r => r.code === "SIM_NOT_CONFIRMED")).toBe(true);
    expect(fresh.conclusion.recommendedScenarioKey).toBeNull();
    expect(fresh.conclusion.headline).toContain("не подтвердили заданную нагрузку");
    expect(fresh.conclusion.headline).not.toContain("не окупается");
    expect(fresh.conclusion.bullets.some(b => b.startsWith("При горизонте"))).toBe(false);

    const old = structuredClone(withProof); old[1]!.spatialEvidence!.sourceInputKey = "stale";
    const stale = buildProjectModel({ ...input, scenarios: old });
    expect(stale.results.find(r => r.key === key)?.risks.some(r => r.code === "SPATIAL_STALE")).toBe(true);
    expect(stale.results.find(r => r.key === key)?.risks.some(r => r.code === "SIM_NOT_CONFIRMED")).toBe(false);
    expect(stale.conclusion.recommendedScenarioKey).toBeNull();
    const staleResult = stale.results.find(r => r.key === key);
    expect(staleResult?.status === "ok" && staleResult.npvRub).toBe(financial.npvRub);
    expect(stale.conclusion.bullets.join(" ")).toContain("устарела");
    expect(stale.conclusion.headline).not.toContain("подтверждён");
  });
});
