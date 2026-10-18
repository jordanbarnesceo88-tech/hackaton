import { describe, expect, it } from "vitest";
import { route, routeLengthM } from "../../lib/sim/routing";
import type { SimTask } from "../../lib/sim/state";
import { assignUnderlift } from "./carriers";
import { createIncidentRuntime } from "./incidents";
import { complexSite } from "./site";
import { createWarehouseTrafficState, prepareWarehouseTraffic, stepWarehouseTraffic } from "./traffic";

function fixture(haltUnroutableRobot: boolean) {
  const input = prepareWarehouseTraffic({
    seed: 1, siteLayout: complexSite(10000, 1, true),
    layout: { activeAreaM2: 10000, mainAisleWidthM: 3.5, rackAisleWidthM: 2.8, receivingDocksCount: 2, shippingDocksCount: 2, chargers: 1 },
    robots: { count: 4, speedMps: 1.5, loadedSpeedFactor: 0.8, handlingSec: 12, autonomyH: 10, chargeMin: 1, payloadKg: 1500 },
    loadMassKg: 800, demand: { avgPerH: 0, peakPerH: 0, warmupMin: 0, peakMin: 10 },
    thresholds: { servedShareMin: 0.97, p95WaitMaxMin: 10, oversizedIdleShare: 0.4 }, charge: { startSoc: 0.2, stopSoc: 0.9 },
  });
  input.demoIncidents = { version: "incidents-1.0.0", enabled: false, schedule: [] };
  const state = createWarehouseTrafficState(input);
  const home = state.layout.slots[0]!, shipping = state.layout.shipping[0]!;
  const dock = state.demoUnderlift!.docks.find(d => d.x === home.x && d.y === home.y)!;
  const starver = state.robots[0]!;
  Object.assign(starver, { x: 30, y: 16, soc: 1, phase: "toPickup" });
  const task: SimTask = { id: 0, kind: "outbound", fromPoint: -1, fromX: home.x, fromY: home.y, toPoint: 2, toX: shipping.x, toY: shipping.y, arrivalS: 0, startS: 0, doneS: null };
  state.tasks.push(task); state.head = 1; state.nextDemandTaskId = 1;
  starver.task = task; assignUnderlift(state, starver, task);
  starver.path = route(state.layout, starver, home); starver.distM = 0; starver.pathLenM = routeLengthM(starver.path);
  Object.assign(state.robots[3]!, { x: dock.entry.x, y: dock.entry.y, soc: 1 });
  state.demoIncidents = createIncidentRuntime({ version: "incidents-1.0.0", enabled: true,
    schedule: (haltUnroutableRobot ? [0, 3] : [3]).map(robotId => ({ id: `fixture-stop-${robotId}`, robotId, code: "DRIVE_FAULT", detectedAtS: 0, ackAtS: 1, diagnosingAtS: 2, recoveryAtS: 500, resolvedAtS: 550 })),
  }, 4);
  const chargerIndex = state.points.findIndex(p => p.kind === "charger");
  const charger = state.points[chargerIndex]!;
  for (const id of [1, 2]) {
    const robot = state.robots[id]!, x = id === 1 ? 10 : 14;
    const path = id === 1 ? [{ x, y: 16 }, { x: 24, y: 16 }, { x: 24, y: 6 }, { x: charger.x, y: charger.y }]
      : [{ x, y: 16 }, { x: 6, y: 16 }, { x: charger.x, y: charger.y }];
    Object.assign(robot, { x, y: 16, soc: 0.1, task: null, phase: "toCharger", pointIdx: chargerIndex, path, distM: 0, pathLenM: routeLengthM(path) });
  }
  for (const robot of state.robots) {
    const body = state.demoTraffic.bodies[robot.id]!;
    body.waitS = 3; body.lastReplanS = robot.id === 0 ? -100 : -50;
  }
  return state;
}

describe("bounded replan admission fairness", () => {
  it("does not let one failed underlift route preparation monopolize every other robot's replan turn", () => {
    const blocked = fixture(false), control = fixture(true);
    for (let i = 0; i < 25; i++) { stepWarehouseTraffic(blocked); stepWarehouseTraffic(control); }
    const attempts = (state: typeof blocked) => [1, 2].map(id => state.demoTraffic.bodies[id]!.lastReplanS);
    expect(attempts(control).some(t => t >= 0), "The same head-on pair can replan when the failed candidate is excluded").toBe(true);
    expect(attempts(blocked).some(t => t >= 0), "A preparation failure must consume or relinquish its turn instead of retaining the oldest candidate forever").toBe(true);
    expect(blocked.demoUnderlift!.pods).toHaveLength(768);
    expect(blocked.demoTraffic.collisionCount).toBe(0);
  });
});
