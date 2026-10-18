import { describe, expect, it } from "vitest";
import { summarize } from "../../lib/sim/metrics";
import { assessPlayback, createPlayback, isPlaybackDone, stepPlayback } from "./core";
import { assessCleaning, assessWarehouse } from "./assessment";
import { createSectionInput, createSectionPlayback, sectionDone, stepSectionPlayback, summarizeSections } from "./sections";
import { isWarehouseTrafficState, type DemoTrafficInput } from "./traffic";
import { prepareWarehouseTraffic } from "./traffic";
import { warehouseBaseInput } from "../../lib/sim/fixtures";
import { complexSite } from "./site";
import { calculateProjectPreview } from "./project-input";
import { createSpatialProjectSnapshot } from "../../lib/sim/spatial-bridge";

const raw = warehouseBaseInput(3);
raw.siteLayout = complexSite(10000, 1, true);
raw.layout.receivingDocksCount = raw.siteLayout.receiving.length;
raw.layout.shippingDocksCount = raw.siteLayout.shipping.length;
const base = prepareWarehouseTraffic(raw);
function runWarehouse(input: DemoTrafficInput) {
  const state = createPlayback(input);
  while (!isPlaybackDone(state)) stepPlayback(state, 60);
  return state;
}

describe("transparent demo goal assessment", () => {
  it("rejects the actual CONFIRMED-but-zero-deliveries counterexample as a partial business result", () => {
    const input = structuredClone(base);
    input.demand = { avgPerH: 30, peakPerH: 30, warmupMin: 0, peakMin: 1 }; input.robots.handlingSec = 3600;
    input.demoIncidents!.enabled = false;
    const state = runWarehouse(input), legacy = summarize(state), assessment = assessWarehouse(state, legacy);
    expect(legacy).toMatchObject({ verdict: "CONFIRMED", arrivedPeak: 1, donePeak: 0, queueEnd: 0, servedShare: 1 });
    expect(assessment.status).toBe("PARTIAL");
    expect(assessment.checks.find((c) => c.id === "intake_sla")!.status).toBe("PASS");
    expect(assessment.checks.find((c) => c.id === "throughput")!).toMatchObject({ status: "FAIL", measured: { achievedPerH: 0, arrivedPerH: 60, requiredPerH: 30 } });
    expect(assessment.checks.find((c) => c.id === "unfinished")!).toMatchObject({ measured: { pending: 0, active: 1, completedTotal: 0 }, evidence: [{ tS: 60, taskId: 0, robotId: 0 }] });
  });

  it("does not interpret no exposure or insufficient random arrivals as proven capacity failure", () => {
    expect(assessPlayback(createPlayback(base)).status).toBe("NOT_EVALUATED");
    const input = structuredClone(base); input.demoIncidents!.enabled = false;
    input.demand = { avgPerH: 10, peakPerH: 10, warmupMin: 0, peakMin: 30 };
    let found = false;
    for (let seed = 1; seed <= 20 && !found; seed++) {
      input.seed = seed;
      const state = runWarehouse(input), result = assessPlayback(state);
      const throughput = result.checks.find((c) => c.id === "throughput")!, intake = result.checks.find((c) => c.id === "intake_sla")!;
      if (throughput.status === "NOT_EVALUATED" && intake.status === "PASS") {
        found = true; expect(result.status).toBe("NOT_EVALUATED");
        expect(throughput.measuredText).toContain("поступило");
      }
    }
    expect(found).toBe(true);
  });

  it("fails closed for observed collisions, invalid state and missing safety measurements", () => {
    const state = createPlayback(base);
    if (!isWarehouseTrafficState(state)) throw new Error("no safety controller");
    state.demoTraffic.collisionCount = 1;
    expect(assessPlayback(state).status).toBe("FAIL");
    state.demoTraffic.collisionCount = 0; state.demoTraffic.minimumClearanceM = null;
    expect(assessPlayback(state).checks.find((c) => c.id === "safety")!.status).toBe("NOT_EVALUATED");
    state.robots[0]!.x = NaN;
    expect(assessPlayback(state).status).toBe("FAIL");
  });

  it("checks stationary shelf clearance even when there is only one robot", () => {
    const input = structuredClone(base); input.robots.count = 1;
    input.demoTraffic.initialPositions = input.demoTraffic.initialPositions.slice(0, 1);
    input.demand = { avgPerH: 0, peakPerH: 0, warmupMin: 0, peakMin: 1 };
    input.demoIncidents!.enabled = false;
    input.demoIncidents!.schedule = [];
    const single = createPlayback(input);
    if (!isWarehouseTrafficState(single)) throw new Error("no safety controller");
    expect(assessPlayback(single).checks.find((c) => c.id === "safety")!.status).toBe("NOT_EVALUATED");
    // Deliberately expose the single body to stock; the distant initial parking
    // position is not evidence of a measured shelf clearance.
    const pod = single.demoUnderlift!.pods[0]!, dock = single.demoUnderlift!.docks.find(d => d.x === pod.home.x && d.y === pod.home.y)!;
    Object.assign(single.robots[0]!, dock.entry);
    stepPlayback(single);
    expect(assessPlayback(single).checks.find((c) => c.id === "safety")!.status).toBe("PASS");
    expect(assessPlayback(single).checks.find((c) => c.id === "traffic_wait")!).toMatchObject({ status: "PASS", measured: { totalWaitS: 0, maxCurrentWaitS: 0 }, affectsOverall: false });
    Object.assign(single.robots[0]!, { x: pod.x, y: pod.y });
    single.robots[0]!.phase = "waitCharger"; single.robots[0]!.pointIdx = -1;
    stepPlayback(single);
    expect(assessPlayback(single).checks.find((c) => c.id === "safety")!.status).toBe("FAIL");
  });

  it("requires actual task completion after first 100% coverage and keeps return-to-base separate", () => {
    const input = createSectionInput(); input.demoIncidents!.enabled = false;
    const state = createSectionPlayback(input), target = input.sections.reduce((n, s) => n + s.targetCells.length, 0);
    while (!sectionDone(state) && state.coverageVersion < target) stepSectionPlayback(state, 0.1);
    expect(summarizeSections(state)).toMatchObject({ verdict: "PARTIAL", completedSections: 4 });
    const atFirstCoverage = assessCleaning(state);
    expect(atFirstCoverage.status).toBe("RUNNING"); expect(sectionDone(state)).toBe(false);
    expect(atFirstCoverage.checks.find((c) => c.id === "coverage")!.status).toBe("PASS");
    expect(atFirstCoverage.checks.find((c) => c.id === "section_tasks")!).toMatchObject({ status: "FAIL", evidence: [{ zoneId: "shipping", robotId: 3 }] });
    while (!sectionDone(state)) stepSectionPlayback(state, 60);
    const terminal = assessCleaning(state);
    expect(terminal.status).toBe("OK");
    expect(terminal.checks.find((c) => c.id === "readiness")!).toMatchObject({ status: "NOT_EVALUATED", affectsOverall: false });
    expect(terminal.checks.find((c) => c.id === "return_to_base")!.affectsOverall).toBe(false);
  });

  it("reports a real horizon timeout as PARTIAL with remaining zones and no collision failure", () => {
    const input = createSectionInput({ fleet: 2, areaM2: 1000 }); input.durationS = 600;
    const state = createSectionPlayback(input);
    while (!sectionDone(state)) stepSectionPlayback(state, 60);
    const result = assessCleaning(state);
    expect(result).toMatchObject({ status: "PARTIAL", terminal: true, observedAtS: 600 });
    expect(result.checks.find((c) => c.id === "coverage")!.status).toBe("FAIL");
    expect(result.checks.find((c) => c.id === "section_tasks")!.evidence.map((e) => e.zoneId)).toHaveLength(5);
    expect(result.checks.find((c) => c.id === "safety")!.status).toBe("PASS");
    const traffic = result.checks.find((c) => c.id === "traffic_wait")!;
    expect((traffic.measured as { totalWaitS: number }).totalWaitS).toBeGreaterThan(0);
    expect(traffic.affectsOverall).toBe(false);
    expect(traffic.evidence[0]!.robotId).toBeDefined();
  });

  it("records impossible zero-SOC operations at the real canonical moment, even if coverage later completes", () => {
    const input = createSectionInput(); input.demoIncidents!.enabled = false; input.robots.autonomyH = 0.001;
    const state = createSectionPlayback(input); stepSectionPlayback(state, 20);
    const result = assessCleaning(state), energy = result.checks.find((c) => c.id === "energy")!;
    expect(result.status).toBe("FAIL"); expect(energy.status).toBe("FAIL");
    expect(state.assessmentFacts!.zeroSocOperationRobotSeconds).toBeGreaterThan(0);
    expect(energy.evidence[0]!.tS).toBeLessThan(20);
    expect(energy.evidence[0]!.robotId).toBeDefined();
  });

  it.each([false, true])("does not confuse the final powered parking step with starting empty (empty=%s)", (startsEmpty) => {
    const input = createSectionInput({ fleet: 1 }); input.demoIncidents!.enabled = false;
    const state = createSectionPlayback(input), robot = state.robots[0]!;
    const start = { x: robot.x, y: robot.y }, end = { x: robot.x + 0.09, y: robot.y };
    robot.phase = "parking"; robot.heading = 0;
    robot.legs = [{ path: [start, end], working: false }]; robot.leg = 0; robot.point = 1;
    // Exactly the energy consumed by one 0.1 s non-working tick: zero is reached only at its endpoint.
    robot.soc = startsEmpty ? 0 : 0.1 / (input.robots.autonomyH * 3600) * 0.65;
    stepSectionPlayback(state, 0.1);
    expect(robot.phase).toBe("done"); expect(robot.soc).toBe(0);
    expect(robot.x).toBeCloseTo(end.x, 12); expect(robot.distanceM).toBeCloseTo(0.09, 12);
    expect(state.assessmentFacts!.zeroSocOperationRobotSeconds).toBe(startsEmpty ? 0.1 : 0);
    expect(assessCleaning(state).checks.find((c) => c.id === "energy")!.status).toBe(startsEmpty ? "FAIL" : "PASS");
  });

  it("exports authoritative terminal assessment and marks the legacy warehouse verdict scope", () => {
    const input = structuredClone(raw); input.demand = { avgPerH: 30, peakPerH: 30, warmupMin: 0, peakMin: 1 };
    const model = calculateProjectPreview(createSpatialProjectSnapshot({ requestId: "assessment-unit", scenarioKey: "purchase", scenarioName: "Bounded export", variantId: "calculated", input }));
    expect(model.summary.verdictScope).toBe("intake-sla");
    expect(model.assessment).toMatchObject({ terminal: true, scope: "modeled-flow" });
    for (const c of model.assessment.checks) expect(c.label && c.measuredText && c.limitText && c.why && c.action).toBeTruthy();
  });
});
