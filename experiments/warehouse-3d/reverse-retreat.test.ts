import { describe, expect, it } from "vitest";
import { warehouseBaseInput } from "../../lib/sim/fixtures";
import { routeLengthM } from "../../lib/sim/routing";
import type { SimTask } from "../../lib/sim/state";
import { assignUnderlift } from "./carriers";
import { playbackFrame, previewInterpolate } from "./core";
import { stockRouteIsClear, stockSweepIsClear } from "./pod-collision";
import { createWarehouseTrafficState, prepareWarehouseTraffic, stepWarehouseTraffic, tryReverseRetreat } from "./traffic";

/** A delivered shelf appears on an ordinary route to a different shipping station. */
function fixture() {
  const raw = warehouseBaseInput(3);
  raw.layout.activeAreaM2 = 5000;
  raw.demand = { avgPerH: 0, peakPerH: 0, warmupMin: 0, peakMin: 10 };
  const input = prepareWarehouseTraffic(raw);
  input.demoIncidents = { ...input.demoIncidents!, enabled: false, schedule: [] };
  const state = createWarehouseTrafficState(input), inventory = state.demoUnderlift!;
  const carrier = inventory.pods[0]!, delivered = inventory.pods[1]!;
  const station = state.layout.shipping[0]!, destination = state.layout.shipping[1]!;
  const task: SimTask = { id: 0, kind: "outbound", operation: "transport", countsTowardDemand: true, podId: carrier.id,
    fromPoint: -1, fromX: carrier.home.x, fromY: carrier.home.y,
    toPoint: state.points.findIndex(p => p.id === destination.id), toX: destination.x, toY: destination.y,
    arrivalS: 0, startS: 0, doneS: null };
  const returning: SimTask = { id: -1, kind: "outbound", operation: "return-pod", countsTowardDemand: false, parentTaskId: 99, podId: delivered.id,
    fromPoint: state.points.findIndex(p => p.id === station.id), fromX: station.x, fromY: station.y,
    toPoint: -1, toX: delivered.home.x, toY: delivered.home.y, arrivalS: 0, startS: 0, doneS: null };
  state.tasks.push(task, returning); state.head = 2; state.nextDemandTaskId = 1; inventory.nextInternalId = -2;
  const robot = state.robots[0]!, remover = state.robots[1]!;
  robot.task = task; assignUnderlift(state, robot, task);
  Object.assign(robot, { x: 94.6, y: 10, phase: "toDrop", loaded: true,
    path: [{ x: 94.6, y: 10 }, { x: 96, y: 10 }, { x: 96, y: 18 }, { x: 96, y: 20 }], distM: 0 });
  robot.pathLenM = routeLengthM(robot.path);
  Object.assign(robot.underlift!, { stage: "carry", routeStage: "drop", headingRad: 0, podLiftM: .06, platformTopM: .5, contactGapM: 0, contact: true });
  Object.assign(carrier, { x: robot.x, y: robot.y, heading: 0, phase: "carrying", liftM: .06 });
  Object.assign(delivered, { x: station.x, y: station.y, heading: Math.PI / 2, contents: "empty" });
  remover.task = returning; assignUnderlift(state, remover, returning);
  Object.assign(remover, { x: 93.1, y: 8.5, phase: "toPickup", loaded: false,
    path: [{ x: 93.1, y: 8.5 }, { x: 93.1, y: 8 }, { x: 96, y: 8 }, { x: 96, y: 10 }], distM: 0 });
  remover.pathLenM = routeLengthM(remover.path);
  Object.assign(remover.underlift!, { routeStage: "pickup", headingRad: -Math.PI / 2 });
  inventory.stockRevision++;
  for (const r of state.robots) r.soc = 1;
  return { state, robot, remover, carrier, delivered, task, returning };
}

describe("reverse recovery from a shelf blocking an ordinary route", () => {
  it("preserves heading and ownership during the real reverse prefix, then replans and clears both jobs", () => {
    const { state, robot, carrier, delivered, task, returning } = fixture();
    const back = { x: 94.4, y: 10 };
    expect(stockRouteIsClear(state, robot, robot, back)).toBe(false);
    expect(tryReverseRetreat(state, robot)).toBe(true);
    expect(robot.underlift!.stage).toBe("retreat");
    const before = JSON.stringify(state), preview = previewInterpolate(state, .5);
    expect(JSON.stringify(state)).toBe(before);
    expect(preview.robots[0]!.x).toBeCloseTo(94.5);
    expect(preview.robots[0]!.heading).toBe(0);
    expect(preview.carriers.find(p => p.id === carrier.id)!).toMatchObject({ heading: 0, contents: "full" });
    const frame = playbackFrame(state).robots[0]!;
    expect(frame.remainingDistM).toBeCloseTo(.2);
    expect(frame.etaS).toBeNull();
    expect(frame.path).toHaveLength(2);
    stepWarehouseTraffic(state);
    expect(robot.x).toBeCloseTo(back.x);
    expect(robot.underlift!.headingRad).toBe(0);
    expect(carrier.heading).toBe(0);
    expect(robot.task).toBe(task);
    expect(carrier.robotId).toBe(robot.id);
    expect(carrier.contents).toBe("full");
    expect(task.doneS).toBeNull();
    for (let i = 0; i < 240 && (task.doneS === null || returning.doneS === null); i++) stepWarehouseTraffic(state);
    expect(task.doneS).not.toBeNull(); expect(returning.doneS).not.toBeNull();
    expect([delivered.x, delivered.y, delivered.contents]).toEqual([delivered.home.x, delivered.home.y, "empty"]);
    expect(state.demoTraffic.collisionCount).toBe(0);
    expect(state.demoTraffic.minimumClearanceM).toBeGreaterThanOrEqual(.15 - 1e-8);
  });

  it("refuses a reverse escape when stock behind leaves no turn-clear endpoint", () => {
    const { state, robot } = fixture(), behind = state.demoUnderlift!.pods.at(-1)!;
    Object.assign(behind, { x: 92.8, y: 10, heading: 0, phase: "delivered" }); state.demoUnderlift!.stockRevision++;
    expect(stockSweepIsClear(state, { ...robot, underlift: { ...robot.underlift!, stage: "retreat" } }, [robot, { x: 94.4, y: 10 }], true)).toBe(true);
    expect(stockRouteIsClear(state, robot, { x: 94.4, y: 10 }, { x: 94.4, y: 10 })).toBe(false);
    const before = JSON.stringify(robot);
    expect(tryReverseRetreat(state, robot)).toBe(false);
    expect(JSON.stringify(robot)).toBe(before);
  });

  it("refuses a geometrically clear reverse that would cross another robot's protective disk", () => {
    const { state, robot, remover } = fixture();
    Object.assign(remover, { x: 1.8, y: 20.8 });
    Object.assign(state.robots[2]!, { x: 92.6, y: 10 });
    expect(Math.hypot(robot.x - state.robots[2]!.x, robot.y - state.robots[2]!.y)).toBeGreaterThanOrEqual(1.95);
    expect(tryReverseRetreat(state, robot)).toBe(false);
  });
});
