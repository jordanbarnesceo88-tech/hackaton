import { describe, expect, it } from "vitest";
import { warehouseBaseInput } from "../../lib/sim/fixtures";
import type { SimTask } from "../../lib/sim/state";
import { assignUnderlift, dockOf, underliftCanAssign } from "./carriers";
import { createWarehouseTrafficState, prepareWarehouseTraffic } from "./traffic";

function fixture() {
  const input = prepareWarehouseTraffic(warehouseBaseInput(3, {
    demand: { avgPerH: 0, peakPerH: 0, warmupMin: 0, peakMin: 10 },
  }));
  input.demoIncidents!.enabled = false;
  input.demoIncidents!.schedule = [];
  const state = createWarehouseTrafficState(input);
  const task = (id: number, kind: "inbound" | "outbound", homeIndex = 0): SimTask => {
    const home = state.layout.slots[homeIndex]!;
    const from = kind === "outbound" ? home : state.layout.receiving[0]!;
    const to = kind === "outbound" ? state.layout.shipping[0]! : home;
    return {
      id, kind, fromPoint: -1, toPoint: -1,
      fromX: from.x, fromY: from.y, toX: to.x, toY: to.y,
      arrivalS: 0, startS: null, doneS: null,
    };
  };
  return { state, task };
}

describe("underlift feasibility cache invalidation", () => {
  it("indexes exact docks while preserving the caller's fuzzy-match tolerance", () => {
    const { state } = fixture(), dock = state.demoUnderlift!.docks[0]!;
    expect(dockOf(state, dock)).toBe(dock);
    const near = { x: dock.x + 5e-8, y: dock.y };
    expect(dockOf(state, near)).toBe(dock);
    expect(() => dockOf(state, near, 1e-8)).toThrow("Для точки отсутствует");
    expect(() => dockOf(state, { x: -1, y: -1 })).toThrow("Для точки отсутствует");
  });

  it("keeps exact placement checks for nearby carried pods after the broad phase", () => {
    const { state, task } = fixture(), outbound = task(0, "outbound"), blocker = state.demoUnderlift!.pods[1]!;
    blocker.phase = "carrying"; blocker.robotId = 1;
    blocker.heading = dockOf(state, { x: outbound.toX, y: outbound.toY }).heading;
    const contactX = Math.abs(Math.cos(blocker.heading)) > .5 ? 1.4 : 1;
    for (const [offset, expected] of [[0, false], [contactX + .14, false], [contactX + .16, true], [10, true]] as const) {
      blocker.x = outbound.toX + offset; blocker.y = outbound.toY;
      state.tS++;
      expect(underliftCanAssign(state, state.robots[0]!, outbound)).toBe(expected);
    }
  });
  it("invalidates a cached approval after another assignment reserves the pod", () => {
    const { state, task } = fixture();
    const first = task(0, "outbound"), competing = task(1, "outbound");
    expect(underliftCanAssign(state, state.robots[0]!, competing)).toBe(true);
    assignUnderlift(state, state.robots[1]!, first);
    expect(underliftCanAssign(state, state.robots[0]!, competing)).toBe(false);
  });

  it("rechecks destination occupancy on the next tick rather than retaining a stale rejection", () => {
    const { state, task } = fixture();
    const external = task(0, "outbound"), blocker = state.demoUnderlift!.pods[1]!;
    const original = { x: blocker.x, y: blocker.y };
    blocker.x = external.toX;
    blocker.y = external.toY;
    expect(underliftCanAssign(state, state.robots[0]!, external)).toBe(false);
    Object.assign(blocker, original);
    state.tS++;
    expect(underliftCanAssign(state, state.robots[0]!, external)).toBe(true);
  });

  it("creates exactly one prefetch while every idle robot retries an inbound request", () => {
    const { state, task } = fixture();
    const inbound = task(0, "inbound");
    state.tasks.push(inbound);
    for (let tick = 0; tick < 3; tick++) {
      for (const robot of state.robots) {
        expect(underliftCanAssign(state, robot, inbound)).toBe(false);
      }
      state.tS++;
    }
    expect(state.tasks).toHaveLength(2);
    expect(state.tasks[1]).toMatchObject({
      id: -1, operation: "prefetch-pod", countsTowardDemand: false,
      parentTaskId: 0, podId: inbound.podId,
    });
    expect(state.demoUnderlift!.pods[0]!.reservedForTaskId).toBe(0);
  });
});
