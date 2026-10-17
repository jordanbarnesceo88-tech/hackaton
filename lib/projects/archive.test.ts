import { describe, expect, it, vi } from "vitest";
import { fixtureResults } from "../report/tz/test-fixtures";
import { projectCsv } from "../report/tz/csv";
import * as modelModule from "../tz/model";
import * as engine from "../sim/engine";
import { resolveNorms } from "../tz/norms";
import { paramSpecsFor } from "../data/organizer/params";
import { reproduceModel, type LiveInputs } from "./recalc";
import { canAdoptSavedSnapshot, projectDraftKey, projectSnapshotModel } from "./archive";
import { scenarioFinance, scenarioNorms } from "../report/tz/rows";

describe("immutable project archive", () => {
  it("reads retired algorithms without today's financial model, engine, products or changed parameter bounds", () => {
    const stored = fixtureResults();
    stored.modelVersion = "retired-finance-1999";
    stored.simModelVersion = "retired-simulator";
    stored.conclusion.headline = "Исторический вывод, который нельзя заменить текущим алгоритмом";
    const first = stored.results.find(r => r.status === "ok" && r.kind !== "asis");
    if (first?.status === "ok") first.npvRub = 123456789.123456;
    const before = structuredClone(stored);
    const live: LiveInputs = { products: [], norms: resolveNorms([{ key: "utilization", value: 0.1 }]), paramDefsFrom: "code",
      paramDefs: paramSpecsFor("warehouse").map(d => ({ ...d, min: 1, max: 2, base: 1 })) };
    const calculation = vi.spyOn(modelModule, "buildProjectModel").mockImplementation(() => { throw new Error("archive must not calculate"); });
    const simulation = vi.spyOn(engine, "createSim").mockImplementation(() => { throw new Error("archive must not replay"); });
    try {
      const archived = reproduceModel(live, stored);
      expect(archived.results).toEqual(before.results);
      expect(archived.conclusion).toEqual(before.conclusion);
      expect(archived.paramsUsed).toEqual(before.paramsUsed);
      expect(archived.modelVersion).toBe("retired-finance-1999");
      expect(archived.layout).toBeNull();
      expect(Object.values(archived.simInputs).every(s => s.calculated === null)).toBe(true);
      expect(calculation).not.toHaveBeenCalled(); expect(simulation).not.toHaveBeenCalled();
      const projected = { ...modelModule.storedPartOf(archived), calculatedAt: stored.calculatedAt, sim: stored.sim };
      expect(projectCsv(projected, { projectName: "Архив" })).toBe(projectCsv(stored, { projectName: "Архив" }));
      archived.results[0]!.name = "Локальное изменение";
      expect(stored).toEqual(before);
    } finally { vi.restoreAllMocks(); }
  });

  it("retains saved runtime inputs/layout/definitions verbatim instead of deriving them on read", () => {
    const stored = fixtureResults();
    stored.runtime = { layout: { widthM: 42, heightM: 7, zones: [], crossAislesY: [], rackAislesX: [], slots: [], receiving: [], shipping: [], chargers: [] },
      simInputs: { p1: { calculated: null, byNorm: null, assumedUtilPct: 12.345, provenance: null } }, paramDefs: paramSpecsFor("warehouse") };
    const archived = reproduceModel({ products: [], paramDefs: [], norms: resolveNorms(), paramDefsFrom: "code" }, stored);
    expect(archived.layout).toEqual(stored.runtime.layout);
    expect(archived.simInputs).toEqual(stored.runtime.simInputs);
    expect(archived.runtime!.paramDefs).toEqual(stored.runtime.paramDefs);
    expect(archived.layout).not.toBe(stored.runtime.layout);
  });

  it("keeps historical discount rates and resolved scenario norms outside current bounds in exports", () => {
    const stored = fixtureResults();
    stored.normsUsed.discountRate = 0.5;
    const spec = stored.scenarios.find(s => s.kind !== "asis")!;
    spec.normOverrides = { reservePct: 0.175 };
    const result = stored.results.find(r => r.key === spec.key);
    if (result?.status !== "ok") throw new Error("Missing financial result");
    expect(scenarioFinance(stored, result).rate).toBe(0.5);
    expect(scenarioNorms(stored, spec.key).reservePct).toBe(0.175);
    stored.runtime = { layout: null, simInputs: {}, normsByScenario: { [spec.key]: { ...stored.normsUsed, discountRate: 0.6, reservePct: 0.19 } } };
    expect(scenarioFinance(stored, result).rate).toBe(0.6);
    expect(scenarioNorms(stored, spec.key).reservePct).toBe(0.19);
  });

  it("adopts canonical server proof only for an unchanged draft, keeping newer parameter and scenario edits dirty", () => {
    const submitted = fixtureResults();
    const current = { params: submitted.paramsUsed, scenarios: submitted.scenarios };
    const server = structuredClone(submitted);
    server.conclusion.headline = "Сервер: пространственная проверка не выполнена";
    server.scenarios[1]!.cashRealizationShare = 0.4;
    expect(canAdoptSavedSnapshot(current, current)).toBe(true);
    const adopted = projectSnapshotModel(server);
    expect(adopted.conclusion.headline).toBe(server.conclusion.headline);
    expect(projectDraftKey(adopted.paramsUsed, adopted.scenarios)).toBe(projectDraftKey(server.paramsUsed, server.scenarios));
    const changedParams = { params: { ...current.params, forkliftSalaryRubMonth: 900001 }, scenarios: current.scenarios };
    const changedScenarios = { params: current.params, scenarios: current.scenarios.map(s => ({ ...s, name: `${s.name} новая правка` })) };
    for (const newer of [changedParams, changedScenarios]) {
      expect(canAdoptSavedSnapshot(newer, current)).toBe(false);
      expect(projectDraftKey(newer.params, newer.scenarios)).not.toBe(projectDraftKey(server.paramsUsed, server.scenarios));
    }
  });
});
