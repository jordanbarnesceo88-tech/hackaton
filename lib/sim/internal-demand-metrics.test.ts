import { describe, expect, it } from "vitest";
import { assessWarehouse } from "../../experiments/warehouse-3d/assessment";
import { createSim, stepSim } from "./engine";
import { warehouseBaseInput } from "./fixtures";
import { summarize } from "./metrics";
import type { SimTask } from "./state";
import { MOBILE_RACK_SPEC, type UnderliftState } from "../../experiments/warehouse-3d/carriers";

const internalTask = (id: number): SimTask => ({
  id, kind: "inbound", operation: "return-pod", countsTowardDemand: false,
  parentTaskId: 0, podId: "pod-01", fromPoint: -1, fromX: 5, fromY: 5,
  toPoint: -1, toX: 10, toY: 5, arrivalS: 0, startS: null, doneS: null,
});

describe("customer throughput versus internal carrier handling", () => {
  it("does not improve or dilute the customer SLA by adding internal queued and finished legs", () => {
    const input = warehouseBaseInput(2);
    input.demand.warmupMin = 0;
    input.demand.peakMin = 5;
    const state = createSim(input);
    for (let i = 0; i < 120; i++) stepSim(state);
    const before = summarize(state);
    state.tasks.push(internalTask(-1), { ...internalTask(-2), startS: 1, doneS: 2 });
    state.physicalDoneCount = state.doneCount + 1;
    expect(summarize(state)).toEqual(before);
    expect(assessWarehouse(state, summarize(state)).checks.find(check => check.id === "validity")?.status).toBe("PASS");
  });

  it("records a completed return physically without crediting another customer delivery", () => {
    const input = warehouseBaseInput(1);
    input.demand = { avgPerH: 0, peakPerH: 0, warmupMin: 0, peakMin: 1 };
    const state = createSim(input);
    const task = { ...internalTask(-1), startS: 0 };
    state.tasks.push(task);
    state.head = 1;
    state.physicalDoneCount = 0;
    Object.assign(state.robots[0]!, { phase: "unloading", task, loaded: true, timerS: 1 });
    stepSim(state);
    expect(task.doneS).toBe(1);
    expect(state.physicalDoneCount).toBe(1);
    expect(state.doneCount).toBe(0);
    expect(state.acc.doneInPeak).toBe(0);
    expect(state.acc.bucketDone).toEqual([0]);
    expect(summarize(state)).toMatchObject({ arrivedPeak: 0, donePeak: 0, achievedPerH: 0, queueEnd: 0 });
  });

  it("rejects duplicate persistent stock and a shelf lifted without platform contact", () => {
    const state = createSim(warehouseBaseInput(1)) as UnderliftState;
    const home = { x: 10, y: 10 };
    state.layout.slots = [home];
    const pod = { id: "pod-home-1", home, taskId: null, robotId: null, reservedForTaskId: null, spec: { ...MOBILE_RACK_SPEC }, contents: "full" as const, inventoryNotModelled: true as const, ...home, heading: 0, phase: "parked" as const, liftM: 0, visible: true };
    state.demoUnderlift = { pods: [pod], docks: [], nextInternalId: -1, podIndex: { [pod.id]: 0 }, homeIndex: { "10,10": 0 }, revision: 0, stockRevision: 0, cacheAtS: -1, cacheRevision: -1, feasibility: {} };
    const result = () => assessWarehouse(state, summarize(state)).checks.find(check => check.id === "underlift")!;
    expect(result().status).toBe("PASS");
    state.demoUnderlift.pods.push({ ...pod });
    expect(result().status).toBe("FAIL");
    state.demoUnderlift.pods.pop();
    const task = { ...internalTask(-1), startS: 0, podId: pod.id };
    state.robots[0]!.task = task;
    Object.assign(pod, { robotId: state.robots[0]!.id, taskId: -1, liftM: .06 });
    state.robots[0]!.underlift = { podId: pod.id, stage: "carry", progress: 1, platformTopM: .38, podLiftM: .06, contactGapM: .12, contact: false, headingRad: 0 };
    expect(result().status).toBe("FAIL");
    Object.assign(state.robots[0]!.underlift, { platformTopM: .5, contactGapM: 0, contact: true });
    expect(result().status).toBe("PASS");
  });
});
