import { describe, expect, it } from "vitest";
import { calculateCase, createPlayback, playbackFrame, previewInterpolate, stepPlayback } from "./core";
import { createIncidentRuntime, defaultDemoIncidents, incidentSummary, type IncidentCode, type IncidentConfig } from "./incidents";
import { createSectionInput, createSectionPlayback, sectionDone, sectionFrame, stepSectionPlayback, summarizeSections } from "./sections";
import { isWarehouseTrafficState, type DemoTrafficInput } from "./traffic";
import "./robot-history.js";

const base = calculateCase("complex", { fleet: 3 }).input as DemoTrafficInput;
function scheduled(code: IncidentCode, robotId: number, start: number): IncidentConfig {
  return { version: "incidents-1.0.0", enabled: true, schedule: [{ id: "test-fault", code, robotId, detectedAtS: start, ackAtS: start + 15, diagnosingAtS: start + 30, recoveryAtS: start + 120, resolvedAtS: start + 180 }] };
}

describe("canonical simulated incidents", () => {
  it("validates bounded schedules and publishes the expected initial critical incident", () => {
    const input = structuredClone(base), state = createPlayback(input);
    stepPlayback(state, 1200);
    const incident = playbackFrame(state).incidents[0]!;
    expect(incident).toMatchObject({ code: "DRIVE_FAULT", active: true, status: "acknowledged", detectedAtS: 1180, ackAtS: 1195, diagnosingAtS: null, recoveryAtS: null, resolvedAtS: null, simulation: true, workflow: "automatic-demo" });
    expect(incident.planned.resolvedAtS).toBe(1360);
    expect(playbackFrame(state).incidents).toHaveLength(1);
    expect(defaultDemoIncidents("cleaning", 1).schedule.every((s) => s.robotId === 0)).toBe(true);
    for (const bad of [scheduled("DRIVE_FAULT", 99, 0), { ...scheduled("DRIVE_FAULT", 0, 0), schedule: [{ ...scheduled("DRIVE_FAULT", 0, 0).schedule[0]!, resolvedAtS: 10 }] }]) expect(() => createIncidentRuntime(bad, 3)).toThrow();
  });

  it("pauses real loading and holds its task/body until resolution, then resumes the same operation", () => {
    const probeInput = structuredClone(base); probeInput.demoIncidents!.enabled = false;
    const probe = createPlayback(probeInput);
    let id = -1;
    while (probe.tS < 1800 && id < 0) { stepPlayback(probe); id = probe.robots.find((r) => r.phase === "loading")?.id ?? -1; }
    expect(id).toBeGreaterThanOrEqual(0);
    const start = probe.tS, input = structuredClone(base); input.demoIncidents = scheduled("DRIVE_FAULT", id, start);
    const state = createPlayback(input); stepPlayback(state, start);
    const r = state.robots[id]!, task = r.task!, frozen = { x: r.x, y: r.y, timerS: r.timerS, loaded: r.loaded, taskId: task.id };
    const loadingBefore = playbackFrame(state).robots[id]!.timeByPhase.loading;
    expect(r.phase).toBe("loading");
    for (let i = 0; i < 180; i++) {
      expect({ x: r.x, y: r.y, timerS: r.timerS, loaded: r.loaded, taskId: r.task?.id }).toEqual(frozen);
      expect(task.doneS).toBeNull();
      stepPlayback(state);
      if (isWarehouseTrafficState(state)) {
        expect(state.demoTraffic.collisionCount).toBe(0);
        expect(state.demoTraffic.minimumClearanceM).toBeGreaterThanOrEqual(0.15 - 1e-8);
        expect(state.demoTraffic.reservations.find((p) => p.id === id)!.path).toHaveLength(1);
      }
    }
    expect(incidentSummary(state)).toMatchObject({ resolved: 1, stoppedRobotSeconds: 180 });
    expect(playbackFrame(state).robots[id]!.timeByPhase.loading).toBe(loadingBefore);
    expect(playbackFrame(state).robots[id]!.incidentStopS).toBe(180);
    expect(Object.values(playbackFrame(state).robots[id]!.timeByPhase).reduce((sum, n) => sum + n, 0)).toBe(state.tS);
    stepPlayback(state);
    expect(r.timerS).toBeLessThan(frozen.timerS);
  });

  it("does not alter motion or SOC for a BMS diagnostic warning", () => {
    const input = structuredClone(base); input.demoIncidents = scheduled("BATTERY_WARNING", 0, 0);
    const controlInput = structuredClone(input); controlInput.demoIncidents!.enabled = false;
    const warned = createPlayback(input), control = createPlayback(controlInput);
    stepPlayback(warned, 300); stepPlayback(control, 300);
    expect(warned.robots.map(({ x, y, phase, soc, timerS }) => ({ x, y, phase, soc, timerS }))).toEqual(control.robots.map(({ x, y, phase, soc, timerS }) => ({ x, y, phase, soc, timerS })));
    expect(warned.doneCount).toBe(control.doneCount);
    expect(incidentSummary(warned)).toMatchObject({ stoppedRobotSeconds: 0, warningRobotSeconds: 180 });
  });

  it.each(["LOCALIZATION_LOST", "LINK_LOST"] as const)("%s freezes the actual body and never invents future incidents in preview", (code) => {
    const input = structuredClone(base); input.demoIncidents = scheduled(code, 0, 100);
    const state = createPlayback(input); stepPlayback(state, 99);
    const before = structuredClone(state), preview = previewInterpolate(state, 1);
    expect(preview.incidents).toEqual([]); expect(state).toEqual(before);
    stepPlayback(state); const at = playbackFrame(state), position = at.incidents[0]!.position;
    expect(at.incidents[0]!.positionSource).toBe(code === "LINK_LOST" ? "last-known-model-pose" : "model-at-detection");
    expect(at.robots[0]!.operationalState).toBe("incidentStop");
    stepPlayback(state, 179); const stopped = playbackFrame(state);
    expect({ x: stopped.robots[0]!.x, y: stopped.robots[0]!.y }).toEqual(position);
    const nearResolved = previewInterpolate(state, 1);
    expect(nearResolved.incidents[0]!.resolvedAtS).toBeNull();
    expect({ x: nearResolved.robots[0]!.x, y: nearResolved.robots[0]!.y }).toEqual(position);
    const replay = createPlayback(input); stepPlayback(replay, 17); stepPlayback(replay, 262);
    expect(playbackFrame(replay)).toEqual(stopped);
  });

  it("adds no coverage while a cleaner is halted and preserves canonical lifecycle/history seek", async () => {
    const input = createSectionInput(); input.demoIncidents = scheduled("DRIVE_FAULT", 0, 160); input.durationS = 350;
    const state = createSectionPlayback(input); stepSectionPlayback(state, 160);
    const robot = state.robots[0]!, before = { x: robot.x, y: robot.y, cleanedCells: robot.cleanedCells, distanceM: robot.distanceM, leg: robot.leg, point: robot.point };
    stepSectionPlayback(state, 179.9);
    expect({ x: robot.x, y: robot.y, cleanedCells: robot.cleanedCells, distanceM: robot.distanceM, leg: robot.leg, point: robot.point }).toEqual(before);
    expect(sectionFrame(state).robots[0]!.working).toBe(false);
    expect(state.traffic.collisionCount).toBe(0);
    const history = (globalThis as unknown as { createRobotWorkHistory(args: unknown): Promise<{ intervals: { startS: number; endS: number; phase: string }[] }> }).createRobotWorkHistory;
    const result = await history({ Core: { createPlayback, stepPlayback, isPlaybackDone: (s: typeof state) => sectionDone(s) }, input, robotId: 0 });
    expect(result.intervals.find((i) => i.phase === "incidentStop")).toMatchObject({ startS: 160, endS: 340 });
  });

  it("completes the small-floor encounter safely after all scripted incidents resolve", () => {
    const state = createSectionPlayback(createSectionInput({ fleet: 2, areaM2: 1000 }));
    while (!sectionDone(state)) stepSectionPlayback(state, 60);
    expect(summarizeSections(state).verdict).toBe("COMPLETED");
    expect(summarizeSections(state).coveragePct).toBe(100);
    expect(summarizeSections(state).completedSections).toBe(5);
    expect(state.traffic.collisionCount).toBe(0);
    expect(state.traffic.minimumClearanceM).toBeGreaterThanOrEqual(0.12 - 1e-8);
    expect(incidentSummary(state).resolved).toBe(4);
  });
});
