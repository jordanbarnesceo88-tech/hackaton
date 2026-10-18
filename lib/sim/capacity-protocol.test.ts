import { describe, expect, it } from "vitest";
import { assessCapacityRun, capacityCohort, capacityNotEvaluated, createQualificationTracker, deriveCapacityInput, nominalCapacityEligibility, observeQualification, qualificationDiagnostics, type CapacityAssessment } from "./capacity-protocol";
import { createSim, expectedTasks, isDone, stepSim } from "./engine";
import { warehouseBaseInput } from "./fixtures";
import { bernoulliArrivals, createRng, nextRandom } from "./rng";
import type { SimTask } from "./state";
import type { SimInput } from "./types";

const source = () => ({ ...warehouseBaseInput(3), transportWorkflow: "closed-pod-1" as const });
const healthy: CapacityAssessment = { terminal: true, checks: ["safety", "energy", "validity", "underlift", "exposure", "intake_sla"].map(id => ({ id, category: ["exposure", "intake_sla"].includes(id) ? "goal" : "safety", status: "PASS", affectsOverall: true })) };
const emptyDiagnostics = () => ({ pendingWaitMaxS: 0, blockedWaitMaxS: 0, unfinished: [] });
function task(patch: Partial<SimTask> = {}): SimTask {
  return { id: 1, kind: "outbound", operation: "transport", countsTowardDemand: true, podId: "pod-1", fromPoint: -1, fromX: 20, fromY: 10, toPoint: 1, toX: 30, toY: 10, arrivalS: 100, startS: 110, doneS: 200, ...patch };
}
const returned = (patch: Partial<SimTask> = {}) => task({ id: -1, operation: "return-pod", countsTowardDemand: false, parentTaskId: 1, fromPoint: 1, fromX: 30, toPoint: -1, toX: 20, arrivalS: 200, startS: 201, doneS: 250, ...patch });

describe("fixed controlled capacity protocol", () => {
  it("keeps all source fields except the declared horizon/profile and never mutates the nominal input", () => {
    const input = source(), before = structuredClone(input), test = deriveCapacityInput(input);
    expect(input).toEqual(before);
    expect(test).toEqual({ ...before, demand: { ...before.demand, warmupMin: 15, peakMin: 120, offered: { protocol: "periodic-capacity-1", perH: before.demand.peakPerH * 1.1 } } });
    expect(() => deriveCapacityInput(test)).toThrow();
  });
  it("admits periodic events on ceiling seconds without an initial burst and survives a serialized checkpoint", () => {
    const input = source(); input.demand = { ...input.demand, warmupMin: 0, peakMin: 1, offered: { protocol: "periodic-capacity-1", perH: 720 } };
    const a = createSim(input); stepSim(a); expect(a.tasks).toHaveLength(0);
    while (a.tS < 23) stepSim(a);
    const b = structuredClone(a);
    while (!isDone(a)) stepSim(a);
    while (!isDone(b)) stepSim(b);
    expect(a).toEqual(b);
    expect(a.tasks.map(t => t.arrivalS)).toEqual([5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
  });
  it("leaves the stochastic default RNG draws and event clocks unchanged", () => {
    const input = warehouseBaseInput(2); input.demand = { ...input.demand, warmupMin: 0, peakMin: 3 };
    const rng = createRng(input.seed), expected: number[] = [];
    for (let t = 0; t < 180; t++) {
      const arrivals = bernoulliArrivals(() => nextRandom(rng), input.demand.peakPerH / 3600, 1);
      for (let n = 0; n < arrivals; n++) { expected.push(t); nextRandom(rng); nextRandom(rng); nextRandom(rng); }
    }
    const state = createSim(input); while (!isDone(state)) stepSim(state);
    expect(state.tasks.map(t => t.arrivalS)).toEqual(expected); expect(state.rng).toEqual(rng);
  });
  it("counts offered load for limits and rejects invalid offered profiles", () => {
    const input = source(); input.demand.offered = { protocol: "periodic-capacity-1", perH: 1_000_001 };
    expect(expectedTasks(input.demand)).toBeGreaterThan(1_000_000); expect(createSim(input).precheck).toBe("invalid");
    for (const perH of [0, -1, NaN, Infinity]) { input.demand.offered.perH = perH; expect(createSim(input).precheck).toBe("invalid"); }
    input.demand.offered = { protocol: "unknown", perH: 100 } as unknown as NonNullable<SimInput["demand"]["offered"]>;
    expect(createSim(input).precheck).toBe("invalid");
  });
});

describe("customer cohort and required service cycles", () => {
  it("does not count warm-up carry-in, drain, starts or service tasks as delivered customer units", () => {
    const list = [task(), returned(), task({ id: 2, arrivalS: 99 }), task({ id: 3, doneS: 301 }), task({ id: 4, doneS: null }), task({ id: 5, arrivalS: 300 })];
    expect(capacityCohort(list, 100, 300)).toEqual({ arrived: 3, delivered: 1, closed: 1 });
  });
  it("requires one matching real outbound return completed by the window end", () => {
    for (const children of [[], [returned({ doneS: null })], [returned({ doneS: 301 })], [returned({ podId: "wrong" })], [returned({ toX: 21 })], [returned({ toPoint: 2 })], [returned({ arrivalS: 199 })], [returned({ startS: 199 })], [returned(), returned({ id: -2 })]]) {
      expect(capacityCohort([task(), ...children], 100, 300)).toEqual({ arrived: 1, delivered: 1, closed: 0 });
    }
    expect(capacityCohort([task(), returned()], 100, 300).closed).toBe(1);
  });
  it("requires actual inbound prefetch, but no invented return for internal customer transfers", () => {
    const inbound = task({ kind: "inbound", fromPoint: 0, fromX: 0, toPoint: -1, toX: 20, startS: 160, doneS: 200 });
    const child = task({ id: -1, kind: "inbound", operation: "prefetch-pod", countsTowardDemand: false, parentTaskId: 1, fromPoint: -1, fromX: 20, toPoint: 0, toX: 0, startS: 101, doneS: 150 });
    expect(capacityCohort([inbound], 100, 300).closed).toBe(0);
    expect(capacityCohort([inbound, child], 100, 300).closed).toBe(1);
    expect(capacityCohort([inbound, { ...child, doneS: 170 }], 100, 300).closed).toBe(0);
    expect(capacityCohort([task({ kind: "internal" })], 100, 300).closed).toBe(1);
  });
});

describe("qualification guards", () => {
  it("allows a nominal output-window PARTIAL only as a separate healthy candidate, never by hiding a failed SLA or safety", () => {
    expect(nominalCapacityEligibility({ ...healthy, checks: [...healthy.checks, { id: "throughput", category: "goal", status: "FAIL", affectsOverall: true }] }, source(), emptyDiagnostics()).eligible).toBe(true);
    for (const id of ["intake_sla", "exposure", "validity", "energy", "safety", "underlift"]) {
      expect(nominalCapacityEligibility({ ...healthy, checks: healthy.checks.map(c => c.id === id ? { ...c, status: "FAIL" } : c) }, source(), emptyDiagnostics()).eligible).toBe(false);
    }
    expect(nominalCapacityEligibility(healthy, source()).eligible).toBe(false);
    expect(nominalCapacityEligibility(healthy, source(), { ...emptyDiagnostics(), pendingWaitMaxS: 601 }).eligible).toBe(false);
    expect(nominalCapacityEligibility(healthy, source(), { ...emptyDiagnostics(), blockedWaitMaxS: 601 }).eligible).toBe(false);
  });
  it("reports moving ages without inventing a full-cycle SLA; real bound prefetch starts customer work", () => {
    const state = createSim(source()), parent = task({ kind: "inbound", fromPoint: 0, fromX: 0, toPoint: -1, toX: 20, startS: null, doneS: null });
    const child = task({ id: -1, kind: "inbound", operation: "prefetch-pod", countsTowardDemand: false, parentTaskId: 1, fromPoint: -1, fromX: 20, toPoint: 0, toX: 0, startS: 101, doneS: null });
    state.tS = 1500; state.tasks = [parent, child]; state.robots[0]!.task = child;
    const diagnostics = qualificationDiagnostics(state, createQualificationTracker());
    expect(diagnostics.unfinished[0]!.ageS).toBe(1400); expect(diagnostics.pendingWaitMaxS).toBe(0);
    expect(nominalCapacityEligibility(healthy, source(), diagnostics).eligible).toBe(true);
  });
  it("tracks real continuous blocking, without treating retry/reason changes as movement", () => {
    const state = Object.assign(createSim(source()), { demoTraffic: { bodies: { 0: { blocked: true, waitS: 0, reason: "A" } } } }), tracker = createQualificationTracker();
    observeQualification(tracker, state); state.demoTraffic.bodies[0].reason = "B"; observeQualification(tracker, state);
    expect(tracker.blockedWaitMaxS).toBe(2);
    state.robots[0]!.x += 1; observeQualification(tracker, state); expect(tracker.runs[0]).toBe(0);
  });
  it("keeps unexecuted/zero-goal evidence NOT_EVALUATED and rejects protocol tampering", () => {
    const input = source(); input.demand.peakPerH = 0;
    expect(capacityNotEvaluated(input, "No goal").status).toBe("NOT_EVALUATED");
    const nominal = source(), test = deriveCapacityInput(nominal), state = createSim(test);
    expect(assessCapacityRun(nominal, state, healthy, emptyDiagnostics()).status).toBe("NOT_EVALUATED");
    state.input.robots.count++; expect(() => assessCapacityRun(nominal, state, healthy, emptyDiagnostics())).toThrow();
  });
});
