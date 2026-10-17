import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DecisionSummary } from "../../components/project/decision-summary";
import { paramSpecsFor } from "../data/organizer/params";
import { simInputIdentity } from "../sim/identity";
import { SPATIAL_MODEL_VERSION } from "../sim/spatial-bridge";
import { buildProjectModel, type ProjectModel } from "./model";
import { FIXTURE_H1500, WAREHOUSE_BASE_PARAMS, fixtureSpecs } from "./econ/fixtures";
import { resolveNorms } from "./norms";
import { buildDecision } from "./decision";
import type { ScenarioOk, SpatialEvidence } from "./types";

function model(patch: Partial<Parameters<typeof buildProjectModel>[0]> = {}) {
  return buildProjectModel({ facility: "warehouse", params: { ...WAREHOUSE_BASE_PARAMS }, paramDefs: paramSpecsFor("warehouse"), products: [FIXTURE_H1500], scenarios: fixtureSpecs(), norms: resolveNorms(), ...patch });
}

function evidence(m: ProjectModel, status: SpatialEvidence["assessment"]["status"] = "OK") {
  const input = structuredClone(m.simInputs.p1!.calculated!);
  const e: SpatialEvidence = { sourceInputKey: simInputIdentity(input), executionInputKey: "separately-prepared-input", simModelVersion: SPATIAL_MODEL_VERSION, input,
    assessment: { status, headline: status === "OK" ? "Критерии выполнены" : "Выходной поток недостаточен", terminal: true },
    summary: { fleet: input.robots.count, requiredPerH: input.demand.peakPerH, achievedPerH: status === "OK" ? input.demand.peakPerH : 70, queueEnd: status === "OK" ? 0 : 80, waitP95Min: status === "OK" ? 2 : 20 } };
  m.scenarios.find(s => s.key === "p1")!.spatialEvidence = e;
  return input;
}

function profitable(m: ProjectModel) {
  const r = m.results.find(r => r.key === "p1") as ScenarioOk;
  r.npvRub = 1_000_000; r.discountedPaybackYears = 2;
  return r;
}

describe("one selected technical-economic decision", () => {
  it("keeps the explicitly selected financial scenario instead of silently substituting a recommendation", () => {
    const m = model(); m.conclusion.recommendedScenarioKey = "r1";
    const d = buildDecision(m, "p1"), p = m.results.find(r => r.key === "p1") as ScenarioOk;
    expect(d.scenarioKey).toBe("p1"); expect(d.scenarioName).toBe(p.name);
    expect(d.finance).toMatchObject({ capexRub: p.capexRub, opexYearRub: p.opexYearRub, effectYearRub: p.effectYearRub, npvRub: p.npvRub, paybackYears: p.paybackYears });
    expect(buildDecision(m).scenarioKey).toBe("r1");
    expect(buildDecision(m, "removed-scenario")).toMatchObject({ status: "missing", finance: null });
    m.conclusion.recommendedScenarioKey = "missing";
    expect(buildDecision(m).scenarioKey).toBe("p1");
  });

  it("never turns analytical full coverage or a saved OK into current spatial proof without expected input", () => {
    const m = model(); profitable(m); evidence(m);
    const d = buildDecision(m, "p1");
    expect(d.processes[0]!.analyticCoverage).toBe(1);
    expect(d.spatial.state).toBe("unverified"); expect(d.status).toBe("unverified");
    expect(d.pilot.applicable).toBe(false); expect(d.spatial.evidence!.summary.achievedPerH).toBeGreaterThan(0);
  });

  it("does not call a profitable but freshly failed flow suitable or manufacture a financial reduction", () => {
    const m = model(), p = profitable(m), input = evidence(m, "PARTIAL"), before = structuredClone(m);
    const d = buildDecision(m, "p1", input);
    expect(d.status).toBe("partial"); expect(d.spatial.state).toBe("fresh");
    expect(d.finance!.npvRub).toBe(p.npvRub); expect(d.finance!.effectYearRub).toBe(p.effectYearRub);
    expect(d.pilot.applicable).toBe(false); expect(d.nextAction).not.toContain("докупить");
    expect(m).toEqual(before);
  });

  it("requires both current model flow and existing financial viability for a suitable conclusion", () => {
    const m = model(), p = profitable(m), input = evidence(m);
    expect(buildDecision(m, "p1", input).status).toBe("suitable");
    p.npvRub = -1;
    expect(buildDecision(m, "p1", input).status).toBe("financial-limit");
    p.npvRub = 1; p.discountedPaybackYears = null;
    expect(buildDecision(m, "p1", input).status).toBe("financial-limit");
  });

  it("invalidates evidence on charger changes at the sameN, explicit stale form and model stale risk", () => {
    const m = model(); profitable(m); const input = evidence(m);
    const changed = { ...input, layout: { ...input.layout, chargers: input.layout.chargers + 1 } };
    expect(buildDecision(m, "p1", changed)).toMatchObject({ status: "unverified", spatial: { state: "stale" } });
    expect(buildDecision(m, "p1", input, true)).toMatchObject({ status: "stale", spatial: { state: "stale" } });
    (m.results.find(r=>r.key==='p1') as ScenarioOk).risks.push({ code: "SPATIAL_STALE", severity: "high", text: "Прежняя проверка" });
    expect(buildDecision(m, "p1", input).status).toBe("unverified");
  });

  it("separates a model rule failure and an unknown result from technical suitability", () => {
    const m = model(); profitable(m); const input = evidence(m, "FAIL");
    expect(buildDecision(m, "p1", input).status).toBe("invalid");
    m.scenarios.find(s=>s.key==='p1')!.spatialEvidence!.assessment.status = "NOT_EVALUATED";
    expect(buildDecision(m, "p1", input)).toMatchObject({ status: "unverified", spatial: { metrics: null } });
    expect(buildDecision(m, "p1", input).pilot.applicable).toBe(false);
  });

  it("does not override a contradictory flow result or excluded applicability with a spatial OK", () => {
    const m = model(), p = profitable(m), input = evidence(m);
    p.risks.push({ code: "SIM_NOT_CONFIRMED", severity: "high", text: "Другая имитация не выполнила поток" });
    expect(buildDecision(m, "p1", input)).toMatchObject({ status: "partial", pilot: { applicable: false } });
    p.risks = [{ code: "MANUAL_ADD", severity: "high", text: "Подбор исключил технику" }];
    expect(buildDecision(m, "p1", input)).toMatchObject({ status: "invalid", pilot: { applicable: false } });
  });

  it("renders an unavailable server result as unassessed, never as measured zero throughput or an empty queue", () => {
    const m = model(), input = evidence(m, "NOT_EVALUATED");
    const stored = m.scenarios.find(s=>s.key==='p1')!.spatialEvidence!;
    stored.summary.achievedPerH = 0; stored.summary.queueEnd = 0; stored.summary.waitP95Min = 0;
    const html = renderToStaticMarkup(createElement(DecisionSummary, { model: m, scenarioKey: "p1", expectedInput: input }));
    expect(html).toContain("Доставленный поток, очередь и ожидание — не оценены");
    expect(html).not.toContain("Актуальная проверка этого входа");
    expect(html).not.toContain("0 заданий");
    expect(html).not.toContain("0,0 мин</dd>");
  });

  it("exposes actual labour and operational assumptions without presenting the estimate as a fixed fact", () => {
    const specs = fixtureSpecs(); specs.find(s=>s.key==='p1')!.normOverrides = { laborShareAutomatable: .3 };
    const d = buildDecision(model({ scenarios: specs }), "p1");
    expect(d.analyticAssumptions).toMatchObject({ laborShare: .3, laborSource: "задано в сценарии" });
    expect(buildDecision(model(), "p1").analyticAssumptions.laborSource).toBe("Оценка");
  });

  it("shows unchanged physical FTE separately from zero monetary realization and the actual labour cash result", () => {
    const specs = fixtureSpecs(); const noCash = structuredClone(specs); noCash.find(s=>s.key==='p1')!.cashRealizationShare = 0;
    const full = buildDecision(model({ scenarios: specs }), "p1"), zero = buildDecision(model({ scenarios: noCash }), "p1");
    expect(zero.cashRealizationShare).toBe(0); expect(zero.cashRealizationExplicit).toBe(true);
    expect(zero.processes[0]!.releasedFte).toBe(full.processes[0]!.releasedFte);
    expect(zero.processes[0]!.releasedFte).toBeGreaterThan(0);
    expect(zero.processes[0]!.remainingWorkFte).toBe(full.processes[0]!.remainingWorkFte);
    expect(zero.processes[0]!.remainingLabourRub).toBeGreaterThan(full.processes[0]!.remainingLabourRub);
    expect(zero.finance!.effectYearRub).toBeLessThan(full.finance!.effectYearRub);
    expect(full.cashRealizationShare).toBe(1); expect(full.cashRealizationExplicit).toBe(false);
  });

  it("keeps analytic coverage apart from a conservative annual coverage assumption and uses the actual horizon", () => {
    const specs = fixtureSpecs(); specs.find(s=>s.key==='p1')!.items[0]!.automationCoverageOverride = .4;
    const d = buildDecision(model({ scenarios: specs, params: { ...WAREHOUSE_BASE_PARAMS, horizonYears: 8 } }), "p1");
    expect(d.processes[0]!.analyticCoverage).toBe(1);
    expect(d.processes[0]!.financialCoverage).toBe(.4); expect(d.processes[0]!.coverageOverridden).toBe(true);
    expect(d.horizonYears).toBe(8);
  });

  it("separates the requested annual share from a lower analytic limit actually used in money", () => {
    const specs = fixtureSpecs(), item = specs.find(s=>s.key==='p1')!.items[0]!;
    item.quantityOverride = 1; item.automationCoverageOverride = .75;
    const p = buildDecision(model({ scenarios: specs }), "p1").processes[0]!;
    expect(p.annualCoverageShare).toBe(.75);
    expect(p.analyticCoverage).toBeLessThan(.75);
    expect(p.financialCoverage).toBe(p.analyticCoverage);
    expect(p.financialCoverage).not.toBe(p.annualCoverageShare);
  });

  it("retains a refusal as uncalculated instead of zero money or an automatic pilot", () => {
    const m = model({ params: { ...WAREHOUSE_BASE_PARAMS, horizonYears: 0 } });
    const d = buildDecision(m, "p1");
    expect(d.status).toBe("refused"); expect(d.finance).toBeNull(); expect(d.horizonYears).toBeNull();
    expect(d.pilot.applicable).toBe(false); expect(d.pilot.budgetNote).toContain("не означают нулевой");
  });
});
