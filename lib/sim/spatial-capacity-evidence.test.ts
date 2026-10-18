import { describe, expect, it } from "vitest";
import { checkSpatialEvidence } from "../projects/validate";
import type { SpatialEvidence } from "../tz/types";
import { capacityNotEvaluated, deriveCapacityInput, type CapacityProof } from "./capacity-protocol";
import { warehouseBaseInput } from "./fixtures";
import { simInputIdentity } from "./identity";
import { capacityEvidenceQualifies, capacityProofMatchesInput, parseCapacityProof } from "./spatial-evidence";
import { SPATIAL_MODEL_VERSION } from "./spatial-version";
import type { SimInput } from "./types";

function source(): SimInput {
  return { ...warehouseBaseInput(6), transportWorkflow: "closed-pod-1" };
}
function validProof(input = source()): CapacityProof {
  const proof = capacityNotEvaluated(input, "Measured server protocol");
  const delivered = Math.ceil(input.demand.peakPerH * 2);
  return { ...proof, terminal: true, status: "PASS", executionInputKey: "actual-controlled-execution",
    metrics: { ...proof.metrics, arrivedPerH: Math.ceil(proof.metrics.offeredPerH * 2) / 2, deliveredCohort: delivered, closedCohort: delivered,
      deliveredCohortPerH: delivered / 2, closedCohortPerH: delivered / 2 } };
}
function evidence(input = source()): SpatialEvidence {
  return { input, sourceInputKey: simInputIdentity(input), executionInputKey: "nominal-execution", simModelVersion: SPATIAL_MODEL_VERSION,
    assessment: { status: "PARTIAL", terminal: true, headline: "Original PARTIAL" },
    summary: { fleet: input.robots.count, requiredPerH: input.demand.peakPerH, achievedPerH: 1, queueEnd: 1, waitP95Min: 1 } };
}

describe("capacity protocol JSON and freshness boundary", () => {
  it("rejects more deliveries than actual arrivals and fractional arrival counters", () => {
    const input = source(), over = validProof(input), fractional = validProof(input);
    over.metrics.deliveredCohort = over.metrics.closedCohort = over.metrics.arrivedPerH * 2 + 1;
    over.metrics.deliveredCohortPerH = over.metrics.closedCohortPerH = over.metrics.deliveredCohort / 2;
    fractional.metrics.arrivedPerH += 0.125;
    for (const proof of [over, fractional]) {
      expect(() => parseCapacityProof(proof, input)).toThrow(/поступлений/);
      expect(capacityProofMatchesInput(proof, input)).toBe(false);
    }
  });
  it("accepts detached exact controlled receipts and preserves nominal PARTIAL through JSON validation", () => {
    const input = source(), original = evidence(input);
    original.capacityRequested = true; original.capacityProof = validProof(input);
    const checked = checkSpatialEvidence(JSON.parse(JSON.stringify(original)));
    expect(checked).toEqual(original); expect(checked.assessment.status).toBe("PARTIAL");
    expect(capacityProofMatchesInput(checked.capacityProof, input)).toBe(true);
    checked.capacityProof!.input.seed++;
    expect(original.capacityProof!.input.seed).toBe(input.seed);
  });

  it("retains explicit timeout/unknown proof, including zero load, without making it qualifying", () => {
    for (const input of [source(), { ...source(), demand: { ...source().demand, peakPerH: 0 } }]) {
      const proof = capacityNotEvaluated(input, "Budget exhausted");
      expect(parseCapacityProof(proof, input)).toEqual(proof);
      expect(capacityProofMatchesInput(proof, input)).toBe(false);
      expect(checkSpatialEvidence({ ...evidence(input), capacityProof: proof }).capacityProof!.status).toBe("NOT_EVALUATED");
    }
  });

  it("does not backfill a capacity proof into older nominal evidence", () => {
    const original = evidence();
    const checked = checkSpatialEvidence(original);
    expect(checked).not.toHaveProperty("capacityRequested"); expect(checked).not.toHaveProperty("capacityProof");
    for (const flag of [false, "true", 1, {}]) expect(() => checkSpatialEvidence({ ...original, capacityRequested: flag })).toThrow(/true/);
  });

  it("a controlled profile cannot replace the nominal financial source", () => {
    const controlled = deriveCapacityInput(source());
    expect(() => checkSpatialEvidence(evidence(controlled))).toThrow(/номинальный/);
  });

  it("rejects forged N/C/seed/layout/mix and undeclared load/window/profile overrides even with rewritten keys", () => {
    const input = source();
    const patches: ((p: CapacityProof) => void)[] = [
      p => { p.input.robots.count++; }, p => { p.input.layout.chargers++; }, p => { p.input.seed++; },
      p => { p.input.layout.mainAisleWidthM++; }, p => { p.input.demand.mix = { inbound: 0, outbound: 1, internal: 0 }; },
      p => { p.input.demand.peakPerH++; }, p => { p.input.demand.peakMin = 240; },
      p => { p.input.demand.offered!.perH++; }, p => { p.input.robots.speedMps++; },
    ];
    for (const patch of patches) {
      const proof = validProof(input); patch(proof); proof.testInputKey = simInputIdentity(proof.input);
      expect(() => parseCapacityProof(proof, input)).toThrow(/изменила/);
      expect(capacityProofMatchesInput(proof, input)).toBe(false);
    }
  });

  it("rejects wrong source identity, protocol, nested/unknown data and nonfinite/false cohort metrics", () => {
    const input = source();
    const patches: ((p: CapacityProof) => void)[] = [
      p => { p.sourceInputKey = "wrong-source"; }, p => { p.testInputKey = "wrong-test"; },
      p => { p.protocolId = "other-profile" as CapacityProof["protocolId"]; },
      p => { Object.assign(p, { credentials: "not-saved" }); },
      p => { Object.assign(p.metrics, { madeUpCapacity: 9999 }); },
      p => { p.metrics.offeredPerH = Number.NaN; }, p => { p.metrics.closedCohort = -1; },
      p => { p.metrics.closedCohort = p.metrics.deliveredCohort + 1; },
      p => { p.metrics.closedCohortPerH++; }, p => { p.metrics.measurementEndS++; },
      p => { p.terminal = false; },
      p => { p.qualificationDiagnostics.unfinished = [{ taskId: 1, kind: "inbound", operation: "transport", ageS: 3, pendingWaitS: Number.POSITIVE_INFINITY, blockedWaitS: 0 }]; },
    ];
    for (const patch of patches) {
      const proof = validProof(input); patch(proof);
      expect(() => parseCapacityProof(proof, input)).toThrow();
      expect(() => checkSpatialEvidence({ ...evidence(input), capacityProof: proof })).toThrow();
    }
  });

  it("current qualification fails for old engine, changed original input and missing proof", () => {
    const input = source(), proof = validProof(input);
    proof.simModelVersion = "old-spatial-engine";
    expect(capacityProofMatchesInput(proof, input)).toBe(false);
    expect(parseCapacityProof(proof, input).simModelVersion).toBe("old-spatial-engine");
    proof.simModelVersion = SPATIAL_MODEL_VERSION;
    const changed = structuredClone(input); changed.seed++;
    expect(capacityProofMatchesInput(proof, changed)).toBe(false);
    expect(capacityProofMatchesInput(undefined, input)).toBe(false);
    expect(capacityProofMatchesInput(proof, undefined)).toBe(false);
    expect(proof.input).toEqual(deriveCapacityInput(input));
  });

  it("a controlled PASS never qualifies without a current healthy nominal review", () => {
    const input = source(), saved = { ...evidence(input), capacityProof: validProof(input) };
    expect(capacityEvidenceQualifies(saved, input)).toBe(false);
    const withReview: SpatialEvidence = { ...saved, capacityNominalReview: { eligible: true, reasons: [], diagnostics: { pendingWaitMaxS: 0, blockedWaitMaxS: 0, unfinished: [] } } };
    expect(capacityEvidenceQualifies(withReview, input)).toBe(true);
    expect(withReview.assessment.status).toBe("PARTIAL");
    for (const status of ["FAIL", "NOT_EVALUATED"] as const) expect(capacityEvidenceQualifies({ ...withReview, assessment: { ...withReview.assessment, status } }, input)).toBe(false);
    expect(capacityEvidenceQualifies({ ...withReview, capacityNominalReview: { eligible: false, reasons: ["Nominal queue failed"] } }, input)).toBe(false);
    withReview.capacityNominalReview!.diagnostics!.blockedWaitMaxS = input.thresholds.p95WaitMaxMin * 60 + 1;
    expect(capacityEvidenceQualifies(withReview, input)).toBe(false);
    expect(() => checkSpatialEvidence({ ...withReview, capacityRequested: true })).toThrow(/противоречит/);
  });

  it("zero deliveries, closed returns or observed arrivals cannot carry PASS", () => {
    const input = source();
    for (const field of ["arrivedPerH", "deliveredCohortPerH", "closedCohortPerH"] as const) {
      const proof = validProof(input); proof.metrics[field] = 0;
      if (field === "deliveredCohortPerH") { proof.metrics.deliveredCohort = 0; proof.metrics.closedCohort = 0; proof.metrics.closedCohortPerH = 0; }
      if (field === "closedCohortPerH") proof.metrics.closedCohort = 0;
      expect(() => parseCapacityProof(proof, input)).toThrow(/PASS|поступлений/);
      expect(capacityProofMatchesInput(proof, input)).toBe(false);
    }
  });

  it("rejects contradictory nominal reviews and unbounded or duplicate unfinished diagnostics", () => {
    const input = source(), base = { ...evidence(input), capacityRequested: true, capacityProof: validProof(input) };
    const row = { taskId: 1, kind: "inbound", operation: "transport", ageS: 20, pendingWaitS: 10, blockedWaitS: 0 };
    for (const review of [
      { eligible: true, reasons: [], diagnostics: undefined },
      { eligible: true, reasons: ["Known nominal failure"], diagnostics: { pendingWaitMaxS: 0, blockedWaitMaxS: 0, unfinished: [] } },
      { eligible: false, reasons: [] },
      { eligible: false, reasons: ["Review"], diagnostics: { pendingWaitMaxS: 0, blockedWaitMaxS: 0, unfinished: [row] } },
      { eligible: false, reasons: ["Review"], diagnostics: { pendingWaitMaxS: 10, blockedWaitMaxS: 0, unfinished: [row, row] } },
      { eligible: false, reasons: ["Review"], diagnostics: { pendingWaitMaxS: 10, blockedWaitMaxS: 0, unfinished: [{ ...row, ageS: 1 }] } },
      { eligible: false, reasons: ["Review"], diagnostics: { pendingWaitMaxS: 0, blockedWaitMaxS: 0, unfinished: Array(60_001).fill(row) } },
    ]) expect(() => checkSpatialEvidence({ ...base, capacityNominalReview: review })).toThrow();
  });
});
