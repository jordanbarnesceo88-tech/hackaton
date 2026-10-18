import { describe, expect, it } from "vitest";
import { warehouseBaseInput } from "../../lib/sim/fixtures";
import type { SimTask } from "../../lib/sim/state";
import { complexSite } from "./site";
import { createWarehouseTrafficState, prepareWarehouseTraffic, stepWarehouseTraffic } from "./traffic";

describe("pickup reservation cache follows dispatch and movement", () => {
  it("does not assign two idle robots to the same pickup within a tick and rechecks after departure", () => {
    const raw = warehouseBaseInput(3, { demand: { avgPerH: 0, peakPerH: 0, warmupMin: 0, peakMin: 10 } });
    raw.siteLayout = complexSite(10000, 1); raw.layout.chargers = 1; raw.layout.receivingDocksCount = 2; raw.layout.shippingDocksCount = 2;
    const input = prepareWarehouseTraffic(raw);
    delete input.demoUnderlift;
    input.demoIncidents = { version: "incidents-1.0.0", enabled: false, schedule: [] };
    const state = createWarehouseTrafficState(input), source = state.layout.receiving[0]!;
    const task = (id: number): SimTask => ({ id, kind: "inbound", fromPoint: 0, fromX: source.x, fromY: source.y,
      toPoint: -1, toX: state.layout.slots[id]!.x, toY: state.layout.slots[id]!.y, arrivalS: 0, startS: null, doneS: null });
    state.tasks.push(task(0), task(1));
    stepWarehouseTraffic(state);
    expect(state.head).toBe(1);
    expect(state.tasks[0]!.startS).not.toBeNull(); expect(state.tasks[1]!.startS).toBeNull();
    const first = state.robots.find(robot => robot.task?.id === 0)!;
    first.loaded = true; first.phase = "toDrop";
    stepWarehouseTraffic(state);
    expect(state.head).toBe(2);
    expect(state.tasks[1]!.startS).not.toBeNull();
  });
});
