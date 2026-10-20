import { describe, expect, it } from "vitest";
import { buildDecision } from "./decision";
import { buildProjectModel } from "./model";
import { buildConclusion, horizonFlip, pickRecommended } from "./econ/conclusion";
import { cleaningContext, TEST_CLEANER, TEST_CLEANING_PROFILE } from "./econ/cleaning-fixtures";
import { paramSpecsFor } from "../data/organizer/params";
import type { CleaningPlan, ScenarioSpec } from "./types";

function example(partial = false, retainedCover = false) {
  const ctx = cleaningContext();
  ctx.products["second-cleaner"] = { ...TEST_CLEANER, slug: "second-cleaner", name: "Другая модель" };
  const profile = { ...TEST_CLEANING_PROFILE, workBeforeChargeH: 8, chargeH: 1, windowH: 2 };
  const plan: CleaningPlan = { schemaVersion: "cleaning-zones-1", source: "Синтетические допущения теста", disjointAreaReason: "Разные непересекающиеся помещения",
    robots: [{ id: "r1", productSlug: TEST_CLEANER.slug }, { id: "r2", productSlug: "second-cleaner" }], existingMachines: [],
    zones: [0, 1].map(i => ({ id: `zone-${i}`, name: `Зона ${i}`, floor: 1, areaM2: partial && i === 0 ? 2000 : 800, cleaningsPerDay: 1, windowStartH: i * 3, windowH: 2,
      baselineLabourHoursPerDay: 4, retainedLabourHoursPerDay: 2, manualThroughputM2PerH: retainedCover ? 200 : 100, existingMachineIds: [],
      assignments: [{ robotId: `r${i + 1}`, profile: { ...profile }, transferMin: 0, transferLabourMin: 0 }] })) };
  ctx.params.cleaningAreaM2 = plan.zones.reduce((sum, zone) => sum + zone.areaM2, 0);
  const specs: ScenarioSpec[] = [{ key: "asis", name: "Как есть", kind: "asis", items: [] },
    { key: "zones", name: "Комбинированный план", kind: "purchase", cleaningPlan: plan, items: plan.robots.map(r => ({ process: "cleaning", productSlug: r.productSlug, ...(retainedCover ? { automationCoverageOverride: .5 } : {}) })) }];
  const model = buildProjectModel({ facility: "warehouse", params: ctx.params, norms: ctx.norms, products: Object.values(ctx.products), paramDefs: paramSpecsFor("warehouse"), scenarios: specs });
  const result = model.results.find(row => row.key === "zones");
  if (result?.status !== "ok") throw new Error(JSON.stringify(result));
  result.npvRub = 1_000_000; result.discountedPaybackYears = 2;
  return { ctx, model, result, specs };
}

describe("mixed model cleaning plan decision", () => {
  it("uses the actual accepted daily plan output and unique fleet over the shared time span", () => {
    const { model } = example(), before = structuredClone(model), decision = buildDecision(model, "zones");
    expect(decision.verification).toMatchObject({ kind: "schedule", verified: false, isForecast: true,
      metrics: { fleet: 2, achievedPerH: 320, requiredPerH: 320, queueEnd: null, waitP95Min: null },
      cleaningPlan: { status: "full", coveredM2PerDay: 1600, demandM2PerDay: 1600, windowSpanH: 5 } });
    expect(decision.status).toBe("partial"); expect(decision.capacityCandidate).toBe(false);
    expect(decision.headline).toContain("Условный кандидат"); expect(decision.pilot.applicable).toBe(true);
    expect(decision.pilot.purpose).toContain("Пилот выбранной модели/зоны");
    expect(decision.nextAction).toContain("Явно выберите модель и зону пилота");
    expect(decision.nextAction).toContain("не подтверждение 2D/3D"); expect(model).toEqual(before);
  });
  it("does not demand robot-only 100% coverage when explicit retained work completes the zones", () => {
    const { model, result } = example(false, true), decision = buildDecision(model, "zones");
    expect(result.items.some(item => item.coverage < 1)).toBe(true);
    expect(decision.verification.cleaningPlan?.status).toBe("full");
    expect(decision.verification.cleaningPlan?.zones.some(zone => zone.manualCoveredM2PerDay > 0)).toBe(true);
    expect(decision.headline).toContain("Условный кандидат");
    expect(decision.verification.metrics?.achievedPerH).toBe(320);
  });
  it("never recommends a profitable plan with one deficient zone and preserves its real deficit", () => {
    const { model, ctx, result, specs } = example(true), decision = buildDecision(model, "zones");
    expect(result.risks).toContainEqual(expect.objectContaining({ code: "CLEANING_PLAN_PARTIAL", severity: "high" }));
    expect(pickRecommended(model.results)).toBeNull();
    expect(decision.verification.cleaningPlan?.status).toBe("partial");
    expect(decision.verification.metrics!.achievedPerH).toBeLessThan(decision.verification.metrics!.requiredPerH);
    expect(decision.nextAction).toContain("дефицит"); expect(decision.pilot.applicable).toBe(false);
    const conclusion = buildConclusion(model.results, ctx, specs);
    expect(conclusion.recommendedScenarioKey).toBeNull(); expect(conclusion.headline).toContain("план уборки не закрывает");
    expect(horizonFlip(ctx, specs)).toBeNull();
  });
  it("guards raw core-like results without relying solely on a previously saved risk", () => {
    const { model, ctx, result, specs } = example(true); result.risks = [];
    expect(buildConclusion(model.results, ctx, specs).recommendedScenarioKey).toBeNull();
  });
  it("keeps negative financial and stale results distinct from a full physical forecast", () => {
    const { model, result } = example(); result.npvRub = -1;
    expect(buildDecision(model, "zones")).toMatchObject({ status: "financial-limit", pilot: { applicable: false }, verification: { verified: false } });
    expect(buildDecision(model, "zones", null, true).status).toBe("stale");
  });
});
