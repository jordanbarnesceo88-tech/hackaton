import { describe, expect, it } from "vitest";
import { warehouseBaseInput } from "../../lib/sim/fixtures";
import { routeLengthM } from "../../lib/sim/routing";
import type { SimTask } from "../../lib/sim/state";
import { assignUnderlift, dockOf } from "./carriers";
import { actualHeading, nearestStockGap } from "./pod-collision";
import { createWarehouseTrafficState, prepareWarehouseTraffic, stepWarehouseTraffic } from "./traffic";

describe("pickup movement-to-handling boundary", () => {
  it("uses the final docking heading when a two-metre arrival completes in one tick", () => {
    const raw = warehouseBaseInput(1);
    raw.layout.activeAreaM2 = 5000;
    raw.robots.speedMps = 2;
    raw.demand = { avgPerH: 0, peakPerH: 0, warmupMin: 0, peakMin: 5 };
    const input = prepareWarehouseTraffic(raw);
    input.demoIncidents = { ...input.demoIncidents!, enabled: false, schedule: [] };
    const state = createWarehouseTrafficState(input), robot = state.robots[0]!, inventory = state.demoUnderlift!;
    const pod = inventory.pods.find(p => dockOf(state, p.home).heading === 0)!;
    const dock = dockOf(state, pod.home), destination = state.layout.shipping[0]!;
    const task: SimTask = { id: 0, kind: "outbound", podId: pod.id, operation: "transport", countsTowardDemand: true,
      fromPoint: -1, fromX: pod.home.x, fromY: pod.home.y,
      toPoint: state.points.findIndex(p => p.id === destination.id), toX: destination.x, toY: destination.y,
      arrivalS: 0, startS: 0, doneS: null };
    state.tasks.push(task); state.head = 1; state.nextDemandTaskId = 1;
    robot.task = task; assignUnderlift(state, robot, task);
    Object.assign(robot, { x: dock.entry.x, y: dock.entry.y, phase: "toPickup", loaded: false,
      path: [{ x: dock.entry.x, y: dock.entry.y - 2 }, { ...dock.entry }, { ...pod.home }], distM: 2 });
    robot.pathLenM = routeLengthM(robot.path);
    Object.assign(robot.underlift!, { routeStage: "pickup", headingRad: Math.PI / 2 });
    stepWarehouseTraffic(state);
    expect(robot.phase).toBe("loading");
    expect([robot.x, robot.y]).toEqual([pod.x, pod.y]);
    expect(robot.underlift!.headingRad).toBe(dock.heading);
    expect(actualHeading(robot)).toBe(pod.heading);
    for (let ticks = 0; ticks < 100 && robot.underlift!.podLiftM === 0; ticks++) stepWarehouseTraffic(state);
    expect(robot.underlift!.podLiftM).toBeGreaterThan(0);
    expect(robot.underlift!.headingRad).toBe(pod.heading);
    expect(nearestStockGap(state, robot)!.gapM).toBeGreaterThanOrEqual(.15 - 1e-8);
    expect(state.demoTraffic.minimumClearanceM).toBeGreaterThanOrEqual(.15 - 1e-8);
  });
});
