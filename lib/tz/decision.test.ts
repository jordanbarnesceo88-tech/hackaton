import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DecisionSummary } from "../../components/project/decision-summary";
import { paramSpecsFor } from "../data/organizer/params";
import { simInputIdentity } from "../sim/identity";
import { SPATIAL_MODEL_VERSION } from "../sim/spatial-bridge";
import { buildProjectModel, type ProjectModel } from "./model";
import { FIXTURE_CARRIER_P, FIXTURE_H1500, WAREHOUSE_BASE_PARAMS, fixtureSpecs } from "./econ/fixtures";
import { runSimSync } from "../sim/runner";
import { toStored } from "../sim/metrics";
import { SIM_MODEL_VERSION } from "../sim/types";
import { normDef, resolveNorms } from "./norms";
import { buildDecision } from "./decision";
import type { OperatingEvidence } from "../catalog/operating-evidence";
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
  it.each(["shift-hour", "operating-hour", "expired", "unconfirmed"] as const)("shows coverage from the real financial calculation without repeated downtime: %s", basis => {
    const observation: OperatingEvidence = {
      schemaVersion: "operating-evidence-1", productSlug: FIXTURE_H1500.slug, process: "pallet-transport", facility: "warehouse",
      mode: "transport", unit: "паллет/ч", site: "Синтетический участок теста", measuredAt: "2026-10-01", verifiedAt: "2026-10-02", validUntil: "2026-11-01",
      sourceRef: "Синтетический журнал теста", measuredBy: "Тест", samples: 3, output: 20, operatingMinutes: 60, elapsedMinutes: 120,
      basis: basis === "operating-hour" ? "operating-hour" : "shift-hour", confirmed: true,
    };
    const product = { ...FIXTURE_H1500, operatingEvidence: observation, operatingEvidenceConfirmed: basis !== "unconfirmed",
      operatingEvidenceEvaluatedOn: basis === "expired" ? "2026-12-01" : "2026-10-18" };
    const specs = fixtureSpecs(), purchase = specs.find(s => s.key === "p1")!;
    purchase.normOverrides = { utilization: .7, availability: .9 };
    Object.assign(purchase.items[0]!, { operatingMode: "transport", quantityOverride: 1, automationCoverageOverride: .02 });
    const m = model({ products: [product], scenarios: specs });
    const result = m.results.find(r => r.key === "p1")!;
    if (result.status !== "ok") throw new Error(result.refusal.message);
    const item = result.items[0]!, d = buildDecision(m, "p1"), process = d.processes[0]!;
    const shiftApplied = basis === "shift-hour", U = shiftApplied ? 1 : .7, A = shiftApplied ? 1 : .9;
    expect(item.thrEvidence?.applied).toBe(basis === "shift-hour" || basis === "operating-hour");
    expect(process).toMatchObject({ shiftHourObservation: shiftApplied, effectiveUtilization: U, effectiveAvailability: A });
    expect(process.analyticCoverage).toBeCloseTo(item.n! * item.thrEff! * U * A / item.peakPerHour, 12);
    expect(process.analyticCoverage).toBeLessThan(1);
    expect(process.analyticCoverage).toBeGreaterThan(.02);
    expect(process.financialCoverage).toBe(.02);
    expect(process.annualCoverageShare).toBe(.02);
    const html = renderToStaticMarkup(createElement(DecisionSummary, { model: m, scenarioKey: "p1" }));
    expect(html.includes("Простои уже включены в выработку за час смены")).toBe(shiftApplied);
  });

  it("does not show productive coverage or applied shift factors for a refused zero-output observation", () => {
    const observation: OperatingEvidence = {
      schemaVersion: "operating-evidence-1", productSlug: FIXTURE_H1500.slug, process: "pallet-transport", facility: "warehouse",
      mode: "transport", unit: "паллет/ч", site: "Синтетический участок теста", measuredAt: "2026-10-01", verifiedAt: "2026-10-02",
      sourceRef: "Синтетический журнал теста", measuredBy: "Тест", samples: 3, output: 0, operatingMinutes: 60, elapsedMinutes: 120, basis: "shift-hour", confirmed: true,
    };
    const specs = fixtureSpecs(); specs.find(s => s.key === "p1")!.items[0]!.operatingMode = "transport";
    const m = model({ products: [{ ...FIXTURE_H1500, operatingEvidence: observation, operatingEvidenceConfirmed: true, operatingEvidenceEvaluatedOn: "2026-10-18" }], scenarios: specs });
    expect(buildDecision(m, "p1")).toMatchObject({ status: "refused", processes: [], finance: null });
    const html = renderToStaticMarkup(createElement(DecisionSummary, { model: m, scenarioKey: "p1" }));
    expect(html).not.toContain("Простои уже включены в выработку за час смены");
  });

  it("uses a current single-leg 2D receipt without requesting an unrelated underlift 3D proof", () => {
    const m = model({ products: [FIXTURE_CARRIER_P], scenarios: fixtureSpecs(FIXTURE_CARRIER_P) });
    profitable(m);
    const input = m.simInputs.p1!.calculated!;
    expect(input.transportWorkflow).toBe("single-leg-pallet-1");
    const summary = { ...toStored(runSimSync(input)), scenarioKey: "p1" };
    expect(summary.verdict).toBe("CONFIRMED");
    const d = buildDecision(m, "p1", input, false, summary);
    expect(d).toMatchObject({ status: "suitable", verification: { kind: "analytical", supported: true }, spatial: { evidence: null } });
    expect(d.headline).toContain("аналитической 2D-модели");
    const html = renderToStaticMarkup(createElement(DecisionSummary, { model: m, scenarioKey: "p1", expectedInput: input, simSummary: summary, onSimulation() {} }));
    expect(html).toContain("Открыть аналитическую имитацию");
    expect(html).not.toContain("Открыть прогон в 3D");
    expect(html).toContain("пространственная безопасность этим прогоном не подтверждаются");
    expect(buildDecision(m, "p1", input, false, { ...summary, verdict: "NOT_CONFIRMED" })).toMatchObject({ status: "partial", pilot: { applicable: false } });
    for (const receipt of [{ ...summary, inputKey: undefined }, { ...summary, simModelVersion: "old-model" }, { ...summary, scenarioKey: "other" }]) {
      expect(buildDecision(m, "p1", input, false, receipt)).toMatchObject({ status: "unverified", verification: { analytical: null } });
    }
    expect(buildDecision(m, "p1", { ...input, seed: input.seed + 1 }, false, summary).status).toBe("unverified");
    expect(buildDecision(m, "p1", input, true, summary).status).toBe("stale");
    expect(summary.simModelVersion).toBe(SIM_MODEL_VERSION);
  });

  it("keeps unsupported processes and compound scenarios outside a single receipt's confirmation scope", () => {
    const unsupported = model(); profitable(unsupported);
    const noInput = buildDecision(unsupported, "p1", null);
    expect(noInput).toMatchObject({ status: "unsupported", verification: { supported: false }, pilot: { applicable: false } });
    const html = renderToStaticMarkup(createElement(DecisionSummary, { model: unsupported, scenarioKey: "p1", expectedInput: null, onSimulation() {} }));
    expect(html).toContain("Проверка нагрузки не поддерживается");
    expect(html).not.toContain("Открыть проверку сценария");
    expect(html).not.toContain("Открыть прогон в 3D");
    const mixed = model(); profitable(mixed); const input = evidence(mixed);
    mixed.scenarios.find(s => s.key === "p1")!.items.push({ ...mixed.scenarios.find(s => s.key === "p1")!.items[0]! });
    expect(buildDecision(mixed, "p1", input)).toMatchObject({ status: "unsupported", pilot: { applicable: false } });
    expect(buildDecision(mixed, "p1", input).nextAction).toContain("не подтверждает весь состав");
  });
  it("prioritizes resolving a failed flow before a pilot and keeps key financial results visible", () => {
    const m = model(), input = evidence(m, "PARTIAL");
    const html = renderToStaticMarkup(createElement(DecisionSummary, { model: m, scenarioKey: "p1", expectedInput: input,
      onSimulation() {}, onCompare() {}, onPilot() {} }));
    expect(html).toContain('data-decision-status="partial"');
    expect(html).toContain("Есть ограничения");
    expect(html.indexOf("Разобрать ограничения в 3D")).toBeLessThan(html.indexOf("Составить план и бюджет пилота"));
    expect(html).toContain("Чистый эффект в год");
    expect(html).toContain("Простая окупаемость");
    expect(html).toContain("NPV");
  });
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

  it("reports an actual waiting or queue limit without claiming that sufficient output was insufficient", () => {
    const m = model(), input = evidence(m, "PARTIAL"), stored = m.scenarios.find(s => s.key === "p1")!.spatialEvidence!;
    stored.summary.achievedPerH = stored.summary.requiredPerH + 1;
    stored.summary.queueEnd = 0; stored.summary.waitP95Min = input.thresholds.p95WaitMaxMin + 1;
    const wait = buildDecision(m, "p1", input);
    expect(wait.headline).toBe("Заданный выпуск достигнут; превышено ожидание до начала обработки");
    expect(wait.nextAction).toContain("Ожидание до начала обработки p95:");
    expect(wait.spatial.partialFacts).toHaveLength(2);
    expect(wait.nextAction).not.toContain("Парк не выполняет");
    stored.summary.waitP95Min = input.thresholds.p95WaitMaxMin;
    stored.summary.queueEnd = 100;
    const queue = buildDecision(m, "p1", input);
    expect(queue.headline).toBe("Заданный выпуск достигнут; превышена допустимая очередь");
    expect(queue.nextAction).toContain("Очередь в конце: 100 при пределе");
    expect(queue.nextAction).not.toContain("Ожидание до начала обработки p95:");
  });

  it("does not invent a missing SLA or energy metric when a PARTIAL receipt has no failed visible threshold", () => {
    const m = model(), input = evidence(m, "PARTIAL"), stored = m.scenarios.find(s => s.key === "p1")!.spatialEvidence!;
    stored.summary.achievedPerH = stored.summary.requiredPerH;
    stored.summary.queueEnd = 0; stored.summary.waitP95Min = 0;
    stored.assessment.headline = "Прогон завершён с ограничением: критерии приёма заданий.";
    const d = buildDecision(m, "p1", input);
    expect(d.headline).toBe("Часть критериев пространственной модели не выполнена");
    expect(d.nextAction).toContain(stored.assessment.headline);
    expect(d.spatial.partialFacts).toHaveLength(1);
    expect(d.nextAction).not.toContain("SOC"); expect(d.nextAction).not.toContain("нехват");
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

  it("uses the recorded labour origin after the current normative definition changes", () => {
    const saved = model(), definition = normDef("laborShareAutomatable"), origin = definition.origin;
    const recorded = JSON.stringify(saved);
    try {
      definition.origin = "research";
      expect(buildDecision(saved, "p1").analyticAssumptions.laborSource).toBe("Оценка");
      expect(JSON.stringify(saved)).toBe(recorded);
    } finally { definition.origin = origin; }
  });

  it("marks a missing archived labour source rather than adopting the current definition", () => {
    const saved = model();
    delete saved.methodologySnapshot!.normDefinitions;
    expect(buildDecision(saved, "p1").analyticAssumptions.laborSource).toBe("источник не сохранён");
    saved.scenarios.find(scenario => scenario.key === "p1")!.normOverrides = { laborShareAutomatable: 0.1 };
    expect(buildDecision(saved, "p1").analyticAssumptions.laborSource).toBe("задано в сценарии");
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
