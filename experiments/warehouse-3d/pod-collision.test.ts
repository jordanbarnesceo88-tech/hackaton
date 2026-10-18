import { describe, expect, it } from "vitest";
import { createSim } from "../../lib/sim/engine";
import { warehouseBaseInput } from "../../lib/sim/fixtures";
import type { UnderliftState } from "./carriers";
import { podBounds, stockRouteIsClear } from "./pod-collision";
import { MOBILE_RACK_SPEC, type RackCarrier } from "./carriers";

function emptyStock() {
  const state = createSim(warehouseBaseInput(1)) as UnderliftState;
  state.demoUnderlift = { pods: [], docks: [], nextInternalId: -1, podIndex: {}, homeIndex: {}, revision: 0, stockRevision: 0, cacheAtS: -1, cacheRevision: -1, feasibility: {} };
  const robot = state.robots[0]!;
  robot.underlift = { podId: "test-pod", stage: "approach", progress: 0, platformTopM: 0.38, podLiftM: 0, contactGapM: 0.06, contact: false, headingRad: 0, entryOffsetM: 2 };
  return { state, robot };
}

describe("cardinal stock-route connectors", () => {
  it("treats floating-point residue at a graph node as a zero-length connector", () => {
    const { state, robot } = emptyStock();
    const node = { x: 8.9, y: 55.7 };
    expect(stockRouteIsClear(state, robot, node, { x: node.x + 1e-14, y: node.y + 1e-14 })).toBe(true);
  });

  it("accepts cardinal links and rejects a genuinely diagonal connector", () => {
    const { state, robot } = emptyStock();
    const start = { x: 5, y: 5 };
    for (const end of [{ x: 5, y: 8 }, { x: 5, y: 2 }, { x: 8, y: 5 }, { x: 2, y: 5 }]) {
      expect(stockRouteIsClear(state, robot, start, end)).toBe(true);
    }
    expect(stockRouteIsClear(state, robot, start, { x: 8, y: 8 })).toBe(false);
  });

  it("invalidates cached bounds on movement, rotation and dimension changes", () => {
    const pod = { x: 5, y: 5, heading: 0, spec: { ...MOBILE_RACK_SPEC } };
    const first = podBounds(pod);
    expect(podBounds(pod)).toBe(first);
    pod.x = 8;
    expect(podBounds(pod).x0).toBeCloseTo(7.3);
    pod.heading = Math.PI / 2;
    expect(podBounds(pod).x0).toBeCloseTo(7.5);
    pod.spec.widthM = 1.2;
    expect(podBounds(pod).x0).toBeCloseTo(7.4);
  });

  it("rebuilds the floor index after pickup and set-down, while other clocks may advance", () => {
    const { state, robot } = emptyStock();
    const pod = { id: "blocker", x: 20, y: 20, heading: 0, phase: "parked", robotId: null, spec: { ...MOBILE_RACK_SPEC } } as RackCarrier;
    state.demoUnderlift!.pods.push(pod);
    const a = { x: 18, y: 20 }, b = { x: 22, y: 20 };
    expect(stockRouteIsClear(state, robot, a, b)).toBe(false);
    pod.phase = "carrying"; state.demoUnderlift!.stockRevision++;
    expect(stockRouteIsClear(state, robot, a, b)).toBe(true);
    state.tS++; state.demoUnderlift!.revision++;
    expect(stockRouteIsClear(state, robot, a, b)).toBe(true);
    pod.x = 8; pod.y = 5; pod.phase = "delivered"; state.demoUnderlift!.stockRevision++;
    expect(stockRouteIsClear(state, robot, { x: 6, y: 5 }, { x: 10, y: 5 })).toBe(false);
    expect(stockRouteIsClear(state, robot, a, b)).toBe(true);
  });
});
