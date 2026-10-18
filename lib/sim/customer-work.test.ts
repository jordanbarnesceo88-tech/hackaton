import { describe, expect, it } from "vitest";
import { assessWarehouse } from "../../experiments/warehouse-3d/assessment";
import { frameOf } from "../../experiments/warehouse-3d/telemetry";
import { customerQueueLength, customerWorkStarts } from "./customer-work";
import { createSim, stepSim } from "./engine";
import { warehouseBaseInput } from "./fixtures";
import { summarize } from "./metrics";
import type { SimTask } from "./state";

function fixture() {
  const input = warehouseBaseInput(1);
  input.transportWorkflow = "closed-pod-1";
  input.demand = { avgPerH: 0, peakPerH: 30, warmupMin: 0, peakMin: 5 };
  const state = createSim(input);
  const parent: SimTask = {
    id: 0, kind: "inbound", operation: "transport", countsTowardDemand: true, podId: "pod-A",
    fromPoint: 0, fromX: 4, fromY: 10, toPoint: -1, toX: 20, toY: 30,
    arrivalS: 10, startS: null, doneS: null,
  };
  const prefetch: SimTask = {
    ...parent, id: -1, operation: "prefetch-pod", countsTowardDemand: false, parentTaskId: parent.id,
    fromPoint: -1, fromX: 20, fromY: 30, toPoint: 0, toX: 4, toY: 10,
    arrivalS: 11, startS: 20,
  };
  state.tasks = [parent, prefetch];
  state.tS = 120;
  state.head = 1;
  Object.assign(state.robots[0]!, { task: prefetch, phase: "loading", timerS: 100 });
  return { state, parent, prefetch };
}

describe("customer intake across physical carrier preparation", () => {
  it("credits only actual customer-bound work, while delivery and unfinished backlog stay unchanged", () => {
    const { state, parent, prefetch } = fixture();
    const raw = structuredClone(state.tasks);
    const summary = summarize(state);
    expect(summary).toMatchObject({ servedShare: 1, queueEnd: 0, waitP95Min: 10 / 60, donePeak: 0, achievedPerH: 0 });
    const assessment = assessWarehouse(state, summary);
    expect(assessment.checks.find(c => c.id === "intake_sla")?.status).toBe("PASS");
    expect(assessment.checks.find(c => c.id === "throughput")?.status).toBe("FAIL");
    expect(assessment.checks.find(c => c.id === "unfinished")?.measured).toMatchObject({ pending: 0, active: 1, completedTotal: 0 });
    const frame = frameOf(state);
    expect(frame).toMatchObject({ queue: 0, physicalQueue: 1, customerUnfinished: 1 });
    expect(frame.tasks.find(t => t.id === parent.id)).toMatchObject({ startS: null, customerWorkStartedAtS: prefetch.startS, status: "active" });
    expect(state.tasks).toEqual(raw);
  });

  it.each([
    ["pending prefetch", { startS: null }],
    ["start before customer arrival", { arrivalS: 5, startS: 9 }],
    ["start before its own arrival", { startS: 10 }],
    ["future start", { startS: 121 }],
    ["wrong parent", { parentTaskId: 12 }],
    ["return leg", { operation: "return-pod" }],
    ["another pod", { podId: "pod-B" }],
    ["another home", { fromX: 21 }],
    ["another receiving point", { toPoint: 1 }],
    ["counted preparation", { countsTowardDemand: true }],
  ] as [string, Partial<SimTask>][]) ("does not credit %s", (_, patch) => {
    const { state, prefetch } = fixture();
    Object.assign(prefetch, patch);
    const starts = customerWorkStarts(state.input, state.tasks, state.tS);
    expect(starts.get(0)).toBeNull();
    expect(customerQueueLength(state.tasks, starts)).toBeGreaterThanOrEqual(1);
    expect(summarize(state).waitP95Min).toBe(110 / 60);
  });

  it("keeps completed requests out of the queue and preserves the normal direct start", () => {
    const { state, parent, prefetch } = fixture();
    parent.startS = 15;
    parent.doneS = 100;
    expect(customerWorkStarts(state.input, state.tasks, state.tS).get(parent.id)).toBe(15);
    expect(customerQueueLength(state.tasks, customerWorkStarts(state.input, state.tasks, state.tS))).toBe(0);
    prefetch.startS = null;
    expect(summarize(state).waitP95Min).toBe(5 / 60);
  });

  it("leaves generic single-leg and historical summary semantics unchanged", () => {
    const { state } = fixture();
    state.input.transportWorkflow = undefined;
    const legacy = summarize(state);
    state.input.transportWorkflow = "single-leg-pallet-1";
    const explicit = summarize(state);
    expect(explicit).toMatchObject({ servedShare: 0, queueEnd: 1, waitP95Min: 110 / 60 });
    expect(explicit).toEqual({ ...legacy, inputKey: explicit.inputKey });
  });

  it("uses the same customer start for queue peak accumulators without assigning the delivery leg", () => {
    const { state, parent } = fixture();
    state.input.demand.peakPerH = 0;
    state.nextDemandTaskId = 1;
    stepSim(state, 1, undefined, () => false);
    expect(state.acc.queueAtPeakStart).toBe(0);
    expect(state.acc.queueMax).toBe(0);
    expect(parent.startS).toBeNull();
    expect(parent.doneS).toBeNull();
  });
});
