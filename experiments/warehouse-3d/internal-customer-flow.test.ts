import { describe, expect, it } from "vitest";
import { warehouseBaseInput } from "../../lib/sim/fixtures";
import type { SimTask } from "../../lib/sim/state";
import { summarize } from "../../lib/sim/metrics";
import { assessWarehouse } from "./assessment";
import { createWarehouseTrafficState, prepareWarehouseTraffic, stepWarehouseTraffic } from "./traffic";
import { underliftCanAssign } from "./carriers";
import * as Core from "./core";
import "./robot-history.js";

function fixture(vacancyShare = .1) {
  const base = warehouseBaseInput(1);
  const input = prepareWarehouseTraffic({ ...base, transportWorkflow: "closed-pod-1", layout: { ...base.layout, activeAreaM2: 5000 },
    robots: { ...base.robots, count: 1, autonomyH: null, chargeMin: null },
    demand: { avgPerH: 0, peakPerH: 0, warmupMin: 0, peakMin: 30, mix: { inbound: 0, outbound: 0, internal: 1 }, storageVacancyShare: vacancyShare } });
  input.demoIncidents!.enabled = false; input.demoIncidents!.schedule = [];
  return createWarehouseTrafficState(input);
}

function queuedTransfers() {
  const state=fixture(),pod=state.demoUnderlift!.pods[0]!,home={...pod.home},receiving=state.layout.receiving[0]!,shipping=state.layout.shipping[0]!;
  const tasks:SimTask[]=[
    {id:0,kind:"internal",podId:pod.id,storageDestinationDraw:0,fromPoint:-1,toPoint:-1,fromX:home.x,fromY:home.y,toX:home.x,toY:home.y,arrivalS:0,startS:null,doneS:null},
    {id:1,kind:"inbound",podId:pod.id,fromPoint:0,toPoint:-1,fromX:receiving.x,fromY:receiving.y,toX:home.x,toY:home.y,arrivalS:0,startS:null,doneS:null},
    {id:2,kind:"outbound",podId:pod.id,fromPoint:-1,toPoint:state.layout.receiving.length,fromX:home.x,fromY:home.y,toX:shipping.x,toY:shipping.y,arrivalS:0,startS:null,doneS:null},
  ];
  state.tasks.push(...tasks);state.nextDemandTaskId=3;state.acc.bucketArrivals[0]=3;
  return state;
}

describe("physical customer storage transfers", () => {
  it("reserves a real vacant destination, preserves the full carrier ID, updates its home and releases the source", () => {
    const state = fixture(), inventory = state.demoUnderlift!, pod = inventory.pods[0]!, original = { ...pod.home };
    const task: SimTask = { id: 0, kind: "internal", podId: pod.id, storageDestinationDraw: 0,
      fromPoint: -1, toPoint: -1, fromX: pod.home.x, fromY: pod.home.y, toX: pod.home.x, toY: pod.home.y,
      arrivalS: 0, startS: null, doneS: null };
    const ids = inventory.pods.map(p => p.id), vacant = inventory.vacantHomes!.map(p => ({ ...p }));
    state.tasks.push(task); state.acc.bucketArrivals[0] = 1; state.nextDemandTaskId = 1;
    expect(underliftCanAssign(state, state.robots[0]!, task)).toBe(true);
    const destination = { x: task.toX, y: task.toY };
    expect(vacant).toContainEqual(destination);
    expect(inventory.targetReservations![`${destination.x};${destination.y}`]).toBe(task.id);
    expect(inventory.pods.some(p => p.x === destination.x && p.y === destination.y)).toBe(false);
    while (task.doneS === null && state.tS < state.endS) stepWarehouseTraffic(state);
    expect(task.doneS).not.toBeNull();
    expect(state.doneCount).toBe(1); expect(state.physicalDoneCount).toBe(1);
    expect(state.tasks).toHaveLength(1); // No service prefetch or return is added to customer internal work.
    expect(pod).toMatchObject({ id: pod.id, contents: "full", home: destination, robotId: null, reservedForTaskId: null });
    expect(inventory.vacantHomes).toContainEqual(original);
    expect(inventory.vacantHomes).not.toContainEqual(destination);
    expect(inventory.targetReservations).toEqual({});
    expect(state.storageCarriers!.find(p => p.podId === pod.id)).toEqual({ podId: pod.id, ...destination });
    expect(inventory.pods.map(p => p.id)).toEqual(ids);
    expect(state.demoTraffic.collisionCount).toBe(0);
    expect(state.demoTraffic.minimumClearanceM).toBeGreaterThanOrEqual(.15 - 1e-8);
    const assessment = assessWarehouse(state, summarize(state));
    expect(assessment.checks.find(c => c.id === "underlift")?.status).toBe("PASS");
  });

  it("does not invent a destination in a fully occupied warehouse", () => {
    const state = fixture(0), pod = state.demoUnderlift!.pods[0]!;
    const task: SimTask = { id: 0, kind: "internal", podId: pod.id, storageDestinationDraw: .5,
      fromPoint: -1, toPoint: -1, fromX: pod.x, fromY: pod.y, toX: pod.x, toY: pod.y,
      arrivalS: 0, startS: null, doneS: null };
    state.tasks.push(task);
    expect(state.demoUnderlift!.vacantHomes).toEqual([]);
    expect(underliftCanAssign(state, state.robots[0]!, task)).toBe(false);
    for (let i = 0; i < 60; i++) stepWarehouseTraffic(state);
    expect(task.startS).toBeNull(); expect(task.doneS).toBeNull(); expect(state.doneCount).toBe(0);
  });

  it("keeps queued receiving/shipping work bound to the same relocated carrier and its new home",()=>{
    const state=queuedTransfers(),pod=state.demoUnderlift!.pods[0]!,oldHome={...pod.home};
    while(state.tS<state.endS)stepWarehouseTraffic(state);
    const [internal,inbound,outbound]=state.tasks;
    expect(state.doneCount).toBe(3);expect(state.physicalDoneCount).toBe(5);
    expect([pod.home.x,pod.home.y]).toEqual([internal!.toX,internal!.toY]);
    expect(pod.home).not.toEqual(oldHome);
    expect([inbound!.toX,inbound!.toY,outbound!.fromX,outbound!.fromY]).toEqual([pod.home.x,pod.home.y,pod.home.x,pod.home.y]);
    expect(state.tasks.filter(t=>t.countsTowardDemand===false).map(t=>t.operation).sort()).toEqual(["prefetch-pod","return-pod"]);
    expect(state.tasks.every(t=>t.podId===pod.id)).toBe(true);
    expect(pod).toMatchObject({...pod.home,phase:"parked",robotId:null,liftM:0});
    expect(state.demoTraffic.collisionCount).toBe(0);
  });

  it("rebuilds seek/history from canonical relocation state while keeping customer and service work distinct",async()=>{
    const engine={...Core,createPlayback:queuedTransfers};
    type Interval={startS:number;taskId:number|null;carrierId?:string|null;label:string;countsTowardDemand?:boolean};
    const history=(globalThis as unknown as {createRobotWorkHistory(args:unknown):Promise<{intervals:Interval[]}>}).createRobotWorkHistory;
    const result=await history({Core:engine,input:fixture().input,robotId:0});
    const moves=result.intervals.filter(i=>i.taskId===0);
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every(i=>i.label.includes("Хранение → хранение")&&i.countsTowardDemand===true)).toBe(true);
    expect(result.intervals.some(i=>i.taskId!==null&&i.taskId<0&&i.countsTowardDemand===false)).toBe(true);
    const end=queuedTransfers();while(end.tS<end.endS)Core.stepPlayback(end);
    const movedAt=end.tasks[0]!.doneS!;
    const seek=queuedTransfers();while(seek.tS<movedAt)Core.stepPlayback(seek);
    const expectedHome={x:end.tasks[0]!.toX,y:end.tasks[0]!.toY};
    expect(seek.demoUnderlift!.pods[0]!.home).toEqual(expectedHome);
    expect(Core.playbackFrame(seek).carriers[0]).toMatchObject({id:end.demoUnderlift!.pods[0]!.id,home:expectedHome});
    const rewind=queuedTransfers();while(rewind.tS<movedAt)Core.stepPlayback(rewind);
    expect(Core.playbackFrame(rewind)).toEqual(Core.playbackFrame(seek));
  });
});
