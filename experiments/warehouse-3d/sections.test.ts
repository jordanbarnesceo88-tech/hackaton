import { describe, expect, it } from "vitest";
import { siteSegmentIsClear } from "../../lib/sim/site-layout";
import { calculateSectionCase, createSectionInput, createSectionPlayback, previewSectionFrame, sectionCellCenter, sectionDone, sectionFrame, sectionGridRoute, stepSectionPlayback, summarizeSections } from "./sections";
import { createIncidentRuntime } from "./incidents";

function arrangeEncounter(state: ReturnType<typeof createSectionPlayback>) {
  for (const r of state.robots) {
    const start = { x: 22, y: r.id === 0 ? 21.11 : 19.78 }, target = { x: 22, y: r.id === 0 ? 18.8 : 22.8 };
    Object.assign(r, start, { phase: "transit", heading: r.id === 0 ? -Math.PI / 2 : Math.PI / 2, zoneIndex: r.id, leg: 0, point: 1, legs: [{ path: [start, target], working: false }] });
    Object.assign(r.safety!, { waitS: 0, blockedAtS: -Infinity, lastReplanS: -Infinity });
    Object.assign(state.sections[r.id]!, { status: "in_progress", robotId: r.id });
  }
}

function encounterState() {
  const input = createSectionInput({ areaM2: 1000, fleet: 2 }); input.demoIncidents!.enabled = false;
  const state = createSectionPlayback(input); arrangeEncounter(state); return state;
}

describe("isolated section-cleaning demonstration", () => {
  it("plans boustrophedon lanes inside rooms and connects through actual free space", () => {
    const input = createSectionInput();
    expect(input.layout.routingGraph!.clearanceM).toBeGreaterThanOrEqual(0.551 + 0.02);
    expect(input.sections).toHaveLength(5);
    expect(input.grid.freeMask.length).toBeLessThan(6000);
    for (const section of input.sections) {
      expect(section.sweepPaths.length).toBeGreaterThan(5);
      for (const path of section.sweepPaths) for (let i = 1; i < path.length; i++) expect(siteSegmentIsClear(input.layout, path[i - 1]!, path[i]!)).toBe(true);
      const connector = sectionGridRoute(input.grid, input.parking[0]!, section.targetCells[0]!);
      for (let i = 1; i < connector.length; i++) expect(siteSegmentIsClear(input.layout, sectionCellCenter(input.grid, connector[i - 1]!), sectionCellCenter(input.grid, connector[i]!))).toBe(true);
    }
  });

  it("coverage is unique and only changes when a robot is moving with its brush working", () => {
    const input = createSectionInput(), state = createSectionPlayback(input);
    expect(sectionFrame(state).telemetry.cleanedM2).toBe(0);
    stepSectionPlayback(state, 0);
    expect(state.coverageVersion).toBe(0);
    for (let tick = 0; tick < 1800; tick++) {
      const positions = state.robots.map((r) => ({ x: r.x, y: r.y, cleaned: r.cleanedCells, phase: r.phase }));
      stepSectionPlayback(state, 0.1);
      for (const r of state.robots) if (r.cleanedCells > positions[r.id]!.cleaned) {
        expect(Math.abs(r.x - positions[r.id]!.x) + Math.abs(r.y - positions[r.id]!.y)).toBeGreaterThan(0);
        expect(positions[r.id]!.phase === "working" || r.phase === "working").toBe(true);
      }
    }
    const frame = sectionFrame(state), area = input.grid.cellSizeM ** 2;
    expect(frame.telemetry.cleanedM2).toBeGreaterThan(0);
    expect(frame.sections.filter((s) => s.progress > 0).length).toBeGreaterThanOrEqual(3);
    expect(frame.telemetry.cleanedM2).toBe(state.covered.filter(Boolean).length * area);
    expect(frame.robots.reduce((sum, r) => sum + r.cleanedM2, 0)).toBeCloseTo(frame.telemetry.cleanedM2);
    state.covered.forEach((value, index) => {
      if (value) { expect(input.grid.freeMask[index]).toBe(1); expect(input.grid.sectionOf[index]).toBeGreaterThanOrEqual(0); }
    });
    const snapshot = structuredClone(state);
    for (const alpha of [0, 0.25, 0.5, 1]) {
      const preview = previewSectionFrame(state, alpha);
      expect(preview.coverage.covered).toEqual(state.covered);
      expect(preview.telemetry.cleanedM2).toBe(frame.telemetry.cleanedM2);
      expect(preview.tS).toBe(state.tS + alpha);
      expect(preview.provenance.observedAtS).toBe(state.tS);
      expect(state).toEqual(snapshot);
    }
    for (const task of frame.tasks) {
      expect(frame.sections.some((s) => s.id === task.zoneId && s.startS === task.startS)).toBe(true);
      const robotTask = frame.robots.find((r) => r.task?.zoneId === task.zoneId)?.task;
      if (robotTask) { expect(robotTask.from).toEqual(task.from); expect(robotTask.to).toEqual(task.to); }
    }
  });

  it("completion is exact target coverage and deterministic across batches", () => {
    const input = createSectionInput(), first = createSectionPlayback(input), second = createSectionPlayback(input);
    while (!sectionDone(first)) stepSectionPlayback(first, 60);
    while (!sectionDone(second)) stepSectionPlayback(second, 17);
    expect(summarizeSections(first)).toEqual(summarizeSections(second));
    expect(first.covered).toEqual(second.covered);
    expect(first.sections.every((s) => s.status === "completed")).toBe(true);
    expect(first.coverageVersion).toBe(input.sections.reduce((sum, s) => sum + s.targetCells.length, 0));
    expect(summarizeSections(first).coveragePct).toBeCloseTo(100);
    expect(first.robots.reduce((sum, r) => sum + r.tasksDone, 0)).toBe(5);
    for (const r of first.robots) expect(Object.values(r.timeByPhase).reduce((a, b) => a + b, 0)).toBeCloseTo(first.tS, 6);
    const summary = summarizeSections(first), count = first.coverageVersion;
    stepSectionPlayback(first, 100);
    expect(first.coverageVersion).toBe(count);
    expect(summarizeSections(first)).toEqual(summary);
  });

  it("finishes the small-floor incident encounter instead of repeating mirrored detours", () => {
    const input = createSectionInput({ areaM2: 1000, fleet: 2 }), state = createSectionPlayback(input);
    while (!sectionDone(state)) stepSectionPlayback(state, 60);
    expect(summarizeSections(state)).toMatchObject({ verdict: "COMPLETED", coveragePct: 100, completedSections: 5, incidentSummary: { resolved: 4 } });
    expect(state.tS).toBeLessThan(input.durationS);
    expect(state.coverageVersion).toBe(input.sections.reduce((n, s) => n + s.targetCells.length, 0));
    expect(state.traffic.collisionCount).toBe(0);
    expect(state.traffic.minimumClearanceM).toBeGreaterThanOrEqual(0.12 - 1e-8);
    expect(state.assessmentFacts!.zeroSocOperationRobotSeconds).toBe(0);
  });

  it("keeps one detour role during a conflict, releases after separation, and handles a new encounter", () => {
    const state = encounterState();
    for (let encounter = 0; encounter < 2; encounter++) {
      if (encounter) arrangeEncounter(state);
      const deadline = state.tS + 30;
      while (!state.transitCommitments.length && state.tS < deadline) stepSectionPlayback(state, 0.1);
      expect(state.transitCommitments).toHaveLength(1);
      const commitment = { ...state.transitCommitments[0]! }, partner = state.robots[commitment.partnerId]!, partnerReplans = partner.safety!.replans;
      while (state.transitCommitments.length && state.tS < deadline) {
        stepSectionPlayback(state, 0.1);
        if (state.transitCommitments.length) expect(partner.safety!.replans).toBe(partnerReplans);
      }
      expect(state.transitCommitments).toHaveLength(0);
      expect(state.robots[commitment.robotId]!.distanceM).toBeGreaterThan(commitment.startDistanceM);
      expect(state.traffic.collisionCount).toBe(0);
      expect(state.traffic.minimumClearanceM).toBeGreaterThanOrEqual(0.12 - 1e-8);
    }
  });

  it("releases a detour role when its robot faults and never moves or cleans its held body", () => {
    const state = encounterState();
    while (!state.transitCommitments.length && state.tS < 30) stepSectionPlayback(state, 0.1);
    expect(state.transitCommitments).toHaveLength(1);
    const id = state.transitCommitments[0]!.robotId, robot = state.robots[id]!, start = state.tS;
    state.input.demoIncidents = { version: "incidents-1.0.0", enabled: true, schedule: [{ id: "held-detour", code: "DRIVE_FAULT", robotId: id, detectedAtS: start, ackAtS: start + 15, diagnosingAtS: start + 30, recoveryAtS: start + 120, resolvedAtS: start + 180 }] };
    state.demoIncidents = createIncidentRuntime(state.input.demoIncidents, 2);
    const before = { x: robot.x, y: robot.y, cleanedCells: robot.cleanedCells, distanceM: robot.distanceM };
    for (let tick = 0; tick < 1800; tick++) {
      stepSectionPlayback(state, 0.1);
      expect({ x: robot.x, y: robot.y, cleanedCells: robot.cleanedCells, distanceM: robot.distanceM }).toEqual(before);
      expect(state.transitCommitments).toHaveLength(0);
      expect(state.traffic.reservations.find((r) => r.id === id)!.path).toHaveLength(1);
    }
    expect(robot.timeByPhase.incidentStop).toBeCloseTo(180);
    expect(state.traffic.collisionCount).toBe(0);
    expect(state.traffic.minimumClearanceM).toBeGreaterThanOrEqual(0.12 - 1e-8);
  });

  it("releases the pair role for a finished stationary body so its partner may replan again", () => {
    const state = encounterState();
    while (!state.transitCommitments.length && state.tS < 30) stepSectionPlayback(state, 0.1);
    expect(state.transitCommitments).toHaveLength(1);
    const commitment = state.transitCommitments[0]!, partner = state.robots[commitment.partnerId]!;
    state.robots[commitment.robotId]!.phase = "done";
    partner.safety!.lastReplanS = -Infinity;
    const deadline = state.tS + 10;
    while (!Number.isFinite(partner.safety!.lastReplanS) && state.tS < deadline) stepSectionPlayback(state, 0.1);
    expect(state.transitCommitments).toHaveLength(0);
    expect(Number.isFinite(partner.safety!.lastReplanS)).toBe(true);
    expect(state.traffic.collisionCount).toBe(0);
  });

  it("every actually driven segment avoids obstacles, including return to dock", () => {
    const input = createSectionInput({ areaM2: 1000, fleet: 2 });
    // Isolate geometric return-to-dock coverage from the independent incident/traffic encounter scenarios.
    input.demoIncidents!.enabled = false;
    const state = createSectionPlayback(input);
    while (!sectionDone(state)) {
      const before = state.robots.map(({ x, y }) => ({ x, y }));
      stepSectionPlayback(state, 0.1);
      for (const r of state.robots) expect(siteSegmentIsClear(input.layout, before[r.id]!, r)).toBe(true);
    }
    expect(state.events.some((e) => e.type === "charge-started")).toBe(true);
  });

  it("reports cleaning units and rejects unsupported or nonfinite inputs", () => {
    const model = calculateSectionCase();
    expect(model.kind).toBe("cleaning"); expect(model.finance).toBeNull();
    expect(model.simModelVersion).toBe("cleaning-demo-incidents-1.4.0");
    expect(model.summary.unit).toBe("м²/ч"); expect(model.summary.achievedM2PerH).toBeGreaterThan(0);
    for (const value of [NaN, Infinity, 999, 10001]) expect(() => createSectionInput({ areaM2: value })).toThrow();
    for (const fleet of [0, 1.5, 9]) expect(() => createSectionInput({ fleet })).toThrow();
    expect(() => createSectionInput({ peakFactor: 1.5 } as never)).toThrow();
  });

  it("limits heading changes and creates no coverage or travel during a working turn", () => {
    const input = createSectionInput(), state = createSectionPlayback(input);
    let workingTurns = 0;
    for (let tick = 0; tick < 2500; tick++) {
      const before = state.robots.map(({ x, y, heading, cleanedCells, distanceM }) => ({ x, y, heading, cleanedCells, distanceM }));
      stepSectionPlayback(state, 0.1);
      for (const r of state.robots) {
        const previous = before[r.id]!;
        expect(Math.abs(r.heading - previous.heading)).toBeLessThanOrEqual(input.robots.angularSpeedRadS * 0.1 + 1e-8);
        if (r.phase === "working" && r.maneuver === "turning") {
          workingTurns++;
          expect(r.x).toBe(previous.x); expect(r.y).toBe(previous.y);
          expect(r.distanceM).toBe(previous.distanceM); expect(r.cleanedCells).toBe(previous.cleanedCells);
          expect(r.vMps).toBe(0); expect(Math.abs(r.angularVelocityRadS)).toBeGreaterThan(0);
        }
      }
    }
    expect(workingTurns).toBeGreaterThan(10);
  });

  it("keeps moving through collinear grid points without slowing at each cell", () => {
    const input = createSectionInput(), state = createSectionPlayback(input), robot = state.robots[0]!;
    const path = input.sections[0]!.sweepPaths.find((p) => p.length >= 3)!;
    robot.x = path[0]!.x; robot.y = path[0]!.y; robot.phase = "working"; robot.zoneIndex = 0;
    robot.heading = Math.atan2(path[1]!.y - path[0]!.y, path[1]!.x - path[0]!.x);
    robot.legs = [{ path, working: true }]; robot.leg = 0; robot.point = 1;
    state.sections[0]!.status = "in_progress"; state.sections[0]!.robotId = 0;
    for (let i = 0; i < 15; i++) {
      stepSectionPlayback(state, 0.1);
      expect(robot.vMps).toBeCloseTo(input.robots.speedMps, 10);
      expect(robot.maneuver).toBe("moving");
    }
    expect(robot.distanceM).toBeCloseTo(0.975, 10);
    expect(robot.point).toBeGreaterThan(1);
  });

  it("cached substep preview matches canonical next-second poses and never credits future work", () => {
    const state = createSectionPlayback(createSectionInput());
    for (const time of [0, 12, 180, 240]) {
      if (state.tS < time) stepSectionPlayback(state, time - state.tS);
      const snapshot = structuredClone(state), canonical = sectionFrame(state);
      for (const alpha of [0.05, 0.25, 0.5, 1, 0.75]) {
        const preview = previewSectionFrame(state, alpha);
        expect(state).toEqual(snapshot);
        expect(preview.coverage).toEqual(canonical.coverage);
        expect(preview.telemetry).toEqual(canonical.telemetry);
        expect(preview.events).toEqual(canonical.events);
        for (const r of preview.robots) expect(siteSegmentIsClear(state.input.layout, r, r)).toBe(true);
      }
      const predicted = previewSectionFrame(state, 1);
      stepSectionPlayback(state, 1);
      const actual = sectionFrame(state);
      predicted.robots.forEach((r, i) => {
        expect(r.x).toBeCloseTo(actual.robots[i]!.x, 10);
        expect(r.y).toBeCloseTo(actual.robots[i]!.y, 10);
        expect(r.heading).toBeCloseTo(actual.robots[i]!.heading, 10);
      });
      for (const e of actual.events) {
        if (e.type === "incident") { expect(e.observedAtS).toBeCloseTo(e.tS, 10); continue; }
        expect(e.observedAtS).toBeCloseTo(e.tS + 0.1, 10);
        expect(e.observedAtS).toBeLessThanOrEqual(state.tS);
      }
    }
  });
});
