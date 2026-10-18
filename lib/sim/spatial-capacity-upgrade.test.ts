import { describe, expect, it } from "vitest";
import { paramSpecsFor } from "../data/organizer/params";
import { resultsFromInputsAsync } from "../projects/recalc";
import { checkSpatialEvidence, validateScenarioSpecs } from "../projects/validate";
import { FIXTURE_H1500, fixtureSpecs, WAREHOUSE_BASE_PARAMS } from "../tz/econ/fixtures";
import { buildProjectModel, storedPartOf } from "../tz/model";
import { resolveNorms } from "../tz/norms";
import { stableJson } from "../tz/version";
import { capacityNotEvaluated, type CapacityProof } from "./capacity-protocol";
import { simInputIdentity } from "./identity";
import { capacityEvidenceQualifies, parseCapacityProof, spatialEvidenceMatchesInput } from "./spatial-evidence";
import { createSpatialProjectSnapshot, parseSpatialProjectSnapshot } from "./spatial-bridge";
import { SPATIAL_MODEL_VERSION } from "./spatial-version";
import type { SimInput } from "./types";

const live = { paramDefs: paramSpecsFor("warehouse"), products: [FIXTURE_H1500], norms: resolveNorms(), paramDefsFrom: "code" as const };
function oldIdentity(input: SimInput) { return stableJson({ version: "sim-1.2.0", input }); }
function archive() {
  const params = { ...WAREHOUSE_BASE_PARAMS, activeAreaM2: 1000, inboundPalletsPerDay: 1, outboundPalletsPerDay: 0, internalPalletMovesPerDay: 0 };
  const specs = fixtureSpecs().map(s => ({ ...s, items: s.items.map(i => ({ ...i, quantityOverride: 1 })) }));
  const model = buildProjectModel({ ...live, facility: "warehouse", params, scenarios: specs });
  for (const spec of model.scenarios) {
    const input = model.simInputs[spec.key]?.calculated;
    if (input) spec.spatialEvidence = { input: structuredClone(input), sourceInputKey: oldIdentity(input), executionInputKey: "saved-old-execution",
      simModelVersion: "warehouse-dense-underlift-1.9.0", assessment: { status: "OK", terminal: true, headline: "Historical saved observation" },
      summary: { fleet: input.robots.count, requiredPerH: input.demand.peakPerH, achievedPerH: 999, queueEnd: 0, waitP95Min: 0 } };
  }
  return { ...storedPartOf(model, live.paramDefs), calculatedAt: "2026-10-18T12:00:00.000Z", sim: {} };
}
function legacyCapacity(input: SimInput): CapacityProof {
  const value = capacityNotEvaluated(input, "Saved previous engine proof");
  value.sourceInputKey = oldIdentity(input); value.testInputKey = oldIdentity(value.input); value.simModelVersion = "warehouse-dense-underlift-1.9.0";
  return value;
}

describe("explicit recalculation across SIM version upgrades", () => {
  it("keeps an old archive untouched and replaces its receipt only on explicit server recalculation", async () => {
    const saved = archive(), before = structuredClone(saved);
    const checked = validateScenarioSpecs(JSON.parse(JSON.stringify(saved.scenarios)), "warehouse", [FIXTURE_H1500.slug], ["pallet-transport"]);
    expect(checked.ok).toBe(true);
    if (!checked.ok) throw new Error(checked.errors.join("; "));
    const original = saved.scenarios[1]!.spatialEvidence!;
    expect(spatialEvidenceMatchesInput(original, original.input)).toBe(false);
    const computed = await resultsFromInputsAsync(live, { facility: "warehouse", params: saved.paramsUsed, scenarios: checked.value, snapshot: saved });
    const current = computed.results.scenarios[1]!.spatialEvidence!;
    expect(current.sourceInputKey).toBe(simInputIdentity(computed.model.simInputs.p1!.calculated!));
    expect(current.simModelVersion).toBe(SPATIAL_MODEL_VERSION);
    expect(current.input).toEqual(computed.model.simInputs.p1!.calculated);
    expect(current.assessment.status).toBe("NOT_EVALUATED");
    expect(current.summary.achievedPerH).toBe(0);
    expect(current).not.toHaveProperty("capacityProof");
    expect(saved).toEqual(before);
  }, 15_000);

  it("validates a legacy controlled receipt then converts it to a new request without adopting its old review", () => {
    const saved = archive(), nominal = saved.scenarios[1]!.spatialEvidence!;
    nominal.capacityProof = legacyCapacity(nominal.input);
    nominal.capacityNominalReview = { eligible: true, reasons: [], diagnostics: { pendingWaitMaxS: 0, blockedWaitMaxS: 0, unfinished: [] } };
    const before = structuredClone(nominal);
    const checked = checkSpatialEvidence(nominal);
    expect(checked.capacityRequested).toBe(true);
    expect(checked).not.toHaveProperty("capacityProof"); expect(checked).not.toHaveProperty("capacityNominalReview");
    expect(capacityEvidenceQualifies(before, nominal.input)).toBe(false);
    expect(() => parseCapacityProof(before.capacityProof, nominal.input)).toThrow();
    expect(nominal).toEqual(before);
  });

  it("rejects forged future/alternate/extra legacy keys and mixed protocol versions", () => {
    const nominal = archive().scenarios[1]!.spatialEvidence!;
    for (const key of [
      stableJson({ version: "sim-9999.0.0", input: nominal.input }),
      oldIdentity({ ...nominal.input, seed: nominal.input.seed + 1 }),
      stableJson({ version: "sim-1.2.0", input: nominal.input, permission: "trust-me" }),
      JSON.stringify({ version: "sim-1.2.0", input: nominal.input }),
    ]) expect(() => checkSpatialEvidence({ ...nominal, sourceInputKey: key })).toThrow(/Идентификатор/);
    for (const patch of [
      (proof: CapacityProof) => { proof.testInputKey = simInputIdentity(proof.input); },
      (proof: CapacityProof) => { proof.input.robots.count++; proof.testInputKey = oldIdentity(proof.input); },
      (proof: CapacityProof) => { proof.sourceInputKey = simInputIdentity(nominal.input); proof.testInputKey = simInputIdentity(proof.input); },
    ]) {
      const proof = legacyCapacity(nominal.input); patch(proof);
      expect(() => checkSpatialEvidence({ ...nominal, capacityProof: proof })).toThrow();
    }
  });

  it("does not loosen the current browser handoff protocol", () => {
    const nominal = archive().scenarios[1]!.spatialEvidence!;
    const snapshot = createSpatialProjectSnapshot({ requestId: "upgrade-check", scenarioKey: "p1", scenarioName: "Saved scenario", variantId: "calculated", input: nominal.input });
    expect(() => parseSpatialProjectSnapshot({ ...snapshot, inputKey: nominal.sourceInputKey })).toThrow(/Идентификатор/);
  });
});
