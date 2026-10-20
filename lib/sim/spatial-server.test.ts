import { afterEach, describe, expect, it, vi } from "vitest";
import { paramSpecsFor } from "../data/organizer/params";
import { resultsFromInputs, resultsFromInputsAsync } from "../projects/recalc";
import { FIXTURE_H1500, fixtureSpecs, WAREHOUSE_BASE_PARAMS } from "../tz/econ/fixtures";
import { buildProjectModel } from "../tz/model";
import { resolveNorms } from "../tz/norms";
import type { ScenarioSpec, SpatialEvidence } from "../tz/types";
import * as preview from "../../experiments/warehouse-3d/project-input";
import { simInputIdentity } from "./identity";
import { SPATIAL_MODEL_VERSION } from "./spatial-bridge";
import { checkExecution, type CooperativeOptions } from "./cooperative";
import type { SimInput } from "./types";
import type { SimRunSummary } from "./metrics";
import { recheckProjectSpatialEvidence, recheckProjectSpatialEvidenceAsync } from "./spatial-server";

const live = { paramDefs: paramSpecsFor("warehouse"), products: [FIXTURE_H1500], norms: resolveNorms(), paramDefsFrom: "code" as const };
function build(scenarios: ScenarioSpec[]) {
  return buildProjectModel({ ...live, facility: "warehouse", params: { ...WAREHOUSE_BASE_PARAMS }, scenarios });
}
function setup(fleet = 1) {
  const specs = fixtureSpecs().map(s => ({ ...s, items: s.items.map(i => ({ ...i, quantityOverride: fleet, chargersOverride: 1, automationCoverageOverride: 0.4 })), ...(s.kind === "asis" ? {} : { cashRealizationShare: 0 }) }));
  const first = build(specs), input = first.simInputs.p1!.calculated!;
  const forged: SpatialEvidence = { input: structuredClone(input), sourceInputKey: simInputIdentity(input), executionInputKey: "never-executed",
    simModelVersion: SPATIAL_MODEL_VERSION, assessment: { status: "OK", headline: "Forged success", terminal: true },
    summary: { fleet, requiredPerH: input.demand.peakPerH, achievedPerH: 999999, queueEnd: 0, waitP95Min: 0 } };
  return { specs: specs.map(s => s.kind === "asis" ? s : { ...s, spatialEvidence: structuredClone(forged) }), input };
}
afterEach(() => vi.restoreAllMocks());

describe("server spatial receipts", () => {
  it("preserves a closed-pod zero-exposure NOT_EVALUATED through sync and async replay and domain decisions", async () => {
    const params={...WAREHOUSE_BASE_PARAMS,activeAreaM2:1000,inboundPalletsPerDay:1,outboundPalletsPerDay:0,internalPalletMovesPerDay:0};
    const scenarios=fixtureSpecs().map(s=>({...s,items:s.items.map(item=>({...item,quantityOverride:1}))}));
    for(const compute of [resultsFromInputs,resultsFromInputsAsync]){
      const computed=await compute(live,{facility:"warehouse",params,scenarios});
      const summary=computed.results.sim.p1!;
      expect(summary).toMatchObject({verdict:"NOT_EVALUATED",observedPeakTasks:0,achievedPerH:0,minStableFleet:null});
      expect(summary.assessmentReason).toContain("увеличьте окно");
      expect(computed.results.scenarios[1]!.spatialEvidence!.assessment.status).toBe("NOT_EVALUATED");
      expect(computed.results.results[1]!.risks.some(r=>r.code==="SIM_NOT_EVALUATED")).toBe(true);
      expect(computed.results.results[1]!.risks.some(r=>r.code==="SIM_NOT_CONFIRMED")).toBe(false);
      expect(computed.results.conclusion.recommendedScenarioKey).toBeNull();
      expect(computed.results.conclusion.headline).toContain("нагрузки не оценено");
    }
  },15_000);
  it("shares one 45-second deadline across distinct async spatial inputs", async () => {
    const model = build(setup().specs);
    model.simInputs.r1!.calculated = { ...model.simInputs.r1!.calculated!, seed: model.simInputs.p1!.calculated!.seed + 1 };
    let clock = 1000;
    const deadlines: number[] = [], seeds: number[] = [];
    vi.spyOn(preview, "calculateProjectPreviewAsync").mockImplementation(async (value, options: CooperativeOptions = {}) => {
      const input = (value as { input: SimInput }).input;
      deadlines.push(options.deadline!); seeds.push(input.seed);
      clock += deadlines.length === 1 ? 30_000 : 16_000;
      checkExecution(options);
      return { input, assessment: { status: "PARTIAL", terminal: true, headline: "Measured fixture" },
        summary: { fleet: input.robots.count, requiredPerH: input.demand.peakPerH, achievedPerH: 1, queueEnd: 1, waitP95Min: 1 } } as Awaited<ReturnType<typeof preview.calculateProjectPreviewAsync>>;
    });
    const checked = await recheckProjectSpatialEvidenceAsync(model, { now: () => clock, deadline: 100_000 });
    expect(new Set(seeds).size).toBe(2);
    expect(deadlines).toEqual([46_000, 46_000]);
    expect(checked[1]!.spatialEvidence!.assessment.status).toBe("PARTIAL");
    expect(checked[2]!.spatialEvidence!.assessment.status).toBe("NOT_EVALUATED");
    expect(checked[2]!.spatialEvidence!.summary.achievedPerH).toBe(0);
  });

  it("clips the async spatial allowance to the remaining outer deadline and propagates its expiry", async () => {
    const model = build(setup().specs);
    model.simInputs.r1!.calculated = { ...model.simInputs.r1!.calculated!, seed: model.simInputs.p1!.calculated!.seed + 1 };
    let clock = 50_000;
    const deadlines: number[] = [];
    vi.spyOn(preview, "calculateProjectPreviewAsync").mockImplementation(async (_value, options: CooperativeOptions = {}) => {
      deadlines.push(options.deadline!);
      clock += 10_001;
      checkExecution(options);
      throw new Error("Expired execution must not produce a receipt");
    });
    await expect(recheckProjectSpatialEvidenceAsync(model, { now: () => clock, deadline: 60_000 })).rejects.toMatchObject({ name: "SimBudgetExceeded" });
    expect(deadlines).toEqual([60_000]);
  });

  it("replays the SERVER input, replaces a forged OK and caches identical purchase/RaaS inputs", () => {
    const { specs, input } = setup();
    for (const spec of specs) if (spec.spatialEvidence) {
      spec.spatialEvidence.input.seed = 719;
      spec.spatialEvidence.sourceInputKey = simInputIdentity(spec.spatialEvidence.input);
    }
    const before = structuredClone(specs), spy = vi.spyOn(preview, "calculateProjectPreview");
    const measured: SimRunSummary[] = [];
    const checked = recheckProjectSpatialEvidence(build(specs), { now: () => 0, onSummary: (key, summary) => {
      measured.push(structuredClone(summary));
      expect(summary.scenarioKey).toBe(key);
      summary.achievedPerH = -999; // A consumer must not corrupt the cached RaaS receipt.
    } });
    expect(spy).toHaveBeenCalledTimes(1);
    const evidence = checked[1]!.spatialEvidence!;
    expect(evidence.input).toEqual(input);
    expect(evidence.sourceInputKey).toBe(simInputIdentity(input));
    expect(evidence.executionInputKey).not.toBe("never-executed");
    expect(evidence.assessment.status).toBe("PARTIAL");
    expect(evidence.assessment.headline).not.toBe("Forged success");
    expect(evidence.summary.achievedPerH).toBeGreaterThan(0);
    expect(evidence.summary.achievedPerH).toBeLessThan(999999);
    expect(checked[2]!.spatialEvidence).toEqual(evidence);
    expect(measured.map(summary => summary.scenarioKey)).toEqual(["p1", "r1"]);
    expect(measured[0]).toMatchObject({
      inputKey: simInputIdentity(input), simModelVersion: SPATIAL_MODEL_VERSION,
      achievedPerH: evidence.summary.achievedPerH, verdict: "NOT_CONFIRMED", minStableFleet: null,
    });
    expect(measured[1]!.servedShare).toBe(measured[0]!.servedShare);
    expect(measured[1]!.achievedPerH).toBe(measured[0]!.achievedPerH);
    expect(measured[0]!.servedShare).toBe(spy.mock.results[0]!.value.summary.servedShare);
    expect(specs).toEqual(before);
    expect(checked[1]!.cashRealizationShare).toBe(0);
    expect(checked[1]!.items[0]!.automationCoverageOverride).toBe(0.4);
  });

  it("the central save/create calculation path persists actual PARTIAL with blocking risk and unchanged user estimates", () => {
    const { specs } = setup();
    const { results } = resultsFromInputs(live, { facility: "warehouse", params: { ...WAREHOUSE_BASE_PARAMS }, scenarios: specs });
    const stored = results.scenarios[1]!;
    expect(stored.spatialEvidence!.assessment.status).toBe("PARTIAL");
    expect(stored.spatialEvidence!.summary.achievedPerH).not.toBe(999999);
    expect(stored.cashRealizationShare).toBe(0);
    expect(stored.items[0]!.automationCoverageOverride).toBe(0.4);
    const result = results.results.find(r => r.key === "p1");
    expect(result?.risks.some(r => r.code === "SIM_NOT_CONFIRMED")).toBe(true);
    expect(results.conclusion.recommendedScenarioKey).not.toBe("p1");
  }, 90_000);

  it("does not run spatial replay for scenarios without a prior spatial proof", () => {
    const spy = vi.spyOn(preview, "calculateProjectPreview");
    const model = build(fixtureSpecs());
    expect(recheckProjectSpatialEvidence(model, { now: () => 0 })).toEqual(model.scenarios);
    expect(spy).not.toHaveBeenCalled();
  });

  it("bounds unsupported fleets and the shared budget; no late or skipped result becomes OK", () => {
    const { specs } = setup(61);
    const unsupported = recheckProjectSpatialEvidence(build(specs), { now: () => 0 });
    expect(unsupported[1]!.spatialEvidence!.assessment.status).toBe("NOT_EVALUATED");
    expect(unsupported[1]!.spatialEvidence!.assessment.headline).toContain("60");
    const skippedSummary = vi.fn();
    const zero = recheckProjectSpatialEvidence(build(setup().specs), { budgetMs: 0, now: () => 0, onSummary: skippedSummary });
    expect(skippedSummary).not.toHaveBeenCalled();
    expect(zero.filter(s => s.spatialEvidence).every(s => s.spatialEvidence!.assessment.status === "NOT_EVALUATED")).toBe(true);
    expect(zero[1]!.spatialEvidence!.summary.achievedPerH).toBe(0);
    let time = 0;
    const actual = preview.calculateProjectPreview;
    const spy = vi.spyOn(preview, "calculateProjectPreview").mockImplementation(value => { const result = actual(value); time = 100; return result; });
    const late = recheckProjectSpatialEvidence(build(setup().specs), { budgetMs: 10, now: () => time });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(late.filter(s => s.spatialEvidence).every(s => s.spatialEvidence!.assessment.status === "NOT_EVALUATED")).toBe(true);
  });

  it("missing current adapter input stays explicitly unverified and cannot retain forged metrics", () => {
    const { specs } = setup();
    specs[1]!.items[0]!.throughputPerHOverride = 100;
    const checked = recheckProjectSpatialEvidence(build(specs), { now: () => 0 });
    expect(checked[1]!.spatialEvidence!.assessment.status).toBe("NOT_EVALUATED");
    expect(checked[1]!.spatialEvidence!.summary.achievedPerH).toBe(0);
    expect(build(checked).results.find(r => r.key === "p1")?.risks.some(r => r.code === "SPATIAL_STALE")).toBe(true);
  });
});
