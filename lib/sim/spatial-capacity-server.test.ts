import { afterEach, describe, expect, it, vi } from "vitest";
import * as preview from "../../experiments/warehouse-3d/project-input";
import type { DemoModel } from "../../experiments/warehouse-3d/core";
import { paramSpecsFor } from "../data/organizer/params";
import { FIXTURE_H1500, fixtureSpecs, WAREHOUSE_BASE_PARAMS } from "../tz/econ/fixtures";
import { buildProjectModel } from "../tz/model";
import { resolveNorms } from "../tz/norms";
import type { ScenarioSpec, SpatialEvidence } from "../tz/types";
import { capacityNotEvaluated, type CapacityProof } from "./capacity-protocol";
import { checkExecution, type CooperativeOptions } from "./cooperative";
import { simInputIdentity } from "./identity";
import { SPATIAL_MODEL_VERSION } from "./spatial-version";
import { recheckProjectSpatialEvidence, recheckProjectSpatialEvidenceAsync } from "./spatial-server";
import type { SimInput } from "./types";

function model(requests: readonly boolean[] = [true, true]) {
  const build = (scenarios: ScenarioSpec[]) => buildProjectModel({ facility: "warehouse", params: { ...WAREHOUSE_BASE_PARAMS },
    paramDefs: paramSpecsFor("warehouse"), products: [FIXTURE_H1500], norms: resolveNorms(), scenarios });
  const specs = fixtureSpecs().map(s => ({ ...s, items: s.items.map(i => ({ ...i, quantityOverride: 6, chargersOverride: 2 })) }));
  const first = build(specs), input = first.simInputs.p1!.calculated!;
  const submitted: SpatialEvidence = { input: structuredClone(input), sourceInputKey: simInputIdentity(input), executionInputKey: "untrusted-executor",
    simModelVersion: SPATIAL_MODEL_VERSION, assessment: { status: "OK", headline: "Client claim", terminal: true },
    summary: { fleet: 6, requiredPerH: input.demand.peakPerH, achievedPerH: 999999, queueEnd: 0, waitP95Min: 0 } };
  return build(specs.map((s, i) => i === 0 ? s : { ...s, spatialEvidence: { ...structuredClone(submitted), ...(requests[i - 1] ? { capacityRequested: true as const } : {}) } }));
}

function nominal(input: SimInput, healthy = true): DemoModel {
  return { input: structuredClone(input), summary: { scenarioKey: "p1", seed: input.seed, fleet: input.robots.count, requiredPerH: input.demand.peakPerH,
    achievedPerH: 51.5, queueEnd: 1, waitP95Min: 1 },
    assessment: { terminal: true, status: "PARTIAL", headline: "Original output-window remains PARTIAL", checks: [
      ...["safety", "energy", "validity", "underlift"].map(id => ({ id, category: "safety", status: "PASS", affectsOverall: true })),
      { id: "exposure", category: "goal", status: "PASS", affectsOverall: true },
      { id: "intake_sla", category: "goal", status: healthy ? "PASS" : "FAIL", affectsOverall: true },
      { id: "throughput", category: "goal", status: "FAIL", affectsOverall: true },
    ] }, qualificationDiagnostics: { pendingWaitMaxS: 0, blockedWaitMaxS: 0, unfinished: [] },
  } as unknown as DemoModel;
}

function proof(input: SimInput, status: CapacityProof["status"] = "FAIL") {
  return { ...capacityNotEvaluated(input, "Server observation"), terminal: true, status, executionInputKey: "server-controlled-executor" };
}

afterEach(() => vi.restoreAllMocks());

describe("controlled capacity server trust boundary", () => {
  it("ignores submitted PASS, source keys and forged N/C/seed/layout and preserves nominal PARTIAL", () => {
    const m = model(), expected = structuredClone(m.simInputs.p1!.calculated!);
    for (const spec of m.scenarios) if (spec.spatialEvidence) {
      const forged = proof(expected, "PASS");
      forged.input.robots.count = 59; forged.input.layout.chargers = 99; forged.input.seed++;
      forged.input.layout.activeAreaM2++; forged.sourceInputKey = "wrong-source"; forged.testInputKey = "wrong-test"; forged.simModelVersion = "old-engine";
      spec.spatialEvidence.capacityProof = forged;
    }
    const original = structuredClone(m.scenarios);
    const nominalSpy = vi.spyOn(preview, "calculateProjectPreview").mockImplementation(value => nominal((value as { input: SimInput }).input));
    const controlled = vi.spyOn(preview, "calculateProjectCapacityPreview").mockImplementation(value => {
      expect((value as { input: SimInput }).input).toEqual(expected);
      return proof((value as { input: SimInput }).input);
    });
    const checked = recheckProjectSpatialEvidence(m, { now: () => 0 });
    expect(nominalSpy).toHaveBeenCalledTimes(1); expect(controlled).toHaveBeenCalledTimes(1);
    const saved = checked[1]!.spatialEvidence!;
    expect(saved.input).toEqual(expected); expect(saved.assessment.status).toBe("PARTIAL");
    expect(saved.summary.achievedPerH).toBe(51.5); expect(saved.capacityProof!.status).toBe("FAIL");
    expect(saved.capacityProof!.sourceInputKey).toBe(simInputIdentity(expected));
    expect(checked[2]!.spatialEvidence).toEqual(saved); expect(m.scenarios).toEqual(original);
    saved.capacityProof!.input.seed++;
    expect(checked[2]!.spatialEvidence!.capacityProof!.input.seed).toBe(expected.seed);
  });

  it("does not backfill old nominal-only receipts and separates requested/nonrequested cache entries", () => {
    const m = model([false, true]);
    const replay = vi.spyOn(preview, "calculateProjectPreview").mockImplementation(value => nominal((value as { input: SimInput }).input));
    const controlled = vi.spyOn(preview, "calculateProjectCapacityPreview").mockImplementation(value => proof((value as { input: SimInput }).input));
    const checked = recheckProjectSpatialEvidence(m, { now: () => 0 });
    expect(replay).toHaveBeenCalledTimes(2); expect(controlled).toHaveBeenCalledTimes(1);
    expect(checked[1]!.spatialEvidence).not.toHaveProperty("capacityProof");
    expect(checked[1]!.spatialEvidence).not.toHaveProperty("capacityRequested");
    expect(checked[2]!.spatialEvidence!.capacityProof!.status).toBe("FAIL");
  });

  it("replays an existing proof even without a new request flag", () => {
    const m = model([false, false]);
    m.scenarios[1]!.spatialEvidence!.capacityProof = proof(m.simInputs.p1!.calculated!, "PASS");
    vi.spyOn(preview, "calculateProjectPreview").mockImplementation(value => nominal((value as { input: SimInput }).input));
    const controlled = vi.spyOn(preview, "calculateProjectCapacityPreview").mockImplementation(value => proof((value as { input: SimInput }).input));
    const checked = recheckProjectSpatialEvidence(m, { now: () => 0 });
    expect(controlled).toHaveBeenCalledTimes(1); expect(checked[1]!.spatialEvidence!.capacityProof!.status).toBe("FAIL");
    expect(checked[2]!.spatialEvidence).not.toHaveProperty("capacityProof");
  });

  it("does not run controlled load over failed nominal health or missing wait diagnostics", () => {
    for (const missing of [false, true]) {
      const m = model();
      vi.spyOn(preview, "calculateProjectPreview").mockImplementation(value => {
        const result = nominal((value as { input: SimInput }).input, missing);
        if (missing) delete result.qualificationDiagnostics;
        return result;
      });
      const controlled = vi.spyOn(preview, "calculateProjectCapacityPreview");
      const checked = recheckProjectSpatialEvidence(m, { now: () => 0 });
      expect(controlled).not.toHaveBeenCalled(); expect(checked[1]!.spatialEvidence!.assessment.status).toBe("PARTIAL");
      expect(checked[1]!.spatialEvidence!.capacityProof).toMatchObject({ status: "NOT_EVALUATED", terminal: false });
      vi.restoreAllMocks();
    }
  });

  it("marks only capacity NOT_EVALUATED when its sync replay exceeds the shared allowance", () => {
    let clock = 100;
    const m = model();
    const durations: number[] = [];
    vi.spyOn(preview, "calculateProjectPreview").mockImplementation(value => { clock += 20_000; return nominal((value as { input: SimInput }).input); });
    const controlled = vi.spyOn(preview, "calculateProjectCapacityPreview").mockImplementation((value, options = {}) => {
      expect(options.deadline).toBe(45_100); clock += 26_000;
      return proof((value as { input: SimInput }).input, "PASS");
    });
    const checked = recheckProjectSpatialEvidence(m, { now: () => clock, budgetMs: 90_000, onSummary: (_key, summary) => durations.push(summary.durationMs) });
    expect(controlled).toHaveBeenCalledTimes(1);
    expect(durations).toEqual([20_000, 20_000]);
    for (const spec of checked.slice(1)) {
      expect(spec.spatialEvidence!.assessment.status).toBe("PARTIAL");
      expect(spec.spatialEvidence!.summary.achievedPerH).toBe(51.5);
      expect(spec.spatialEvidence!.capacityProof).toMatchObject({ status: "NOT_EVALUATED", terminal: false });
    }
  });

  it("uses the same async deadline for both replays; capacity timeout retains the nominal receipt", async () => {
    let clock = 100;
    const m = model(), deadlines: number[] = [];
    vi.spyOn(preview, "calculateProjectPreviewAsync").mockImplementation(async (value, options = {}) => {
      deadlines.push(options.deadline!); clock += 20_000;
      return nominal((value as { input: SimInput }).input);
    });
    vi.spyOn(preview, "calculateProjectCapacityPreviewAsync").mockImplementation(async (_value, options = {}) => {
      deadlines.push(options.deadline!); clock += 26_000; checkExecution(options);
      throw new Error("An expired controlled replay must not return PASS");
    });
    const checked = await recheckProjectSpatialEvidenceAsync(m, { now: () => clock, deadline: 100_000 });
    expect(deadlines).toEqual([45_100, 45_100]);
    expect(checked[1]!.spatialEvidence).toMatchObject({ assessment: { status: "PARTIAL" }, summary: { achievedPerH: 51.5 }, capacityProof: { status: "NOT_EVALUATED" } });
    expect(checked[2]!.spatialEvidence!.capacityProof!.status).toBe("NOT_EVALUATED");
  });

  it("propagates async cancellation and expiry of the outer project deadline", async () => {
    for (const abort of [false, true]) {
      let clock = 0;
      const controller = new AbortController();
      vi.spyOn(preview, "calculateProjectPreviewAsync").mockImplementation(async value => nominal((value as { input: SimInput }).input));
      vi.spyOn(preview, "calculateProjectCapacityPreviewAsync").mockImplementation(async (_value, options: CooperativeOptions = {}) => {
        if (abort) controller.abort(); else clock = 100;
        checkExecution(options); throw new Error("Expired controlled run");
      });
      await expect(recheckProjectSpatialEvidenceAsync(model(), { now: () => clock, deadline: 100, signal: controller.signal })).rejects.toMatchObject({ name: abort ? "AbortError" : "SimBudgetExceeded" });
      vi.restoreAllMocks();
    }
  });

  it("zero/invalid budget cannot retain a submitted capacity PASS", async () => {
    for (const budgetMs of [0, -1, Number.NaN]) {
      const m = model(); m.scenarios[1]!.spatialEvidence!.capacityProof = proof(m.simInputs.p1!.calculated!, "PASS");
      const sync = recheckProjectSpatialEvidence(m, { now: () => 0, budgetMs });
      const asyncResult = await recheckProjectSpatialEvidenceAsync(m, { now: () => 0, budgetMs });
      for (const checked of [sync, asyncResult]) expect(checked[1]!.spatialEvidence).toMatchObject({ assessment: { status: "NOT_EVALUATED" }, capacityProof: { status: "NOT_EVALUATED", terminal: false } });
    }
  });
});
