import { describe, expect, it } from "vitest";
import { createSim, isDone, stepSim } from "../../lib/sim/engine";
import { warehouseBaseInput } from "../../lib/sim/fixtures";
import { siteSegmentIsClear } from "../../lib/sim/site-layout";
import { route, routeLengthM } from "../../lib/sim/routing";
import type { SimTask } from "../../lib/sim/state";
import type { SimLayout } from "../../lib/sim/types";
import { createPlayback, isPlaybackDone, playbackFrame, previewInterpolate, stepPlayback } from "./core";
import { createSectionInput, createSectionPlayback, sectionDone, sectionFrame, stepSectionPlayback } from "./sections";
import { complexSite } from "./site";
import { buildWarehouseLayout } from "../../lib/sim/layout";
import { validateProjectSiteLayout, validateSiteLayout } from "../../lib/sim/site-layout";
import { summarize } from "../../lib/sim/metrics";
import { createIncidentRuntime } from "./incidents";
import { beginTrafficStep, createTrafficController, createWarehouseTrafficState, freeGraphRoute, isTrafficInput, isWarehouseTrafficState, prepareWarehouseTraffic, reserveTrafficMotion, segmentDistance, stepWarehouseTraffic } from "./traffic";

function commonSite(maxFleet = 12,physical=true) {
  const input = warehouseBaseInput(maxFleet);
  input.siteLayout = complexSite(10000, 1);
  input.layout.receivingDocksCount = 2; input.layout.shippingDocksCount = 2;
  const prepared = prepareWarehouseTraffic(input);
  if(!physical)delete prepared.demoUnderlift;
  prepared.demoIncidents = { version: "incidents-1.0.0", enabled: false, schedule: [] };
  return prepared;
}

function dispatchFixture(loaded: boolean) {
  const input = commonSite(2,false); input.demand.avgPerH = 0; input.demand.peakPerH = 0;
  const state = createWarehouseTrafficState(input), robot = state.robots[0]!;
  const active: SimTask = { id: 0, kind: "inbound", fromPoint: 0, fromX: 6, fromY: 24, toPoint: -1, toX: 54, toY: 54, arrivalS: 0, startS: 0, doneS: null };
  const pending: SimTask = { ...active, id: 1, startS: null };
  Object.assign(robot, { x: loaded ? 24 : 6, y: loaded ? 34 : 24, phase: loaded ? "toDrop" : "loading", loaded, task: active, timerS: 100, soc: 1, pointIdx: loaded ? -1 : 0 });
  robot.path = route(state.layout, robot, { x: 54, y: 54 }); robot.pathLenM = routeLengthM(robot.path);
  if (!loaded) state.points[0]!.holder = robot.id;
  state.robots[1]!.soc = 1; state.tasks = [active, pending]; state.head = 1;
  return { state, active, pending };
}

function encounterState() {
  const input = commonSite(2,false); input.demand.avgPerH = 0; input.demand.peakPerH = 0;
  const state = createWarehouseTrafficState(input);
  for (const robot of state.robots) {
    const x = robot.id === 0 ? 10 : 14, targetX = robot.id === 0 ? 24 : 6;
    const task: SimTask = { id: robot.id, kind: "outbound", fromPoint: -1, fromX: targetX, fromY: 16, toPoint: 3, toX: 144, toY: 24, arrivalS: 0, startS: 0, doneS: null };
    Object.assign(robot, { x, y: 16, soc: 1, phase: "toPickup", task, path: [{ x, y: 16 }, { x: targetX, y: 16 }], pathLenM: Math.abs(x - targetX), distM: 0 });
    state.tasks.push(task);
  }
  state.head = 2; return state;
}

describe("metric traffic safety", () => {
  it("replays the dense N60/C5 baseline workload exactly over a ten-minute replay window",()=>{
    const input=warehouseBaseInput(60);input.layout.chargers=5;input.demand.warmupMin=0;input.demand.peakMin=10;
    const prepared=prepareWarehouseTraffic(input),headless=createWarehouseTrafficState(prepared),playback=createPlayback(prepared);
    while(!isDone(headless))stepWarehouseTraffic(headless);while(!isPlaybackDone(playback))stepPlayback(playback,900);
    expect(summarize(playback)).toEqual(summarize(headless));expect(playback.tasks).toEqual(headless.tasks);expect(playback.robots).toHaveLength(60);
    expect(headless.doneCount).toBeGreaterThan(0);expect(headless.demoTraffic.collisionCount).toBe(0);expect(headless.demoTraffic.minimumClearanceM).toBeGreaterThanOrEqual(.15-1e-8);
  },15000);

  it("fills the supported generated storage floor and places sixty separate real bodies without mutating source inputs",()=>{
    const input=warehouseBaseInput(60),before=structuredClone(input),original=buildWarehouseLayout(input.layout),prepared=prepareWarehouseTraffic(input),site=prepared.siteLayout!;
    expect(input).toEqual(before);expect(site.slots.length).toBeGreaterThan(1800);expect(site.slots.length).toBeLessThanOrEqual(4096);
    expect(site.receiving).toEqual(original.receiving);expect(site.shipping).toEqual(original.shipping);expect(site.chargers).toEqual(original.chargers);
    expect(validateSiteLayout(site)).toEqual([]);expect(validateProjectSiteLayout(site)).toEqual([]);expect(site.routingGraph!.nodes.length).toBeLessThanOrEqual(8192);
    const nodes=new Map(site.routingGraph!.nodes.map(n=>[n.id,n]));for(const e of site.routingGraph!.edges)expect(siteSegmentIsClear(site,nodes.get(e.from)!,nodes.get(e.to)!)).toBe(true);
    expect(new Set(prepared.demoTraffic.initialPositions.map(p=>`${p.x},${p.y}`)).size).toBe(60);
    const a=createPlayback(prepared),b=createPlayback(JSON.parse(JSON.stringify(prepared)));stepPlayback(a,60);stepPlayback(b,60);expect(playbackFrame(a)).toEqual(playbackFrame(b));
  },10000);

  it("does not impose the former area-based ten-route heuristic on a sixty-body input",()=>{
    const input=warehouseBaseInput(60),prepared=prepareWarehouseTraffic(input);
    expect(prepared.demoTraffic.maxActiveRoutes).toBe(60);
    const resized=structuredClone(prepared);resized.robots.count=11;expect(prepareWarehouseTraffic(resized).demoTraffic.maxActiveRoutes).toBe(11);
  });

  it("rejects an oversized dense generated floor explicitly instead of thinning its permanent inventory",()=>{
    const input=warehouseBaseInput(60);input.layout.activeAreaM2=50000;const source=structuredClone(input);
    expect(()=>prepareWarehouseTraffic(input)).toThrow("4096");expect(input).toEqual(source);
  });

  it("routes to an actual midpoint on a dense aisle graph edge",()=>{
    const site=prepareWarehouseTraffic(warehouseBaseInput(3)).siteLayout!,nodes=new Map(site.routingGraph!.nodes.map(n=>[n.id,n])),edge=site.routingGraph!.edges.find(e=>!e.from.startsWith("pod-home")&&!e.to.startsWith("pod-home")&&Math.hypot(nodes.get(e.from)!.x-nodes.get(e.to)!.x,nodes.get(e.from)!.y-nodes.get(e.to)!.y)>3)!;
    const start=nodes.get(edge.from)!,end=nodes.get(edge.to)!,target={x:(start.x+end.x)/2,y:(start.y+end.y)/2},path=freeGraphRoute(site,start,target,[],1.95);
    expect(path).not.toBeNull();expect(path!.at(-1)).toEqual(target);for(let i=1;i<path!.length;i++)expect(siteSegmentIsClear(site,path![i-1]!,path![i]!)).toBe(true);
  });

  it("releases a pickup reservation after loading while keeping actual destination reservations", () => {
    const { state, pending } = dispatchFixture(true);
    expect(state.points[0]!.holder).toBeNull();
    stepWarehouseTraffic(state);
    expect(pending.startS).toBe(0); expect(state.robots[1]!.task).toBe(pending); expect(state.head).toBe(2);
    expect(state.tasks.map(t => t.id)).toEqual([0, 1]);

    const destination = dispatchFixture(true);
    Object.assign(destination.pending, { kind: "outbound", fromPoint: -1, fromX: 54, fromY: 54, toPoint: 3, toX: 144, toY: 24 });
    stepWarehouseTraffic(destination.state);
    expect(destination.pending.startS).toBeNull(); expect(destination.state.head).toBe(1);
  });

  it("keeps a pickup reserved during loading and leaves blocked-head FIFO order unchanged", () => {
    const { state, pending } = dispatchFixture(false);
    if (!isTrafficInput(state.input)) throw new Error("Missing traffic input");
    delete state.input.demoTraffic.dispatchPolicy;
    const independent: SimTask = { ...pending, id: 2, fromPoint: 1, fromY: 34 };
    state.tasks.push(independent);
    stepWarehouseTraffic(state);
    expect(state.head).toBe(1); expect(pending.startS).toBeNull(); expect(independent.startS).toBeNull();
    expect(state.tasks.map(t => t.id)).toEqual([0, 1, 2]);
  });

  it("keeps the occupied pickup reserved but assigns an independent oldest feasible task under the explicit warehouse policy", () => {
    const { state, pending } = dispatchFixture(false), independent: SimTask = { ...pending, id: 2, fromPoint: 1, fromY: 34 };
    state.tasks.push(independent); stepWarehouseTraffic(state);
    expect(pending.startS).toBeNull(); expect(independent.startS).toBe(0);
    expect(state.head).toBe(2); expect(state.tasks.map(t => t.id)).toEqual([0, 1, 2]);
    expect(state.dispatchQueue!.indices).toEqual([1]);
  });

  it("preserves the unchanged customer demand and creation order while accounting for additional physical legs",()=>{
    const raw=warehouseBaseInput(14);raw.demand.warmupMin=5;raw.demand.peakMin=30;
    const prepared=prepareWarehouseTraffic(raw),state=createWarehouseTrafficState(prepared),source=createSim(prepared);
    while(!isDone(state)){
      stepWarehouseTraffic(state);stepSim(source);
      const active=state.robots.flatMap(r=>r.task?[r.task]:[]),pending=state.tasks.filter(t=>t.startS===null),completed=state.tasks.filter(t=>t.doneS!==null);
      expect(new Set(active.map(t=>t.id)).size).toBe(active.length);expect(completed.length+active.length+pending.length).toBe(state.tasks.length);
      expect(state.doneCount).toBe(completed.filter(t=>t.countsTowardDemand!==false).length);expect(state.physicalDoneCount).toBe(completed.length);
      // A return appended after dispatch joins the indexed queue on the next tick.
      const indexed=(state.dispatchQueue?.indices??[]).map(i=>state.tasks[i]!.id),newTail=state.tasks.slice(state.dispatchQueue?.enqueuedThrough??0).filter(t=>t.startS===null).map(t=>t.id);
      expect([...indexed,...newTail].sort((a,b)=>a-b)).toEqual(pending.map(t=>t.id).sort((a,b)=>a-b));expect(state.demoTraffic.replansThisTick).toBeLessThanOrEqual(1);
    }
    const trace=(s:typeof state|typeof source)=>s.tasks.filter(t=>t.countsTowardDemand!==false).map(({id,kind,arrivalS,fromPoint,fromX,fromY,toPoint,toX,toY})=>({id,kind,arrivalS,fromPoint,fromX,fromY,toPoint,toX,toY}));
    expect(trace(state)).toEqual(trace(source));expect(state.rng).toEqual(source.rng);expect(state.input.demand.peakPerH).toBe(129.54545454545453);
    expect(state.tasks.some(t=>t.countsTowardDemand===false)).toBe(true);expect(state.doneCount).toBeGreaterThan(0);
    expect(state.demoTraffic.collisionCount).toBe(0);expect(state.demoTraffic.minimumClearanceM).toBeGreaterThanOrEqual(.15-1e-8);
  },15000);

  it("reuses an already active idle robot at the cap without admitting another parked body", () => {
    const input = commonSite(1,false); input.demand.avgPerH = 0; input.demand.peakPerH = 0; input.demoTraffic.maxActiveRoutes = 1;
    const state = createWarehouseTrafficState(input), robot = state.robots[0]!;
    Object.assign(robot, { x: 6, y: 24, soc: 1 });
    const pending: SimTask = { id: 0, kind: "outbound", fromPoint: -1, fromX: 22, fromY: 54, toPoint: 3, toX: 144, toY: 24, arrivalS: 0, startS: null, doneS: null };
    state.tasks.push(pending);
    stepWarehouseTraffic(state);
    expect(robot.task).toBe(pending); expect(pending.startS).toBe(0); expect(state.demoTraffic.bodies[0]!.parking).toBe(false);

    const capped = dispatchFixture(false);
    if (!isTrafficInput(capped.state.input)) throw new Error("Expected traffic input");
    capped.state.input.demoTraffic.maxActiveRoutes = 1;
    Object.assign(capped.pending, { fromPoint: 1, fromY: 34 });
    stepWarehouseTraffic(capped.state);
    expect(capped.pending.startS).toBeNull(); expect(capped.state.robots[1]!.task).toBeNull();
    expect(capped.state.demoTraffic.bodies[1]!.parking).toBe(false);
  });

  it("reserves entire swept segments, including crossing trajectories with disjoint endpoints", () => {
    const robots = [{ id: 0, x: -2, y: 0 }, { id: 1, x: 0, y: -2 }];
    const c = createTrafficController(robots, 0.4, 0.1);
    beginTrafficStep(c, robots, 0, 1);
    expect(reserveTrafficMotion(c, 0, [robots[0]!, { x: 2, y: 0 }])).toBe(true);
    expect(reserveTrafficMotion(c, 1, [robots[1]!, { x: 0, y: 2 }])).toBe(false);
    expect(c.bodies[1]).toMatchObject({ blocked: true, blockedBy: 0, totalWaitS: 1 });
    // A safe alternative in the same tick is movement, not a fictional full second of waiting.
    expect(reserveTrafficMotion(c, 1, [robots[1]!, { x: 0, y: -3 }])).toBe(true);
    expect(c.bodies[1]).toMatchObject({ blocked: false, reason: null, totalWaitS: 0 });
    expect(() => createTrafficController([{ id: 0, x: 0, y: 0 }, { id: 1, x: 0.8, y: 0 }], 0.4, 0.1)).toThrow();
  });

  it("finds a real lateral detour from mid-edge without crossing a waiting robot", () => {
    const layout = { widthM: 12, heightM: 10, footprint: [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 10 }, { x: 0, y: 10 }], obstacles: [], walls: [], routingGraph: {
      clearanceM: 0.8, nodes: [{ id: "a", x: 1, y: 4 }, { id: "b", x: 11, y: 4 }, { id: "c", x: 1, y: 7 }, { id: "d", x: 11, y: 7 }],
      edges: [{ from: "a", to: "b" }, { from: "a", to: "c" }, { from: "c", to: "d" }, { from: "d", to: "b" }],
    }, zones: [], crossAislesY: [], rackAislesX: [], slots: [], receiving: [], shipping: [], chargers: [] } satisfies SimLayout;
    const blocker = { id: 1, x: 6, y: 4 }, path = freeGraphRoute(layout, { x: 3, y: 4 }, { x: 11, y: 4 }, [blocker], 1.65)!;
    expect(path).not.toBeNull(); expect(path.some((p) => p.y === 7)).toBe(true);
    for (let i = 1; i < path.length; i++) {
      expect(siteSegmentIsClear(layout, path[i - 1]!, path[i]!)).toBe(true);
      expect(segmentDistance(path[i - 1]!, path[i]!, blocker, blocker)).toBeGreaterThanOrEqual(1.65);
    }
  });

  it("escapes the exact N8 parking lock using accessible floor beyond the sparse lanes", () => {
    const layout = commonSite().siteLayout!;
    const robots = [
      { id: 0, x: 3.8, y: 7.2 }, { id: 1, x: 10, y: 16 }, { id: 2, x: 1.6, y: 8.2 }, { id: 3, x: 5, y: 6 },
      { id: 4, x: 6, y: 8 }, { id: 5, x: 4.6, y: 16 }, { id: 6, x: 12, y: 16 }, { id: 7, x: 7, y: 16 },
    ];
    const before = structuredClone(robots), goal = { x: 1.6, y: 13.8 };
    for (const others of [[robots[5]!], robots.slice(0, 7)]) {
      const path = freeGraphRoute(layout, robots[7]!, goal, others, 1.65)!;
      expect(path).not.toBeNull(); expect(path[0]).toEqual({ x: 7, y: 16 }); expect(path.at(-1)).toEqual(goal);
      expect(() => JSON.stringify(path)).not.toThrow();
      for (let i = 1; i < path.length; i++) {
        expect(siteSegmentIsClear(layout, path[i - 1]!, path[i]!)).toBe(true);
        for (const other of others) expect(segmentDistance(path[i - 1]!, path[i]!, other, other)).toBeGreaterThanOrEqual(1.65 - 1e-8);
      }
      // The planned escape remains subject to the same whole-sweep reservation.
      const controller = createTrafficController(robots, 0.75, 0.15); beginTrafficStep(controller, robots, 8100, 1);
      expect(reserveTrafficMotion(controller, 7, path)).toBe(true);
    }
    expect(robots).toEqual(before);
  });

  it("does not invent a floor route through a separating wall", () => {
    const layout = commonSite().siteLayout!;
    layout.widthM = 20; layout.heightM = 10;
    layout.footprint = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 0, y: 10 }];
    layout.walls = [{ x: 9, y: 0, w: 2, h: 10, id: "separator" }]; layout.obstacles = []; layout.columns = [];
    layout.routingGraph = { clearanceM: 0.8, nodes: [{ id: "left", x: 2, y: 5 }, { id: "right", x: 18, y: 5 }], edges: [] };
    expect(freeGraphRoute(layout, { x: 2, y: 5 }, { x: 18, y: 5 }, [], 1.65)).toBeNull();
  });

  it("does not borrow another robot's assigned home as a yield bay", () => {
    const input = commonSite(2,false); input.demand.avgPerH = 0; input.demand.peakPerH = 0;
    input.demoTraffic.parkingBays = [input.demoTraffic.initialPositions[0]!];
    const state = createWarehouseTrafficState(input), [blocker, robot] = state.robots;
    Object.assign(blocker!, { x: 6, y: 24, phase: "loading", timerS: 1000, soc: 1 });
    Object.assign(robot!, { x: 6, y: 20, phase: "toPickup", soc: 1, path: [{ x: 6, y: 20 }, { x: 6, y: 24 }], pathLenM: 4, distM: 0,
      task: { id: 0, kind: "inbound", fromPoint: 0, fromX: 6, fromY: 24, toPoint: -1, toX: 22, toY: 54, arrivalS: 0, startS: 0, doneS: null } });
    for (let i = 0; i < 25; i++) stepWarehouseTraffic(state);
    expect(state.demoTraffic.bodies[1]!.lastReplanS).toBeGreaterThan(0);
    expect(state.demoTraffic.bodies[1]!.yieldDistanceM).toBeNull();
    expect(robot!.task!.doneS).toBeNull(); expect(state.demoTraffic.collisionCount).toBe(0);
  });

  it("keeps both N7 and N8 completing jobs after the former all-fleet stall on one fixed site", () => {
    const common = commonSite(), runs: ReturnType<typeof createWarehouseTrafficState>[] = [];
    for (const fleet of [7, 8]) {
      const input = structuredClone(common); input.robots.count = fleet; input.demoTraffic.initialPositions = input.demoTraffic.initialPositions.slice(0, fleet);
      const state = createWarehouseTrafficState(input);
      while (state.tS < 2776) stepWarehouseTraffic(state);
      const before = state.doneCount;
      while (!isDone(state)) stepWarehouseTraffic(state);
      expect(state.doneCount).toBeGreaterThan(before + 40);
      expect(state.tasks.some((task) => task.doneS !== null && task.doneS > 7500)).toBe(true);
      expect(state.demoTraffic.collisionCount).toBe(0);
      expect(state.demoTraffic.minimumClearanceM).toBeGreaterThanOrEqual(0.15 - 1e-8);
      expect(state.assessmentFacts!.zeroSocOperationRobotSeconds).toBe(0);
      runs.push(state);
    }
    const trace = (state: typeof runs[number]) => state.tasks.filter(t=>t.countsTowardDemand!==false).map(({ id, kind, arrivalS, fromPoint, fromX, fromY, toPoint, toX, toY }) => ({ id, kind, arrivalS, fromPoint, fromX, fromY, toPoint, toX, toY }));
    expect(trace(runs[0]!)).toEqual(trace(runs[1]!)); expect(runs[0]!.rng).toEqual(runs[1]!.rng);
  }, 10000);

  it("commits one detour role through an encounter and releases it after real progress", () => {
    const state = encounterState();
    while (!state.routeCommitments.length && state.tS < 30) stepWarehouseTraffic(state);
    expect(state.routeCommitments).toHaveLength(1);
    const commitment = state.routeCommitments[0]!, partner = state.demoTraffic.bodies[commitment.partnerId]!, replans = partner.replans;
    while (state.routeCommitments.length && state.tS < 30) {
      stepWarehouseTraffic(state);
      if (state.routeCommitments.length) expect(partner.replans).toBe(replans);
    }
    expect(state.routeCommitments).toHaveLength(0); expect(commitment.travelledM).toBeGreaterThan(0);
    expect(state.demoTraffic.collisionCount).toBe(0); expect(state.demoTraffic.minimumClearanceM).toBeGreaterThanOrEqual(0.15 - 1e-8);
    while (state.tS < 100) stepWarehouseTraffic(state);
    expect(state.tasks.every(task => task.startS === 0)).toBe(true);
    expect(state.robots.every(r => r.x !== 10 || r.y !== 16)).toBe(true);
  });

  it("releases a pair role for a stationary handling body so its partner can replan", () => {
    const state = encounterState();
    while (!state.routeCommitments.length && state.tS < 30) stepWarehouseTraffic(state);
    expect(state.routeCommitments).toHaveLength(1);
    const commitment = state.routeCommitments[0]!, holder = state.robots[commitment.robotId]!, partner = state.demoTraffic.bodies[commitment.partnerId]!;
    holder.phase = "loading"; holder.timerS = 100; partner.lastReplanS = -Infinity;
    const deadline = state.tS + 15;
    while (!Number.isFinite(partner.lastReplanS) && state.tS < deadline) stepWarehouseTraffic(state);
    expect(state.routeCommitments).toHaveLength(0); expect(Number.isFinite(partner.lastReplanS)).toBe(true);
    expect(state.demoTraffic.collisionCount).toBe(0);
  });

  it("releases a pair role on a fault while keeping the held robot and task as an obstacle", () => {
    const state = encounterState();
    while (!state.routeCommitments.length && state.tS < 30) stepWarehouseTraffic(state);
    expect(state.routeCommitments).toHaveLength(1);
    const id = state.routeCommitments[0]!.robotId, robot = state.robots[id]!, start = state.tS;
    state.demoIncidents = createIncidentRuntime({ version: "incidents-1.0.0", enabled: true, schedule: [{ id: "held-route", code: "DRIVE_FAULT", robotId: id, detectedAtS: start, ackAtS: start + 15, diagnosingAtS: start + 30, recoveryAtS: start + 120, resolvedAtS: start + 180 }] }, 2);
    const before = { x: robot.x, y: robot.y, task: robot.task!.id, distM: robot.distM, timerS: robot.timerS, loaded: robot.loaded };
    for (let i = 0; i < 180; i++) {
      stepWarehouseTraffic(state);
      expect({ x: robot.x, y: robot.y, task: robot.task!.id, distM: robot.distM, timerS: robot.timerS, loaded: robot.loaded }).toEqual(before);
      expect(state.routeCommitments).toHaveLength(0); expect(state.demoTraffic.reservations.find(r => r.id === id)!.path).toHaveLength(1);
    }
    expect(state.demoTraffic.collisionCount).toBe(0); expect(state.demoTraffic.minimumClearanceM).toBeGreaterThanOrEqual(0.15 - 1e-8);
  });

  it("keeps optional production hooks bit-identical when they permit all legacy actions", () => {
    const input = warehouseBaseInput(9), legacy = createSim(input), gated = createSim(structuredClone(input));
    for (let i = 0; i < 1200; i++) { stepSim(legacy); stepSim(gated, 1, (_s, _r, next) => next, () => true); }
    expect(gated).toEqual(legacy);
    const held = createSim(warehouseBaseInput(1));
    while (!held.robots[0]!.task) stepSim(held);
    const robot = held.robots[0]!, before = { x: robot.x, y: robot.y, dist: robot.distM, soc: robot.soc };
    stepSim(held, 1, () => false);
    expect({ x: robot.x, y: robot.y, dist: robot.distM }).toEqual({ x: before.x, y: before.y, dist: before.dist });
    expect(robot.soc).toBeLessThan(before.soc);
  });

  it("represents sixty real bodies and continues completing work in a bounded dense replay",()=>{
    const raw=warehouseBaseInput(60);raw.siteLayout=complexSite(10000,5,true);raw.layout.chargers=5;raw.layout.receivingDocksCount=2;raw.layout.shippingDocksCount=2;raw.demand.warmupMin=5;raw.demand.peakMin=30;
    const input=prepareWarehouseTraffic(raw),state=createWarehouseTrafficState(input);
    expect(state.robots).toHaveLength(60);expect(new Set(state.robots.map(r=>`${r.x},${r.y}`)).size).toBe(60);
    stepPlayback(state,900);const first=state.doneCount;while(!isDone(state))stepPlayback(state,300);
    expect(state.doneCount).toBeGreaterThan(first);expect(state.tasks.some(t=>t.doneS!==null&&t.doneS>state.endS-300)).toBe(true);
    const used=state.robots.filter(r=>state.demoTraffic.bodies[r.id]!.assignments>0);expect(used.length).toBeGreaterThan(1);
    expect(Object.values(state.demoTraffic.bodies).reduce((n,b)=>n+b.assignments,0)).toBe(state.head);
    expect(state.demoTraffic.collisionCount).toBe(0);expect(state.demoTraffic.minimumClearanceM).toBeGreaterThanOrEqual(.15-1e-8);
  },15000);

  it("cleaners never overlap or clean while a traffic stop prevents movement", () => {
    const input = createSectionInput(), state = createSectionPlayback(input);
    let stoppedTicks = 0;
    while (!sectionDone(state)) {
      const before = state.robots.map((r) => ({ x: r.x, y: r.y, cells: r.cleanedCells }));
      stepSectionPlayback(state, 0.1);
      for (const r of state.robots) if (r.safety!.blocked && r.vMps === 0) {
        stoppedTicks++; expect(r.cleanedCells).toBe(before[r.id]!.cells);
        expect(r.x).toBe(before[r.id]!.x); expect(r.y).toBe(before[r.id]!.y);
      }
    }
    expect(stoppedTicks).toBeGreaterThan(0);
    expect(state.traffic.collisionCount).toBe(0);
    expect(state.traffic.minimumClearanceM).toBeGreaterThanOrEqual(0.12 - 1e-8);
    expect(sectionFrame(state).sections.every((s) => s.progress === 100)).toBe(true);
  });

  it("a stopped warehouse preview predicts the accepted next step without moving canonical state", () => {
    const raw=warehouseBaseInput(11);raw.siteLayout=complexSite(10000,1,true);raw.layout.receivingDocksCount=2;raw.layout.shippingDocksCount=2;raw.demand.warmupMin=5;raw.demand.peakMin=30;const state=createPlayback(prepareWarehouseTraffic(raw));
    let stops = 0;
    for (let n = 0; n < 1200; n++) {
      if (isWarehouseTrafficState(state) && Object.values(state.demoTraffic.bodies).some((b) => b.blocked)) {
        const snapshot = structuredClone(state), predicted = previewInterpolate(state, 1);
        expect(state).toEqual(snapshot);
        stepPlayback(state); const frame = playbackFrame(state);
        predicted.robots.forEach((r, i) => { expect(r.x).toBeCloseTo(frame.robots[i]!.x, 8); expect(r.y).toBeCloseTo(frame.robots[i]!.y, 8); });
        if (++stops === 5) break;
      } else stepPlayback(state);
    }
    expect(stops).toBe(5);
  });
});
