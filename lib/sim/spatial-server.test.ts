import { afterEach, describe, expect, it, vi } from "vitest";
import { paramSpecsFor } from "../data/organizer/params";
import { resultsFromInputs } from "../projects/recalc";
import { FIXTURE_H1500, fixtureSpecs, WAREHOUSE_BASE_PARAMS } from "../tz/econ/fixtures";
import { buildProjectModel } from "../tz/model";
import { resolveNorms } from "../tz/norms";
import type { ScenarioSpec, SpatialEvidence } from "../tz/types";
import * as preview from "../../experiments/warehouse-3d/project-input";
import { simInputIdentity } from "./identity";
import { SPATIAL_MODEL_VERSION } from "./spatial-bridge";
import { recheckProjectSpatialEvidence } from "./spatial-server";

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
  it("replays the SERVER input, replaces a forged OK and caches identical purchase/RaaS inputs", () => {
    const { specs, input } = setup();
    for (const spec of specs) if (spec.spatialEvidence) {
      spec.spatialEvidence.input.seed = 719;
      spec.spatialEvidence.sourceInputKey = simInputIdentity(spec.spatialEvidence.input);
    }
    const before = structuredClone(specs), spy = vi.spyOn(preview, "calculateProjectPreview");
    const checked = recheckProjectSpatialEvidence(build(specs), { now: () => 0 });
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
  });

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
    const zero = recheckProjectSpatialEvidence(build(setup().specs), { budgetMs: 0, now: () => 0 });
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
