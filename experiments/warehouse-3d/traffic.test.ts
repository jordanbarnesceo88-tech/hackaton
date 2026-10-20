import { describe, expect, it, vi } from "vitest";
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
import { assignUnderlift, underliftCanAssign, prepareUnderliftRoute } from "./carriers";
import * as carrierMechanics from "./carriers";
import { requestDock, dockPathAllowed } from "./dock-access";
import { sendToCharger } from "../../lib/sim/dispatch";
import { beginTrafficStep, createTrafficController, createWarehouseTrafficState, freeGraphRoute, isTrafficInput, isWarehouseTrafficState, prepareWarehouseTraffic, reserveTrafficMotion, segmentDistance, stepWarehouseTraffic } from "./traffic";

function commonSite(maxFleet = 12,physical=true,mobileStorage=false) {
  const input = warehouseBaseInput(maxFleet);
  input.siteLayout = complexSite(10000, 1,mobileStorage);
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
  it("does not give an unusable replan turn to a protected extraction while another failed plan becomes available",()=>{
    const input=commonSite(4);input.demand.avgPerH=0;input.demand.peakPerH=0;
    const state=createWarehouseTrafficState(input),pool=state.demoUnderlift!;
    const pods=[pool.pods[0]!,pool.pods[Math.floor(pool.pods.length/2)]!];
    const tasks=pods.map((pod,id):SimTask=>({id,kind:"outbound",podId:pod.id,fromPoint:-1,fromX:pod.x,fromY:pod.y,toPoint:state.layout.receiving.length+id,toX:state.layout.shipping[id]!.x,toY:state.layout.shipping[id]!.y,arrivalS:0,startS:0,doneS:null}));
    const exits=pods.map(p=>pool.docks.find(d=>Math.hypot(d.x-p.x,d.y-p.y)<1e-8)!.entry);
    for(const id of [0,1]){
      const r=state.robots[id]!,pod=pods[id]!,task=tasks[id]!;
      Object.assign(r,{x:pod.x,y:pod.y,phase:"toDrop",loaded:true,task,soc:1});assignUnderlift(state,r,task);
      r.path=route(state.layout,r,{x:task.toX,y:task.toY});r.pathLenM=routeLengthM(r.path);r.distM=0;
      Object.assign(r.underlift!,{stage:"extract",podLiftM:.06,platformTopM:.5,contact:true,contactGapM:0,routeStage:id===0?"drop":undefined,extractionUntilM:id===0?2:undefined});
      Object.assign(pod,{phase:"carrying",liftM:.06});
    }
    Object.assign(state.robots[3]!,{...exits[0]!,phase:"waitCharger",pointIdx:-1});
    Object.assign(state.robots[2]!,{...exits[1]!,soc:.1});sendToCharger(state,state.robots[2]!);
    state.tasks=tasks;state.head=2;state.nextDemandTaskId=2;pool.stockRevision++;
    stepWarehouseTraffic(state);expect(state.demoTraffic.bodies[1]!.routePlanFailed).toBe(true);
    // A controlled obstacle-clear fixture; this is not asserted to be the third robot's trajectory.
    Object.assign(state.robots[2]!,{...input.demoTraffic.initialPositions[2]!,phase:"waitCharger",pointIdx:-1});
    for(let t=1;t<20;t++)stepWarehouseTraffic(state);
    const b=state.robots[1]!;expect(Math.hypot(b.x-tasks[1]!.fromX,b.y-tasks[1]!.fromY)).toBeGreaterThan(0);
    expect(state.demoTraffic.bodies[1]!.routePlanFailed).toBe(false);expect(state.demoTraffic.collisionCount).toBe(0);
  });

  it("escapes a physically clear receiving dock through a checked existing bay when an incoming robot blocks the direct route anchor",()=>{
    const base=warehouseBaseInput(2);base.layout.activeAreaM2=5000;base.layout.chargers=2;base.demand.avgPerH=0;base.demand.peakPerH=0;
    const input=prepareWarehouseTraffic(base);input.demoIncidents={version:"incidents-1.0.0",enabled:false,schedule:[]};
    const state=createWarehouseTrafficState(input),pool=state.demoUnderlift!,station=state.layout.receiving[0]!,dock=pool.docks.find(d=>Math.hypot(d.x-station.x,d.y-station.y)<1e-8)!;
    const a=pool.pods.find(p=>Math.hypot(p.home.x-74.5,p.home.y-14.5)<1e-8)!,b=pool.pods.find(p=>Math.hypot(p.home.x-28.1,p.home.y-21.1)<1e-8)!;
    const parent=(id:number,pod:typeof a,startS:number|null):SimTask=>({id,kind:"inbound",podId:pod.id,fromPoint:0,fromX:station.x,fromY:station.y,toPoint:-1,toX:pod.home.x,toY:pod.home.y,arrivalS:0,startS,doneS:null});
    const first=parent(28,a,0),last=parent(32,b,null),prefetch:SimTask={id:-32,kind:"inbound",operation:"prefetch-pod",countsTowardDemand:false,parentTaskId:32,podId:b.id,fromPoint:-1,fromX:b.home.x,fromY:b.home.y,toPoint:0,toX:station.x,toY:station.y,arrivalS:0,startS:0,doneS:null};
    for(const [id,r]of state.robots.entries()){
      const task=id===0?first:prefetch,pod=id===0?a:b,position=id===0?{x:station.x,y:station.y}:{x:6.4,y:15};
      Object.assign(r,{...position,phase:"toDrop",task,loaded:true,soc:1});assignUnderlift(state,r,task);
      Object.assign(r.underlift!,{stage:id===0?"extract":"carry",podLiftM:.06,platformTopM:.5,contact:true,contactGapM:0,headingRad:id===0?dock.heading:-Math.PI/2,...(id===1?{routeStage:"drop"}:{})});
      Object.assign(pod,{...position,phase:"carrying",liftM:.06,heading:r.underlift!.headingRad});
      r.path=id===0?route(state.layout,r,a.home):[{...position},{x:6.4,y:dock.entry.y},{...dock.entry},{x:station.x,y:station.y}];r.pathLenM=routeLengthM(r.path);r.distM=0;
    }
    state.tasks=[first,prefetch,last];state.head=2;state.nextDemandTaskId=33;pool.nextInternalId=-33;pool.stockRevision++;
    expect(requestDock(state.dockAccess,{robotId:0,key:"28:pickup",center:dock,entry:dock.entry,tS:0},state.robots)).toBe(true);
    for(let t=0;t<120;t++)stepWarehouseTraffic(state);
    expect(state.dockAccess.grants.some(g=>g.key==="28:pickup")).toBe(false);
    while(state.tS<1800&&state.physicalDoneCount!==3)stepWarehouseTraffic(state);
    expect(state.physicalDoneCount).toBe(3);expect([first,prefetch,last].every(t=>t.doneS!==null)).toBe(true);
    for(const pod of [a,b]){expect(pod.robotId).toBeNull();expect(pod.x).toBeCloseTo(pod.home.x,8);expect(pod.y).toBeCloseTo(pod.home.y,8);}
    expect(state.demoTraffic.collisionCount).toBe(0);expect(state.demoTraffic.minimumClearanceM).toBeGreaterThanOrEqual(.15-1e-8);
  });

  it("retries immediately after an occupied destination entry clears without repeating a full failed floor search",()=>{
    const input=commonSite(2);input.demand.avgPerH=0;input.demand.peakPerH=0;
    const state=createWarehouseTrafficState(input),r=state.robots[0]!,pod=state.demoUnderlift!.pods[0]!,destination=state.layout.shipping[0]!;
    const task:SimTask={id:0,kind:"outbound",podId:pod.id,fromPoint:-1,fromX:pod.home.x,fromY:pod.home.y,toPoint:state.layout.receiving.length,toX:destination.x,toY:destination.y,arrivalS:0,startS:0,doneS:null};
    Object.assign(r,{...pod.home,phase:"toDrop",task,loaded:true,soc:1});assignUnderlift(state,r,task);
    r.path=route(state.layout,r,destination);r.pathLenM=routeLengthM(r.path);r.distM=0;
    Object.assign(r.underlift!,{stage:"lift",podLiftM:.06,platformTopM:.5,contact:true,contactGapM:0});Object.assign(pod,{phase:"carrying",liftM:.06});
    const target=state.demoUnderlift!.docks.find(d=>Math.hypot(d.x-destination.x,d.y-destination.y)<1e-8)!;
    Object.assign(state.robots[1]!,{...target.entry,phase:"waitCharger",pointIdx:-1});state.demoUnderlift!.stockRevision++;state.tasks=[task];state.head=1;
    stepWarehouseTraffic(state);stepWarehouseTraffic(state);
    expect(r.x).toBe(pod.home.x);expect(r.y).toBe(pod.home.y);
    Object.assign(state.robots[1]!,input.demoTraffic.initialPositions[1]!);
    stepWarehouseTraffic(state);
    expect(Math.hypot(r.x-pod.home.x,r.y-pod.home.y)).toBeGreaterThan(0);expect(task.doneS).toBeNull();expect(state.demoTraffic.collisionCount).toBe(0);
  });

  it("bounds a station to two distinct transport intents while deduplicating a resident pod that is still unloading",()=>{
    const input=commonSite(3);input.demand.avgPerH=0;input.demand.peakPerH=0;
    const state=createWarehouseTrafficState(input),pool=state.demoUnderlift!,station=state.layout.shipping[0]!;
    const tasks=pool.pods.slice(0,3).map((pod,id):SimTask=>({id,kind:"outbound",podId:pod.id,fromPoint:-1,fromX:pod.home.x,fromY:pod.home.y,toPoint:state.layout.receiving.length,toX:station.x,toY:station.y,arrivalS:0,startS:null,doneS:null}));
    state.tasks=tasks;state.nextDemandTaskId=3;stepWarehouseTraffic(state);
    expect(state.robots.filter(r=>r.task)).toHaveLength(2);expect(tasks[2]!.startS).toBeNull();
    const first=state.robots.find(r=>r.task===tasks[0])!,second=state.robots.find(r=>r.task===tasks[1])!,third=state.robots.find(r=>!r.task)!;
    // One carrier transitioning from incoming to resident still consumes only one logical intent.
    Object.assign(pool.pods[0]!,{x:station.x,y:station.y,phase:"unloading"});Object.assign(first,{x:station.x,y:station.y,phase:"unloading"});
    second.task=null;second.phase="idle";pool.revision++;pool.stockRevision++;
    expect(underliftCanAssign(state,third,tasks[2]!)).toBe(true);
  });

  it("clears a resident station carrier beyond the sixteen-customer lookahead before a backlog of prefetched carriers",()=>{
    const input=commonSite(2);input.demand.avgPerH=0;input.demand.peakPerH=0;
    const state=createWarehouseTrafficState(input),pool=state.demoUnderlift!,station=state.layout.receiving[0]!,shipping=state.layout.shipping[0]!,resident=pool.pods[0]!;
    const blocked:Array<SimTask>=Array.from({length:16},(_,id)=>({id,kind:"outbound",podId:resident.id,fromPoint:-1,fromX:resident.home.x,fromY:resident.home.y,toPoint:state.layout.receiving.length,toX:shipping.x,toY:shipping.y,arrivalS:0,startS:null,doneS:null}));
    const parents=pool.pods.slice(0,11).map((pod,i):SimTask=>({id:16+i,kind:"inbound",podId:pod.id,fromPoint:0,fromX:station.x,fromY:station.y,toPoint:-1,toX:pod.home.x,toY:pod.home.y,arrivalS:0,startS:null,doneS:null}));
    Object.assign(resident,{x:station.x,y:station.y,phase:"delivered",reservedForTaskId:16});
    const prefetch=parents.slice(1).map((parent,i):SimTask=>{const pod=pool.pods[i+1]!;pod.reservedForTaskId=parent.id;return {id:-1-i,kind:"inbound",operation:"prefetch-pod",countsTowardDemand:false,parentTaskId:parent.id,podId:pod.id,fromPoint:-1,fromX:pod.x,fromY:pod.y,toPoint:0,toX:station.x,toY:station.y,arrivalS:0,startS:null,doneS:null};});
    state.tasks=[...blocked,...parents,...prefetch];state.nextDemandTaskId=27;pool.nextInternalId=-11;pool.stockRevision++;
    stepWarehouseTraffic(state);
    expect(parents[0]!.startS).toBe(0);
    while(state.tS<1800&&parents.slice(0,3).some(t=>t.doneS===null))stepWarehouseTraffic(state);
    expect(parents.slice(0,3).every(t=>t.doneS!==null)).toBe(true);
    expect(state.demoTraffic.collisionCount).toBe(0);
  });

  it.each(["robot","grounded-pod"])("still refuses loaded extraction when a real %s blocks the source exit",(obstacle)=>{
    const input=commonSite(2);input.demand.avgPerH=0;input.demand.peakPerH=0;
    const state=createWarehouseTrafficState(input),r=state.robots[0]!,pod=state.demoUnderlift!.pods[0]!,destination=state.layout.shipping[0]!;
    const task:SimTask={id:0,kind:"outbound",podId:pod.id,fromPoint:-1,fromX:pod.home.x,fromY:pod.home.y,toPoint:state.layout.receiving.length,toX:destination.x,toY:destination.y,arrivalS:0,startS:0,doneS:null};
    Object.assign(r,{...pod.home,phase:"toDrop",task,loaded:true,soc:1});assignUnderlift(state,r,task);
    r.path=route(state.layout,r,destination);r.pathLenM=routeLengthM(r.path);r.distM=0;
    Object.assign(r.underlift!,{stage:"lift",podLiftM:.06,platformTopM:.5,contact:true,contactGapM:0});Object.assign(pod,{phase:"carrying",liftM:.06});
    const exit=state.demoUnderlift!.docks.find(d=>Math.hypot(d.x-pod.home.x,d.y-pod.home.y)<1e-8)!.entry;
    if(obstacle==="robot")Object.assign(state.robots[1]!,{...exit,phase:"waitCharger",pointIdx:-1});
    else Object.assign(state.demoUnderlift!.pods[1]!,{...exit,phase:"delivered",robotId:null});
    state.demoUnderlift!.stockRevision++;state.tasks=[task];state.head=1;
    const attempts:number[]=[],original=carrierMechanics.prepareUnderliftRoute;
    const planning=vi.spyOn(carrierMechanics,"prepareUnderliftRoute").mockImplementation((s,robot,planner)=>original(s,robot,(from,to,pickup)=>{if(robot.id===0)attempts.push(s.tS);return planner(from,to,pickup);}));
    try{for(let t=0;t<20;t++)stepWarehouseTraffic(state);}finally{planning.mockRestore();}
    expect(attempts).toEqual([0,5,10,15]);
    expect(r.x).toBe(pod.home.x);expect(r.y).toBe(pod.home.y);expect(task.doneS).toBeNull();expect(r.task).toBe(task);
    expect(state.physicalDoneCount).toBe(0);expect(state.demoTraffic.collisionCount).toBe(0);
  });

  it("clears two source capsules before waiting for the other destination capsule without bypassing local access",()=>{
    const input=commonSite(2,true,true);input.demand.avgPerH=0;input.demand.peakPerH=0;
    const state=createWarehouseTrafficState(input),station=state.layout.shipping[0]!,pool=state.demoUnderlift!;
    const a=pool.pods.find(p=>Math.hypot(p.home.x-4.9,p.home.y-50.9)<1e-8)!,b=pool.pods.find(p=>Math.hypot(p.home.x-8.9,p.home.y-52.1)<1e-8)!;
    const tasks:SimTask[]=[{id:-100,kind:"outbound",operation:"return-pod",countsTowardDemand:false,parentTaskId:0,podId:a.id,fromPoint:state.layout.receiving.length,fromX:station.x,fromY:station.y,toPoint:-1,toX:a.home.x,toY:a.home.y,arrivalS:0,startS:0,doneS:null},{id:1,kind:"outbound",podId:b.id,fromPoint:-1,fromX:b.home.x,fromY:b.home.y,toPoint:state.layout.receiving.length,toX:station.x,toY:station.y,arrivalS:0,startS:0,doneS:null}];
    const sourceDocks=[pool.docks.find(d=>Math.hypot(d.x-station.x,d.y-station.y)<1e-8)!,pool.docks.find(d=>Math.hypot(d.x-b.home.x,d.y-b.home.y)<1e-8)!];
    Object.assign(a,{x:station.x,y:station.y});
    for(const [id,r]of state.robots.entries()){
      const task=tasks[id]!,pod=[a,b][id]!,dock=sourceDocks[id]!;
      Object.assign(r,{x:task.fromX,y:task.fromY,phase:"toDrop",task,loaded:true,soc:1});assignUnderlift(state,r,task);
      Object.assign(r.underlift!,{stage:"extract",podLiftM:.06,platformTopM:.5,contact:true,contactGapM:0,headingRad:dock.heading});
      Object.assign(pod,{phase:"carrying",liftM:.06,heading:dock.heading});
      r.path=route(state.layout,r,{x:task.toX,y:task.toY});r.pathLenM=routeLengthM(r.path);r.distM=0;
      expect(requestDock(state.dockAccess,{robotId:id,key:`${task.id}:pickup`,center:dock,entry:dock.entry,tS:0},state.robots)).toBe(true);
    }
    state.tasks=tasks;state.head=2;state.nextDemandTaskId=2;pool.nextInternalId=-101;pool.stockRevision++;
    // A planned future destination is not a right to enter the other robot's capsule.
    expect(dockPathAllowed(state.dockAccess,0,[{x:6.9,y:50.9}])).toBe(false);
    expect(dockPathAllowed(state.dockAccess,1,[sourceDocks[0]!.entry])).toBe(false);
    for(let t=0;t<200;t++)stepWarehouseTraffic(state);
    expect(state.dockAccess.grants.some(g=>g.key==="-100:pickup"||g.key==="1:pickup")).toBe(false);
    while(state.tS<1800&&state.physicalDoneCount!==3)stepWarehouseTraffic(state);
    expect(state.physicalDoneCount).toBe(3);expect(tasks.every(t=>t.doneS!==null)).toBe(true);
    for(const pod of [a,b]){expect(pod.robotId).toBeNull();expect(pod.x).toBeCloseTo(pod.home.x,8);expect(pod.y).toBeCloseTo(pod.home.y,8);}
    expect(state.demoTraffic.collisionCount).toBe(0);expect(state.demoTraffic.minimumClearanceM).toBeGreaterThanOrEqual(.15-1e-8);
  });

  it("does not replace a rejected loaded extraction plan with an unchecked graph route",()=>{
    const input=commonSite(1);input.demand.avgPerH=0;input.demand.peakPerH=0;
    const state=createWarehouseTrafficState(input),r=state.robots[0]!,pod=state.demoUnderlift!.pods[0]!,destination=state.layout.shipping[0]!;
    const task:SimTask={id:0,kind:"outbound",fromPoint:-1,fromX:pod.home.x,fromY:pod.home.y,toPoint:state.layout.receiving.length,toX:destination.x,toY:destination.y,arrivalS:0,startS:0,doneS:null};
    Object.assign(r,{...pod.home,phase:"toDrop",task,loaded:true});assignUnderlift(state,r,task);r.underlift!.stage="lift";
    const path=r.path;
    expect(prepareUnderliftRoute(state,r,()=>null)).toBe(false);expect(r.path).toBe(path);expect(r.underlift!.routeStage).toBeUndefined();
  });

  it.each(["outbound","inbound"] as const)("pipelines distinct %s pods at one shared station while keeping its physical dock exclusive through service legs",(kind)=>{
    const input=commonSite(2);input.demand.avgPerH=0;input.demand.peakPerH=0;
    const state=createWarehouseTrafficState(input),station=kind==="outbound"?state.layout.shipping[0]!:state.layout.receiving[0]!,pods=[state.demoUnderlift!.pods[0]!,state.demoUnderlift!.pods[Math.floor(state.demoUnderlift!.pods.length/2)]!];
    const tasks=pods.map((pod,id):SimTask=>({id,kind,fromPoint:kind==="outbound"?-1:0,fromX:kind==="outbound"?pod.home.x:station.x,fromY:kind==="outbound"?pod.home.y:station.y,toPoint:kind==="outbound"?state.layout.receiving.length:-1,toX:kind==="outbound"?station.x:pod.home.x,toY:kind==="outbound"?station.y:pod.home.y,arrivalS:0,startS:null,doneS:null}));
    state.tasks=tasks;state.nextDemandTaskId=2;
    stepWarehouseTraffic(state);
    if(kind==="inbound")stepWarehouseTraffic(state);
    const active=state.robots.filter(r=>r.task);
    expect(active).toHaveLength(2);
    if(kind==="outbound"){expect(tasks[0]!.startS).toBe(0);expect(tasks[1]!.startS).toBe(0);expect(Math.hypot(active[0]!.x-station.x,active[0]!.y-station.y)).toBeGreaterThan(50);}
    else expect(active.every(r=>r.task!.operation==="prefetch-pod")).toBe(true);
    const first=active[0]!;
    expect(underliftCanAssign(state,state.robots.find(r=>r.id!==first.id)!,{...tasks[0]!,id:100,startS:null})).toBe(false);
    let maximumDockOwners=0;
    while(state.tS<2400&&state.physicalDoneCount!==4){
      stepWarehouseTraffic(state);
      maximumDockOwners=Math.max(maximumDockOwners,new Set(state.dockAccess.grants.filter(g=>Math.hypot(g.center.x-station.x,g.center.y-station.y)<1e-8).map(g=>g.robotId)).size);
    }
    expect(maximumDockOwners).toBe(1);expect(state.physicalDoneCount).toBe(4);expect(tasks.every(t=>t.doneS!==null)).toBe(true);
    for(const pod of pods){expect(pod.robotId).toBeNull();expect(pod.reservedForTaskId).toBeNull();expect(pod.contents).toBe(kind==="outbound"?"empty":"full");expect(pod.x).toBeCloseTo(pod.home.x,8);expect(pod.y).toBeCloseTo(pod.home.y,8);}
    expect(state.demoTraffic.collisionCount).toBe(0);expect(state.demoTraffic.minimumClearanceM).toBeGreaterThanOrEqual(.15-1e-8);
  });

  it.each(["delivery","parking"])("routes an evacuating %s robot around the real waiting curb person before granting the crossing",(mode)=>{
    const input=commonSite(1,false);input.demand.avgPerH=0;input.demand.peakPerH=0;
    input.pedestrians={version:"pedestrians-1",policy:"controlled-crossing",crossingWidthM:2,reactionTimeS:.5,decelerationMps2:.8,accelerationMps2:.8,clearanceM:.25,people:[{id:"curb-person",radiusM:.3,trajectory:[{tS:0,x:124,y:30},{tS:20,x:124,y:10}]}]};
    input.demoTraffic.initialPositions[0]={x:144,y:24};
    const state=createWarehouseTrafficState(input),r=state.robots[0]!,goal=state.layout.shipping[1]!;
    const task:SimTask={id:0,kind:"outbound",fromPoint:-1,fromX:110,fromY:28.8,toPoint:state.layout.receiving.length+1,toX:goal.x,toY:goal.y,arrivalS:0,startS:0,doneS:null};
    Object.assign(r,{x:123,y:28.8,phase:"toDrop",loaded:true,task,soc:1,path:[{x:123,y:28.8},{x:goal.x,y:28.8},{...goal}],distM:0});r.pathLenM=routeLengthM(r.path);
    if(mode==="parking"){r.phase="idle";r.task=null;r.loaded=false;state.demoTraffic.bodies[r.id]!.parking=true;}
    else{state.tasks=[task];state.head=1;}
    for(let t=0;t<90;t++)stepWarehouseTraffic(state);
    const person=state.demoPedestrians!,crossing=person.controlled["curb-person"]!;
    expect(crossing.history).toHaveLength(1);expect(crossing.history[0]!.completedAtS).not.toBeNull();
    if(mode==="delivery")expect(task.doneS).not.toBeNull();
    else{expect(r.x).toBeCloseTo(goal.x,8);expect(r.y).toBeCloseTo(goal.y,8);}
    expect(state.demoTraffic.bodies[r.id]!.replans).toBeGreaterThan(0);
    expect(person.collisionCount).toBe(0);expect(person.brakingViolations).toBe(0);expect(person.minimumClearanceM).toBeGreaterThanOrEqual(.25-1e-8);
    expect(state.demoTraffic.collisionCount).toBe(0);
  });

  it("drops an obsolete yield waypoint when replacing a 100 m route with a short underlift approach",()=>{
    const input=commonSite(1);input.demand.avgPerH=0;input.demand.peakPerH=0;
    const state=createWarehouseTrafficState(input),r=state.robots[0]!,home=state.layout.slots[0]!;
    const dock=state.demoUnderlift!.docks.find(d=>Math.hypot(d.x-home.x,d.y-home.y)<1e-8)!,shipping=state.layout.shipping[0]!;
    const task:SimTask={id:0,kind:"outbound",fromPoint:-1,fromX:home.x,fromY:home.y,toPoint:state.layout.receiving.length,toX:shipping.x,toY:shipping.y,arrivalS:0,startS:0,doneS:null};
    Object.assign(r,{...dock.entry,phase:"toPickup",task,loaded:false,soc:1});
    state.tasks=[task];state.head=1;assignUnderlift(state,r,task);
    r.path=[{...dock.entry},{x:dock.entry.x+100,y:dock.entry.y}];r.pathLenM=100;r.distM=0;
    const body=state.demoTraffic.bodies[r.id]!;body.yieldDistanceM=1;body.yieldStartedS=0;

    // A marker on an unchanged route must still enforce yielding.
    const sameRoute=structuredClone(state),sameRobot=sameRoute.robots[0]!;
    sameRobot.path=[{...dock.entry},{x:home.x,y:home.y}];sameRobot.pathLenM=2;sameRobot.underlift!.routeStage="pickup";
    stepWarehouseTraffic(sameRoute);
    expect(sameRoute.demoTraffic.bodies[0]!.yieldDistanceM).toBe(1);
    expect(sameRobot.distM).toBeLessThanOrEqual(1);

    stepWarehouseTraffic(state);
    expect(r.pathLenM).toBeCloseTo(2,8);
    expect(body.yieldDistanceM).toBeNull();expect(body.yieldStartedS).toBeNull();
    for(let i=0;i<4;i++)stepWarehouseTraffic(state);
    expect(r.phase).toBe("loading");expect(r.task?.id).toBe(0);
    expect(state.demoTraffic.collisionCount).toBe(0);
  });

  it("replays the dense N60/C5 baseline workload exactly over a ten-minute replay window",()=>{
    const input=warehouseBaseInput(60);input.layout.chargers=5;input.demand.warmupMin=0;input.demand.peakMin=10;
    const prepared=prepareWarehouseTraffic(input),headless=createWarehouseTrafficState(prepared),playback=createPlayback(prepared);
    while(!isDone(headless))stepWarehouseTraffic(headless);while(!isPlaybackDone(playback))stepPlayback(playback,900);
    expect(summarize(playback)).toEqual(summarize(headless));expect(playback.tasks).toEqual(headless.tasks);expect(playback.robots).toHaveLength(60);
    expect(headless.doneCount).toBeGreaterThan(0);expect(headless.demoTraffic.collisionCount).toBe(0);expect(headless.demoTraffic.minimumClearanceM).toBeGreaterThanOrEqual(.15-1e-8);
  // Two dense N60 terminal replays compare exact task traces, collision count and body clearance.
  }, 60_000);

  it("fills the supported generated storage floor and places sixty separate real bodies without mutating source inputs",()=>{
    const input=warehouseBaseInput(60),before=structuredClone(input),original=buildWarehouseLayout(input.layout),prepared=prepareWarehouseTraffic(input),site=prepared.siteLayout!;
    expect(input).toEqual(before);expect(site.slots.length).toBeGreaterThan(1800);expect(site.slots.length).toBeLessThanOrEqual(4096);
    expect(site.receiving).toEqual(original.receiving);expect(site.shipping).toEqual(original.shipping);expect(site.chargers).toEqual(original.chargers);
    expect(validateSiteLayout(site)).toEqual([]);expect(validateProjectSiteLayout(site)).toEqual([]);expect(site.routingGraph!.nodes.length).toBeLessThanOrEqual(8192);
    const nodes=new Map(site.routingGraph!.nodes.map(n=>[n.id,n]));for(const e of site.routingGraph!.edges)expect(siteSegmentIsClear(site,nodes.get(e.from)!,nodes.get(e.to)!)).toBe(true);
    expect(new Set(prepared.demoTraffic.initialPositions.map(p=>`${p.x},${p.y}`)).size).toBe(60);
    const a=createPlayback(prepared),b=createPlayback(JSON.parse(JSON.stringify(prepared)));stepPlayback(a,60);stepPlayback(b,60);expect(playbackFrame(a)).toEqual(playbackFrame(b));
  // Validates every dense-graph edge and compares two N60 playbacks; allow shared-runner CPU scheduling.
  }, 30_000);

  it("does not impose the former area-based ten-route heuristic on a sixty-body input",()=>{
    const input=warehouseBaseInput(60),prepared=prepareWarehouseTraffic(input);
    expect(prepared.demoTraffic.maxActiveRoutes).toBe(60);
    const resized=structuredClone(prepared);resized.robots.count=11;expect(prepareWarehouseTraffic(resized).demoTraffic.maxActiveRoutes).toBe(11);
  // Prepares the full dense N60 floor twice; no inventory thinning or smaller fixture is substituted.
  }, 30_000);

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
