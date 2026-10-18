import { describe, expect, it } from "vitest";
import { paramSpecsFor } from "../data/organizer/params";
import { validateScenarioSpecs } from "../projects/validate";
import { simInputIdentity } from "../sim/identity";
import { SPATIAL_MODEL_VERSION } from "../sim/spatial-bridge";
import { spatialEvidenceMatchesInput } from "../sim/spatial-evidence";
import { recheckProjectSpatialEvidence } from "../sim/spatial-server";
import { scenarioTableRows } from "../report/tz/rows";
import { buildDecision } from "./decision";
import { pickRecommended } from "./econ";
import { computeScenariosCore } from "./econ/core";
import { FIXTURE_H1500, fixtureContext, fixtureSpecs, WAREHOUSE_BASE_PARAMS } from "./econ/fixtures";
import { buildProjectModel, expectedSpatialInputFromStored, storedPartOf } from "./model";
import { resolveNorms } from "./norms";
import type { ScenarioOk, ScenarioResult, ScenarioSpec, SpatialEvidence } from "./types";

function ok(results: ScenarioResult[], key = "p1"): ScenarioOk {
  const result = results.find(r => r.key === key);
  if (!result || result.status !== "ok") throw new Error(JSON.stringify(result));
  return result;
}
function project(scenarios = fixtureSpecs()) {
  return buildProjectModel({ facility: "warehouse", params: { ...WAREHOUSE_BASE_PARAMS }, paramDefs: paramSpecsFor("warehouse"), scenarios, products: [FIXTURE_H1500], norms: resolveNorms() });
}
const original = project();
const source = original.simInputs.p1!.calculated!;
function evidence(status: SpatialEvidence["assessment"]["status"] = "OK"): SpatialEvidence {
  return { sourceInputKey: simInputIdentity(source), executionInputKey: "prepared-input-key", simModelVersion: SPATIAL_MODEL_VERSION,
    input: structuredClone(source), assessment: { status, headline: "Результат модельного прогона", terminal: true },
    summary: { fleet: source.robots.count, requiredPerH: source.demand.peakPerH, achievedPerH: 10, queueEnd: 5, waitP95Min: 3 } };
}
function withEvidence(value: SpatialEvidence): ScenarioSpec[] {
  return fixtureSpecs().map(s => s.key === "p1" ? { ...s, spatialEvidence: value } : s);
}
function validate(specs: unknown) {
  return validateScenarioSpecs(specs, "warehouse", [FIXTURE_H1500.slug], ["pallet-transport"]);
}

describe("пространственный сценарий использует существующие денежные потоки", () => {
  it("денежная реализация 0/0.5/1 меняет ФОТ и потоки, но не FTE, N и производительность", () => {
    const context = fixtureContext(20);
    const legacy = ok(computeScenariosCore(context, fixtureSpecs()));
    for (const share of [0, 0.5, 1]) {
      const specs = fixtureSpecs().map(s => s.kind === "asis" ? s : { ...s, cashRealizationShare: share });
      for (const key of ["p1", "r1"]) {
        const result = ok(computeScenariosCore(context, specs), key);
        const item = result.items[0]!;
        expect(item.releasedFte).toBe(legacy.items[0]!.releasedFte);
        expect(item.n).toBe(legacy.items[0]!.n);
        expect(item.thrEff).toBe(legacy.items[0]!.thrEff);
        expect(item.remainingLabourRub).toBeCloseTo(item.baselineLabourRub - item.releasedFte * item.roleCostRubYear * share, 6);
        expect(result.effectYearRub).toBeCloseTo(ok(computeScenariosCore(context, specs), "asis").opexYearRub - result.opexYearRub, 6);
      }
    }
    const explicitOne = ok(computeScenariosCore(context, fixtureSpecs().map(s => ({ ...s, cashRealizationShare: 1 }))));
    expect(explicitOne.cashflows).toEqual(legacy.cashflows);
    expect(explicitOne.npvRub).toBe(legacy.npvRub);
  });

  it("годовой охват ограничивает аналитическую долю, включая 0; не изменяет паспортную производительность", () => {
    const ctx = fixtureContext(20);
    const reference = ok(computeScenariosCore(ctx, fixtureSpecs()));
    for (const coverage of [0, 0.25, 1]) {
      const specs = fixtureSpecs().map(s => ({ ...s, items: s.items.map(i => ({ ...i, automationCoverageOverride: coverage })) }));
      const r = ok(computeScenariosCore(ctx, specs));
      expect(r.items[0]!.coverage).toBe(Math.min(reference.items[0]!.coverage, coverage));
      expect(r.items[0]!.thrEff).toBe(reference.items[0]!.thrEff);
      if (coverage === 0) { expect(r.items[0]!.releasedFte).toBe(0); expect(r.items[0]!.remainingLabourRub).toBe(r.items[0]!.baselineLabourRub); }
    }
  });

  it("фиксированные зарядки, включая 0, одинаковы в экономике и рассчитанном SimInput", () => {
    for (const chargers of [0, 3]) {
      const specs = fixtureSpecs().map(s => ({ ...s, items: s.items.map(i => ({ ...i, quantityOverride: 7, chargersOverride: chargers })) }));
      const model = project(specs);
      expect(ok(model.results).items[0]!.chargers).toBe(chargers);
      expect(model.simInputs.p1!.calculated!.layout.chargers).toBe(chargers);
      expect(model.simInputs.p1!.calculated!.robots.count).toBe(7);
      expect(model.simInputs.p1!.provenance!.find(p => p.field === "calc:chargers")!.origin).toBe("user");
      if (model.simInputs.p1!.byNorm) expect(model.simInputs.p1!.byNorm!.layout.chargers).toBe(chargers);
    }
  });

  it("вход ядра тоже отклоняет некорректные допущения без серверного валидатора", () => {
    for (const patch of [{ cashRealizationShare: NaN }, { cashRealizationShare: 2 }, { items: [{ ...fixtureSpecs()[1]!.items[0]!, chargersOverride: -1 }] }, { items: [{ ...fixtureSpecs()[1]!.items[0]!, automationCoverageOverride: Infinity }] }]) {
      const specs = fixtureSpecs().map(s => s.key === "p1" ? { ...s, ...patch } : s);
      expect(computeScenariosCore(fixtureContext(20), specs).find(r => r.key === "p1")?.status).toBe("refused");
    }
  });
});

describe("свежесть и сохранение полного доказательства 3D", () => {
  it.each(["PARTIAL", "FAIL", "NOT_EVALUATED"] as const)("актуальный %s запрещает рекомендацию", status => {
    const model = project(withEvidence(evidence(status)));
    const result = ok(model.results);
    expect(result.risks.some(r => r.code === "SIM_NOT_CONFIRMED")).toBe(true);
    expect(pickRecommended([result])).toBeNull();
    expect(model.conclusion.recommendedScenarioKey).not.toBe("p1");
  });

  it("актуальный OK принимается только с совпадающим source input; execution key отдельный", () => {
    const e = evidence();
    expect(spatialEvidenceMatchesInput(e, source)).toBe(true);
    expect(spatialEvidenceMatchesInput(e, undefined)).toBe(false);
    const r = ok(project(withEvidence(e)).results);
    expect(r.risks.some(r => ["SIM_NOT_CONFIRMED", "SPATIAL_STALE"].includes(r.code))).toBe(false);
  });

  it("устаревшие N/C/seed/input/version не становятся PASS и не рекомендуются", () => {
    for (const alter of [
      (e: SpatialEvidence) => { e.input.seed++; },
      (e: SpatialEvidence) => { e.input.layout.chargers++; e.sourceInputKey = simInputIdentity(e.input); },
      (e: SpatialEvidence) => { e.input.robots.count++; e.sourceInputKey = simInputIdentity(e.input); },
      (e: SpatialEvidence) => { e.simModelVersion = "old"; },
    ]) {
      const e = evidence(); alter(e);
      const r = ok(project(withEvidence(e)).results);
      expect(r.risks.some(r => r.code === "SPATIAL_STALE")).toBe(true);
      expect(pickRecommended([r])).toBeNull();
    }
  });

  it("JSON -> server validation -> stored results roundtrip сохраняет полный снимок без ссылок на caller", () => {
    const specs = withEvidence(evidence("PARTIAL"));
    specs[1]!.cashRealizationShare = 0;
    specs[1]!.items[0]!.automationCoverageOverride = 0.5;
    specs[1]!.items[0]!.chargersOverride = source.layout.chargers;
    const checked = validate(JSON.parse(JSON.stringify(specs)));
    expect(checked.ok).toBe(true);
    if (!checked.ok) throw new Error(checked.errors.join("; "));
    expect(checked.value[1]!.spatialEvidence!.input.transportWorkflow).toBe("closed-pod-1");
    const model = project(checked.value);
    const stored = JSON.parse(JSON.stringify(storedPartOf(model)));
    expect(stored.scenarios).toEqual(specs);
    expect(expectedSpatialInputFromStored(stored, "p1")).toEqual(model.simInputs.p1!.calculated);
    const rows = scenarioTableRows(stored);
    expect(rows.find(r => r.rowKey === "composition")!.cells[1]).toContain("годовой охват");
    expect(rows.find(r => r.rowKey === "composition")!.cells[1]).toContain("денежная реализация");
    expect(rows.find(r => r.rowKey === "sim")!.cells[1]).toContain("Проверка 3D текущего входа: PARTIAL");
    expect(rows.find(r => r.rowKey === "verdict")!.cells[1]).not.toContain("★");
    checked.value[1]!.spatialEvidence!.input.seed++;
    expect(model.scenarios[1]!.spatialEvidence!.input.seed).toBe(source.seed);
  });

  it("rejects an unknown workflow instead of stripping the model contract from a saved proof", () => {
    const value = evidence();
    value.input.transportWorkflow = "unrecognized-workflow" as typeof value.input.transportWorkflow;
    value.sourceInputKey = simInputIdentity(value.input);
    expect(validate(withEvidence(value)).ok).toBe(false);
  });

  it("восстановление входа отчёта не доверяет evidence.input и не пересчитывает деньги", () => {
    const model = project(withEvidence(evidence()));
    const stored = structuredClone(storedPartOf(model));
    const before = structuredClone(stored.results);
    stored.scenarios[1]!.spatialEvidence!.input.seed++;
    expect(expectedSpatialInputFromStored(stored, "p1")).toEqual(model.simInputs.p1!.calculated);
    expect(stored.results).toEqual(before);
    expect(scenarioTableRows(stored).find(r => r.rowKey === "sim")!.cells[1]).toContain("Устаревшая или непроверенная");
    stored.scenarios[1]!.items[0]!.quantityOverride = ok(stored.results).items[0]!.n! + 1;
    expect(expectedSpatialInputFromStored(stored, "p1")).toBeNull();
  });

  it("отчёт не выдаёт нулевые sentinel-метрики NOT_EVALUATED за измерения", () => {
    const e = evidence("NOT_EVALUATED");
    e.summary.achievedPerH = e.summary.queueEnd = e.summary.waitP95Min = 0;
    const text = scenarioTableRows(project(withEvidence(e))).find(r => r.rowKey === "sim")!.cells[1]!;
    expect(text).toContain("показатели не оценены");
    expect(text).not.toContain("0 из");
    expect(text).not.toContain("очередь 0");
  });

  it("не выполненный сервером прогон не становится нулевыми измерениями в рисках, решении и экспорте", () => {
    const before = project(withEvidence(evidence()));
    const checked = recheckProjectSpatialEvidence(before, { now: () => 0, budgetMs: 0 });
    const model = project(checked), result = ok(model.results);
    expect(model.scenarios[1]!.spatialEvidence!.assessment.status).toBe("NOT_EVALUATED");
    expect(model.scenarios[1]!.spatialEvidence!.summary.achievedPerH).toBe(0);
    expect(result.npvRub).toBe(ok(before.results).npvRub);
    expect(result.cashflows).toEqual(ok(before.results).cashflows);
    expect(pickRecommended([result])).toBeNull();
    const risk = result.risks.find(r => r.code === "SIM_NOT_CONFIRMED")!;
    expect(risk.text).toContain("Поток, очередь и ожидание не оценены");
    const decision = buildDecision(storedPartOf(model), "p1", model.simInputs.p1!.calculated);
    expect(decision.status).toBe("unverified");
    expect(decision.spatial.metrics).toBeNull();
    const texts = [risk.text, ...decision.constraints, ...scenarioTableRows(storedPartOf(model)).flatMap(row => row.cells)];
    for (const text of texts) {
      expect(text).not.toMatch(/Достигнуто 0|очередь 0/);
    }
  });

  it("валидатор отклоняет unknown nested data, NaN, неверные ключи, summary, доли и инфраструктуру", () => {
    const changes: ((s: ScenarioSpec[]) => void)[] = [
      s => { s[1]!.cashRealizationShare = -0.1; },
      s => { s[1]!.items[0]!.automationCoverageOverride = 1.01; },
      s => { s[1]!.items[0]!.chargersOverride = 0.5; },
      s => { s[1]!.spatialEvidence!.input.robots.speedMps = NaN; },
      s => { s[1]!.spatialEvidence!.sourceInputKey = "wrong"; },
      s => { s[1]!.spatialEvidence!.summary.fleet++; },
      s => { Object.assign(s[1]!.spatialEvidence!.input.robots, { secret: "not stored" }); },
      s => { Object.assign(s[1]!.spatialEvidence!.assessment, { eligible: true }); },
      s => { const e = s[1]!.spatialEvidence!; e.input.layout.chargers = 999999; e.sourceInputKey = simInputIdentity(e.input); },
    ];
    for (const change of changes) { const specs = withEvidence(evidence()); change(specs); expect(validate(specs).ok).toBe(false); }
  });
});
