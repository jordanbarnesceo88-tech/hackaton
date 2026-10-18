import { describe, expect, it } from "vitest";
import * as Core from "./core";
import { createSectionInput } from "./sections";
import { warehouseBaseInput } from "../../lib/sim/fixtures";
import { prepareWarehouseTraffic } from "./traffic";
import "./robot-history.js";

type Interval = { startS: number; endS: number; phase: string; taskId: number | null; zoneId: string | null; label: string; loaded: boolean; carrierId?: string | null; carrierContents?: "full" | "empty" | null; underliftStage?: string; countsTowardDemand?: boolean; parentTaskId?: number | null };
type Args = { Core: unknown; input: unknown; caseId?: string; robotId?: number | null; kind?: string; signal?: AbortSignal; onProgress?: (pct: number) => void };
const history = (globalThis as unknown as { createRobotWorkHistory(args: Args): Promise<{ robotId?: number; intervals?: Interval[]; robots?: { robotId: number; intervals: Interval[] }[]; endS: number }> }).createRobotWorkHistory;

function warehouseHistoryInput(minutes: number) {
  const raw = warehouseBaseInput(3);
  raw.layout.activeAreaM2 = 5000;
  raw.demand.warmupMin = 0; raw.demand.peakMin = minutes;
  const input = prepareWarehouseTraffic(raw);
  input.demoIncidents!.enabled = false; input.demoIncidents!.schedule = [];
  return input;
}

describe("robot work history", () => {
  it("records canonical content changes separately from lifting and preserves interval boundaries", async () => {
    const engine = {
      carrierSpec: () => ({ kind: "mobile-rack" }),
      createPlayback: () => ({ tS: 0, endS: 4, robots: [{ id: 0, phase: "toDrop", loaded: true,
        task: { id: -1, kind: "outbound", podId: "pod-home-1", operation: "return-pod", countsTowardDemand: false, parentTaskId: 0 },
        underlift: { stage: "carry", podLiftM: .06, contact: true } }],
        demoUnderlift: { podIndex: { "pod-home-1": 0 }, pods: [{ contents: "full" }] } }),
      stepPlayback: (state: { tS: number; demoUnderlift: { pods: { contents: string }[] } }) => {
        state.tS++;
        if (state.tS === 2) state.demoUnderlift.pods[0]!.contents = "empty";
      },
      isPlaybackDone: (state: { tS: number }) => state.tS >= 4,
    };
    const result = await history({ Core: engine, input: {}, robotId: 0 });
    expect(result.intervals!.map(({ startS, endS, loaded, carrierContents }) => ({ startS, endS, loaded, carrierContents }))).toEqual([
      { startS: 0, endS: 2, loaded: true, carrierContents: "full" },
      { startS: 2, endS: 4, loaded: true, carrierContents: "empty" },
    ]);
  });
  it("coalesces phase+task+section independently per robot in a single replay", async () => {
    let creates = 0, steps = 0;
    type TinyState = { tS: number; endS: number; robots: { id: number; phase: string; task: { id: number; kind: string } | null }[] };
    const engine = {
      createPlayback() { creates++; return { tS: 0, endS: 5, robots: [{ id: 0, phase: "idle", task: null as { id: number; kind: string } | null }, { id: 1, phase: "idle", task: null }] }; },
      stepPlayback(s: TinyState) {
        steps++; s.tS++;
        if (s.tS === 1) { s.robots[0]!.phase = "working"; s.robots[0]!.task = { id: 7, kind: "inbound" }; }
        if (s.tS === 3) s.robots[0]!.task = { id: 8, kind: "inbound" };
        if (s.tS === 5) s.robots[0]!.phase = "done";
      },
      isPlaybackDone(s: { tS: number }) { return s.tS >= 5; },
    };
    const result = await history({ Core: engine, input: {}, robotId: null });
    expect(creates).toBe(1); expect(steps).toBe(5);
    expect(result.robots![0]!.intervals.map(({ startS, endS, phase, taskId }) => ({ startS, endS, phase, taskId }))).toEqual([
      { startS: 0, endS: 1, phase: "idle", taskId: null },
      { startS: 1, endS: 3, phase: "working", taskId: 7 },
      { startS: 3, endS: 5, phase: "working", taskId: 8 },
    ]);
    expect(result.robots![1]!.intervals).toHaveLength(1);
    expect(result.robots![1]!.intervals[0]).toMatchObject({ startS: 0, endS: 5 });
  });

  it("replays real cleaning ticks without allocating full frames, with seekable interval starts", async () => {
    const input = createSectionInput({ fleet: 2, areaM2: 1000 });
    input.durationS = 180;
    const engine = { createPlayback: Core.createPlayback, stepPlayback: Core.stepPlayback, isPlaybackDone: Core.isPlaybackDone };
    const all = await history({ Core: engine, input, kind: "cleaning" });
    expect(all.robots).toHaveLength(2); expect(all.endS).toBe(180);
    const single = await history({ Core: engine, input, robotId: 0 });
    expect(single.intervals).toEqual(all.robots![0]!.intervals);
    const state = Core.createPlayback(input);
    for (const interval of single.intervals!) {
      expect(interval.endS).toBeGreaterThan(interval.startS);
      while (state.tS + 1e-8 < interval.startS) Core.stepPlayback(state, 0.1);
      const robot = Core.playbackFrame(state).robots[0]!;
      expect(robot.operationalState === "incidentStop" ? "incidentStop" : robot.safety?.blocked ? "trafficWait" : robot.phase).toBe(interval.phase);
      expect(robot.task?.id ?? null).toBe(interval.taskId);
      expect(robot.zoneId).toBe(interval.zoneId);
    }
    const total = single.intervals!.reduce((sum, x) => sum + x.endS - x.startS, 0);
    expect(total).toBeCloseTo(all.endS, 8);
    expect(single.intervals!.some(x => x.phase === "working" && x.zoneId !== null)).toBe(true);
  });

  it("uses actual warehouse state/task/loaded values and final model endpoint", async () => {
    const input = warehouseHistoryInput(3);
    const result = await history({ Core, input, robotId: 0 });
    expect(result.robotId).toBe(0); expect(result.endS).toBe(180);
    expect(result.intervals![0]!.startS).toBe(0);
    expect(result.intervals![result.intervals!.length - 1]!.endS).toBe(180);
    const state = Core.createPlayback(input);
    for (const interval of result.intervals!) {
      while (state.tS < interval.startS) Core.stepPlayback(state);
      expect(state.robots[0]!.phase).toBe(interval.phase);
      expect(state.robots[0]!.task?.id ?? null).toBe(interval.taskId);
      expect(Core.playbackFrame(state).robots[0]!.loaded).toBe(interval.loaded);
    }
  });

  it("preserves the canonical shelf identity in every active task interval", async () => {
    const input = warehouseHistoryInput(6);
    const result = await history({ Core, input });
    const state = Core.createPlayback(input);
    while (!Core.isPlaybackDone(state)) Core.stepPlayback(state, 60);
    const podsByTask = new Map(state.tasks.map(task => [task.id, task.podId]));
    const active = result.robots!.flatMap(row => row.intervals).filter(interval => interval.taskId !== null);
    expect(active.some(interval => interval.phase === "toDrop")).toBe(true);
    for (const interval of active) {
      const expected = podsByTask.get(interval.taskId!);
      expect(expected).toMatch(/^pod-home-\d+$/);
      expect(interval.carrierId).toBe(expected);
      expect(interval.label).toContain(expected!);
    }
    expect(active.some(interval => interval.countsTowardDemand === false && interval.parentTaskId !== null)).toBe(true);
  });

  it("reports progress and aborts without returning a partial history as complete", async () => {
    const controller = new AbortController(), progress: number[] = [];
    await expect(history({ Core, input: createSectionInput(), signal: controller.signal, onProgress: pct => { progress.push(pct); controller.abort(); } })).rejects.toMatchObject({ name: "AbortError" });
    expect(progress).toEqual([0]);
    await expect(history({ Core, input: createSectionInput(), robotId: 99 })).rejects.toThrow("отсутствует");
  });
});
