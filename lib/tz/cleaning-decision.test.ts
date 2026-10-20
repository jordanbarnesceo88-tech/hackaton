import { describe, expect, it } from "vitest";
import { paramSpecsFor } from "../data/organizer/params";
import { TEST_CLEANER, cleaningContext, cleaningSpecs } from "./econ/cleaning-fixtures";
import { FIXTURE_PRODUCTS, fixtureSpecs } from "./econ/fixtures";
import { buildConclusion } from "./econ/conclusion";
import { buildDecision } from "./decision";
import { buildProjectModel } from "./model";
import type { ScenarioOk } from "./types";

function example() {
  const ctx = cleaningContext();
  const model = buildProjectModel({ facility: "warehouse", params: ctx.params, norms: { ...ctx.norms, reservePct: 0, utilization: .1, availability: .1 },
    products: [TEST_CLEANER, ...FIXTURE_PRODUCTS], paramDefs: paramSpecsFor("warehouse"), scenarios: cleaningSpecs() });
  const result = model.results.find(row => row.key === "c1");
  if (result?.status !== "ok") throw new Error(JSON.stringify(result));
  return { model, result, ctx };
}

describe("financial decision from a cleaning schedule is an explicit forecast", () => {
  it("uses the daily capacity without repeated downtime and never claims verified spatial or pilot success", () => {
    const { model, result } = example();
    result.npvRub = 1000000; result.discountedPaybackYears = 2;
    const before = structuredClone(model), decision = buildDecision(model, "c1");
    expect(decision).toMatchObject({ status: "partial", verification: { kind: "schedule", supported: true, verified: false, isForecast: true,
      metrics: { fleet: 2, achievedPerH: 550, requiredPerH: 550, queueEnd: null, waitP95Min: null } }, pilot: { applicable: true } });
    expect(decision.processes[0]).toMatchObject({ cleaning: true, effectiveUtilization: 1, effectiveAvailability: 1, analyticCoverage: 1 });
    expect(decision.analyticAssumptions).toMatchObject({ utilization: 1, availability: 1, laborShare: .5 });
    expect(decision.analyticAssumptions.laborSource).toContain("рабочий профиль");
    expect(decision.headline).toContain("Условный кандидат");
    expect(decision.nextAction).toContain("не подтверждение 2D/3D");
    expect(decision.nextAction).toContain("качество");
    expect(model).toEqual(before);
    expect(buildDecision(model, "c1", null, true).status).toBe("stale");
  });
  it("shows a negative financial result as a financial limit rather than an unsupported model", () => {
    const { model, result } = example(); result.npvRub = -1;
    const decision = buildDecision(model, "c1");
    expect(decision.status).toBe("financial-limit"); expect(decision.finance!.npvRub).toBe(-1);
    expect(decision.verification.verified).toBe(false); expect(decision.pilot.applicable).toBe(false);
    expect(decision.headline).not.toContain("не поддерживается");
  });
  it("explains the daily area deficit and keeps conservative annual coverage separate from physical capacity", () => {
    const { model, result } = example(); result.npvRub = 1000000; result.discountedPaybackYears = 2;
    result.items[0]!.n = 1; result.items[0]!.coverage = .5;
    const deficit = buildDecision(model, "c1");
    expect(deficit.status).toBe("partial"); expect(deficit.pilot.applicable).toBe(false);
    expect(deficit.nextAction).toContain("2\u00a0200,0 м²/день");
    result.items[0]!.n = 2; result.items[0]!.coverage = .4;
    model.scenarios[1]!.items[0]!.automationCoverageOverride = .4;
    const annual = buildDecision(model, "c1");
    expect(annual.processes[0]!.analyticCoverage).toBe(1);
    expect(annual.processes[0]!.financialCoverage).toBe(.4);
    expect(annual.nextAction).toContain("годового охвата");
    expect(annual.nextAction).not.toContain("дефицит");
  });
  it("retains a compound scenario outside a single transport receipt's confirmation scope", () => {
    const { model, result } = example();
    const ctx = cleaningContext(), scenarios = fixtureSpecs();
    scenarios[1]!.items.push({ ...model.scenarios[1]!.items[0]! });
    const mixed = buildProjectModel({ facility: "warehouse", params: ctx.params, norms: ctx.norms,
      products: [TEST_CLEANER, ...FIXTURE_PRODUCTS], paramDefs: paramSpecsFor("warehouse"), scenarios });
    const decision = buildDecision(mixed, "p1", mixed.simInputs.p1?.calculated);
    expect(decision.verification.kind).toBe("unsupported"); expect(decision.verification.verified).toBe(false);
    expect(decision.nextAction).toContain("не подтверждает весь состав");
    result.npvRub = 1000000; result.discountedPaybackYears = 2;
    const conclusion = buildConclusion(model.results, ctx);
    expect(conclusion.recommendedScenarioKey).toBe("c1");
    expect(conclusion.headline).toContain("финансовый выбор");
    expect(conclusion.bullets.join(" ")).toContain("расписание является прогнозом");
    expect(conclusion.bullets.join(" ")).toContain("измерительного пилота");
    const nonBaseline = model.results.filter((row): row is ScenarioOk => row.status === "ok" && row.kind !== "asis");
    expect(nonBaseline).toHaveLength(1);
  });
});
