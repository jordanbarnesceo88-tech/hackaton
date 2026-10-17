import { describe, expect, it } from "vitest";
import type { ScenarioSpec } from "../tz/types";
import { warehouseBaseInput } from "./fixtures";
import { simInputIdentity } from "./identity";
import { createSpatialProjectSnapshot, parseSpatialProjectResult, SPATIAL_MODEL_VERSION, type SpatialProjectResult } from "./spatial-bridge";
import { buildSpatialFinancialScenario, parseSpatialScenarioProposal, type SpatialScenarioProposal } from "./spatial-proposal";

function setup() {
  const input = warehouseBaseInput(7);
  input.seed = 731;
  const original = createSpatialProjectSnapshot({ requestId: "proposal-ticket", scenarioKey: "purchase", scenarioName: "Покупка", variantId: "byNorm", input });
  const candidate = structuredClone(original);
  candidate.input.robots.count = 12;
  candidate.input.layout.chargers = 3;
  candidate.inputKey = simInputIdentity(candidate.input);
  const result: SpatialProjectResult = {
    type: "spatial-project-result", requestId: original.requestId, sourceInputKey: candidate.inputKey,
    executionInputKey: "prepared-execution-input", simModelVersion: SPATIAL_MODEL_VERSION, modified: false,
    assessment: { status: "PARTIAL", headline: "Очередь превышает допуск", terminal: true },
    summary: { fleet: 12, requiredPerH: input.demand.peakPerH, achievedPerH: 79, queueEnd: 18, waitP95Min: 5 },
  };
  const proposal: SpatialScenarioProposal = { type: "spatial-scenario-proposal", requestId: original.requestId, originalInputKey: original.inputKey, candidate, result };
  const source: ScenarioSpec = { key: "purchase", name: "Покупка", kind: "purchase", items: [{ process: "pallet-transport", productSlug: "ronavi-h1500", priceRubOverride: 2_700_000 }], normOverrides: { reservePct: 10 } };
  return { original, proposal, source };
}

describe("spatial fleet proposal boundary", () => {
  it("accepts only N/C changes, preserves the original and supports PARTIAL or OK evidence", () => {
    const { original, proposal } = setup(), before = structuredClone(original);
    expect(parseSpatialScenarioProposal(proposal, original)).toEqual(proposal);
    proposal.result.assessment.status = "OK";
    expect(parseSpatialScenarioProposal(proposal, original).candidate.input.robots.count).toBe(12);
    expect(original).toEqual(before);
  });

  it("rejects changed seed, rates, robot capabilities, thresholds or explicit geometry even with matching candidate identity", () => {
    const mutations = [
      (p: SpatialScenarioProposal) => { p.candidate.input.seed++; },
      (p: SpatialScenarioProposal) => { p.candidate.input.demand.avgPerH++; },
      (p: SpatialScenarioProposal) => { p.candidate.input.demand.peakPerH++; },
      (p: SpatialScenarioProposal) => { p.candidate.input.robots.speedMps++; },
      (p: SpatialScenarioProposal) => { p.candidate.input.thresholds.p95WaitMaxMin++; },
      (p: SpatialScenarioProposal) => { p.candidate.input.layout.activeAreaM2++; },
    ];
    for (const mutate of mutations) {
      const { original, proposal } = setup(); mutate(proposal);
      proposal.candidate.inputKey = simInputIdentity(proposal.candidate.input);
      proposal.result.sourceInputKey = proposal.candidate.inputKey;
      proposal.result.summary.requiredPerH = proposal.candidate.input.demand.peakPerH;
      expect(() => parseSpatialScenarioProposal(proposal, original)).toThrow(/только число/);
    }
  });

  it("rejects malformed explicit geometry before trusting a matching identity", () => {
    const { original, proposal } = setup();
    proposal.candidate.input.siteLayout = { widthM: 100, heightM: 100, receiving: [], shipping: [], chargers: [], zones: [], crossAislesY: [], rackAislesX: [], slots: [] };
    proposal.candidate.inputKey = simInputIdentity(proposal.candidate.input);
    proposal.result.sourceInputKey = proposal.candidate.inputKey;
    expect(() => parseSpatialScenarioProposal(proposal, original)).toThrow(/Исходный план должен содержать/);
  });

  it("rejects stale tickets, foreign scenarios, source keys and metadata spoofing", () => {
    const patches = [
      (p: SpatialScenarioProposal) => { p.requestId = "stale"; },
      (p: SpatialScenarioProposal) => { p.originalInputKey = "old"; },
      (p: SpatialScenarioProposal) => { p.candidate.requestId = "other-window"; },
      (p: SpatialScenarioProposal) => { p.candidate.scenarioKey = "other"; },
      (p: SpatialScenarioProposal) => { p.candidate.variantId = "calculated"; },
      (p: SpatialScenarioProposal) => { p.candidate.scenarioName = "Подмена"; },
      (p: SpatialScenarioProposal) => { p.result.requestId = "stale"; },
      (p: SpatialScenarioProposal) => { p.result.sourceInputKey = "unrelated"; },
    ];
    for (const mutate of patches) { const { original, proposal } = setup(); mutate(proposal); expect(() => parseSpatialScenarioProposal(proposal, original)).toThrow(); }
    expect(() => parseSpatialScenarioProposal(null, setup().original)).toThrow();
    expect(() => parseSpatialScenarioProposal({ ...setup().proposal, type: "spatial-project-result" }, setup().original)).toThrow();
  });

  it("rejects invalid quantities/identity and nonterminal or failed evidence", () => {
    for (const n of [-1, 0, 1.5, 501, Number.NaN]) { const { original, proposal } = setup(); proposal.candidate.input.robots.count = n; proposal.candidate.inputKey = simInputIdentity(proposal.candidate.input); expect(() => parseSpatialScenarioProposal(proposal, original)).toThrow(); }
    for (const c of [-1, 0.5, 2001, Infinity]) { const { original, proposal } = setup(); proposal.candidate.input.layout.chargers = c; proposal.candidate.inputKey = simInputIdentity(proposal.candidate.input); expect(() => parseSpatialScenarioProposal(proposal, original)).toThrow(); }
    for (const status of ["RUNNING", "FAIL", "NOT_EVALUATED"] as const) { const { original, proposal } = setup(); proposal.result.assessment.status = status; expect(() => parseSpatialScenarioProposal(proposal, original)).toThrow(); }
    const { original, proposal } = setup(); proposal.candidate.inputKey = original.inputKey; expect(() => parseSpatialScenarioProposal(proposal, original)).toThrow(/Идентификатор/);
  });

  it("requires the current spatial engine version only for new financial proposals", () => {
    const { original, proposal } = setup();
    proposal.result.simModelVersion = "spatial-older-model";
    expect(() => parseSpatialScenarioProposal(proposal, original)).toThrow(/актуальная/);
    expect(() => buildSpatialFinancialScenario({ source: setup().source, key: "old-result", name: "Старый результат", proposal, annualCoverageShare: 0.5, cashRealizationShare: 0.4 })).toThrow();
    expect(parseSpatialProjectResult(proposal.result, proposal.candidate).simModelVersion).toBe("spatial-older-model");
  });

  it("preserves the existing spatial-project-result protocol", () => {
    const { original, proposal } = setup();
    const oldReply = { ...proposal.result, sourceInputKey: original.inputKey, summary: { ...proposal.result.summary, fleet: original.input.robots.count } };
    expect(parseSpatialProjectResult(oldReply, original)).toEqual(oldReply);
  });
});

describe("financial scenario from a spatial proposal", () => {
  function build(patch: Partial<Parameters<typeof buildSpatialFinancialScenario>[0]> = {}) {
    const { source, proposal } = setup();
    return buildSpatialFinancialScenario({ source, proposal, key: "spatial-12", name: "Парк 12", annualCoverageShare: 0.6, cashRealizationShare: 0.4, ...patch });
  }
  it("copies the source and retains price/norm data while setting explicit financial assumptions", () => {
    const { source, proposal } = setup(), before = structuredClone(source);
    const next = build({ source, proposal });
    expect(source).toEqual(before);
    expect(next).toMatchObject({ key: "spatial-12", name: "Парк 12", kind: "purchase", cashRealizationShare: 0.4, items: [{ quantityOverride: 12, chargersOverride: 3, automationCoverageOverride: 0.6, priceRubOverride: 2_700_000 }], normOverrides: before.normOverrides });
    expect(next.spatialEvidence).toEqual({ sourceInputKey: proposal.result.sourceInputKey, executionInputKey: proposal.result.executionInputKey, simModelVersion: proposal.result.simModelVersion, input: proposal.candidate.input, assessment: proposal.result.assessment, summary: proposal.result.summary });
    expect(next.items[0]).not.toHaveProperty("throughputPerHOverride");
    next.items[0]!.quantityOverride = 99; next.spatialEvidence!.input.seed++;
    expect(source).toEqual(before); expect(proposal.candidate.input.seed).toBe(731);
  });
  it("accepts boundary estimate shares and rejects out-of-range or nonfinite values", () => {
    for (const n of [0, 1]) expect(build({ annualCoverageShare: n, cashRealizationShare: n }).cashRealizationShare).toBe(n);
    for (const n of [-0.1, 1.1, Infinity, NaN]) { expect(() => build({ annualCoverageShare: n })).toThrow(/Доли/); expect(() => build({ cashRealizationShare: n })).toThrow(/Доли/); }
  });
  it("requires a new valid key/name and exactly one supported process", () => {
    for (const key of ["purchase", "Bad Key", "", "x".repeat(41)]) expect(() => build({ key })).toThrow();
    for (const name of ["", "  ", "x".repeat(81)]) expect(() => build({ name })).toThrow();
    const { source } = setup();
    expect(() => build({ source: { ...source, kind: "asis" } })).toThrow();
    expect(() => build({ source: { ...source, items: [] } })).toThrow(/ровно один/);
    expect(() => build({ source: { ...source, items: [...source.items, ...source.items] } })).toThrow(/ровно один/);
  });
  it("rejects invalid or failed evidence even if called without the message parser", () => {
    for (const status of ["FAIL", "NOT_EVALUATED"] as const) { const { proposal } = setup(); proposal.result.assessment.status = status; expect(() => build({ proposal })).toThrow(); }
    const { proposal } = setup(); proposal.result.summary.fleet++; expect(() => build({ proposal })).toThrow();
  });
});
