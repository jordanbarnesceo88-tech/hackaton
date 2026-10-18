import { describe, expect, it } from "vitest";
import type { SimLayout } from "../../lib/sim/types";
import type { SimTask } from "../../lib/sim/state";
import { simInputIdentity } from "../../lib/sim/identity";
import { siteSegmentIsClear } from "../../lib/sim/site-layout";
import { summarize } from "../../lib/sim/metrics";
import { carrierPose, carrierSpec, createPlayback, playbackFrame, previewInterpolate, stepPlayback } from "./core";
import { MOBILE_RACK_SPEC, POD_SPACING_M, stationaryPods, underliftHandling, syncUnderlift, prepareUnderliftRoute, prepareUnderliftLayout } from "./carriers";
import { prepareWarehouseTraffic, type WarehouseTrafficState } from "./traffic";
import { nearestStockGap, stockSweepIsClear, orientedBounds, rectangleGap } from "./pod-collision";
import { complexSite } from "./site";

function fixture(dense=false) {
  const site=complexSite(10000,1,dense);
  const input=prepareWarehouseTraffic({seed:1,siteLayout:site,layout:{activeAreaM2:10000,mainAisleWidthM:3.5,rackAisleWidthM:2.8,receivingDocksCount:2,shippingDocksCount:2,chargers:1},robots:{count:1,speedMps:1.5,loadedSpeedFactor:0.8,handlingSec:12,autonomyH:null,chargeMin:null,payloadKg:1500},loadMassKg:800,demand:{avgPerH:0,peakPerH:0,warmupMin:0,peakMin:20},thresholds:{servedShareMin:0.97,p95WaitMaxMin:10,oversizedIdleShare:0.4},charge:{startSoc:0.2,stopSoc:0.9}});
  input.demoIncidents!.enabled=false;input.demoIncidents!.schedule=[];
  const state=createPlayback(input) as WarehouseTrafficState;
  const home=state.layout.slots[0]!,shipping=state.layout.shipping[0]!,receiving=state.layout.receiving[0]!;
  const task=(id:number,kind:"inbound"|"outbound",from:{x:number;y:number},to:{x:number;y:number},fromPoint:number,toPoint:number):SimTask=>({id,kind,fromX:from.x,fromY:from.y,toX:to.x,toY:to.y,fromPoint,toPoint,arrivalS:0,startS:null,doneS:null});
  state.tasks.push(task(0,"outbound",home,shipping,-1,2),task(1,"inbound",receiving,home,0,-1));
  state.nextDemandTaskId=2;state.acc.bucketArrivals[0]=2;
  return {input,state};
}

describe("physical under-shelf closed carrier pool",()=>{
  it("locks the geometry to a pod the robot can enter and contact",()=>{
    expect(carrierSpec()).toMatchObject({lengthM:1.4,widthM:1,heightM:2.2,baseClearanceM:0.44,liftHeightM:0.06,levels:5,rateUnit:"пал./ч"});
    for(const invalid of [{lengthM:0.5,widthM:0.5,heightM:0.45},{baseClearanceM:0.3},{liftHeightM:0},{levels:4},{lengthM:NaN}])expect(()=>carrierSpec({loadCarrier:{...MOBILE_RACK_SPEC,...invalid}})).toThrow("габариты носителя");
    const pose=carrierPose({phase:"idle",loaded:false},carrierSpec());
    expect(pose).toMatchObject({visible:false,podLiftM:0,platformTopM:0.38,platformLiftM:0,contact:false});
  });

  it("infers customer dock orientation from its geometry independently of node names",()=>{
    const plan:SimLayout={widthM:50,heightM:40,footprint:[{x:0,y:0},{x:50,y:0},{x:50,y:40},{x:0,y:40}],zones:[],crossAislesY:[18],rackAislesX:[10,11.2],receiving:[],shipping:[],chargers:[],slots:[{x:10,y:20},{x:11.2,y:20}],routingGraph:{clearanceM:.95,nodes:[{id:"h0",x:10,y:20},{id:"h1",x:11.2,y:20},{id:"e0",x:10,y:18},{id:"e1",x:11.2,y:18}],edges:[{from:"h0",to:"e0"},{from:"h1",to:"e1"},{from:"e0",to:"e1"}]}};
    const source=structuredClone(plan),ordinary=prepareUnderliftLayout(plan);expect(ordinary.docks.every(d=>d.heading===Math.PI/2)).toBe(true);expect(plan).toEqual(source);
    const named=structuredClone(source);named.routingGraph!.nodes.forEach(n=>n.id=n.id.replace("h","pod-home-").replace("e","pod-entry-"));named.routingGraph!.edges.forEach(e=>{e.from=e.from.replace("h","pod-home-").replace("e","pod-entry-");e.to=e.to.replace("h","pod-home-").replace("e","pod-entry-");});
    expect(prepareUnderliftLayout(named)).toEqual(ordinary);
    const narrow=structuredClone(source);narrow.slots[1]!.x=11.1;narrow.routingGraph!.nodes.filter(n=>n.id.endsWith("1")).forEach(n=>n.x=11.1);expect(()=>prepareUnderliftLayout(narrow)).toThrow();
  });

  it("drives under, closes the gap, lifts, carries, lowers, retracts and exits before completing",()=>{
    const {state}=fixture(),ids=state.demoUnderlift!.pods.map(p=>p.id),seen=new Set<string>();
    let groundedContact=false,exitMoves=false,completedExternal=false;
    const previousPositions=new Map<string,{x:number;y:number}>();
    while(state.tS<state.endS) {
      const beforeTask=state.robots[0]!.task,beforePos={x:state.robots[0]!.x,y:state.robots[0]!.y};
      stepPlayback(state);
      const frame=playbackFrame(state),r=state.robots[0]!,u=r.underlift;
      expect(frame.carriers.map(p=>p.id)).toEqual(ids);
      for(const pod of frame.carriers) {
        expect(pod.visible).toBe(true);expect(pod.liftM).toBeGreaterThanOrEqual(0);expect(pod.liftM).toBeLessThanOrEqual(0.06);
        expect(siteSegmentIsClear(state.layout,pod,pod)).toBe(true);
        const previous=previousPositions.get(pod.id);if(previous&&pod.robotId===null)expect([pod.x,pod.y]).toEqual([previous.x,previous.y]);
        previousPositions.set(pod.id,{x:pod.x,y:pod.y});
      }
      if(u) {
        seen.add(u.stage);const pod=frame.carriers.find(p=>p.id===u.podId)!;
        expect(u.platformTopM).toBeLessThanOrEqual(pod.spec.baseClearanceM+pod.liftM+1e-8);
        expect(u.contactGapM).toBeCloseTo(pod.spec.baseClearanceM+pod.liftM-u.platformTopM,8);
        if(u.podLiftM>1e-8){expect(u.contact).toBe(true);expect(u.platformTopM).toBeCloseTo(0.44+u.podLiftM,8);}
        if(u.stage==="close-gap"){expect(pod.liftM).toBe(0);if(u.contact)groundedContact=true;}
        if(u.stage==="carry"){expect(pod.liftM).toBeCloseTo(0.06);expect([pod.x,pod.y]).toEqual([r.x,r.y]);}
        if(u.stage==="exit"){
          expect(u.platformTopM).toBe(0.38);expect(pod.liftM).toBe(0);expect(u.contact).toBe(false);
          expect(frame.robots[0]!.loaded).toBe(false);
          expect(frame.robots[0]!.remainingDistM).toBeCloseTo(r.pathLenM-r.distM,8);
          expect(frame.robots[0]!.target).toEqual(r.path.at(-1));
          if(r.distM<r.pathLenM) expect(frame.robots[0]!.remainingPath.length).toBeGreaterThan(1);
          if(Math.hypot(r.x-beforePos.x,r.y-beforePos.y)>0)exitMoves=true;
        }
      }
      for(const pod of stationaryPods(state,r.id))expect(Math.hypot(r.x-pod.x,r.y-pod.y),JSON.stringify({tS:state.tS,phase:r.phase,u,task:r.task,pod})).toBeGreaterThanOrEqual(POD_SPACING_M-1e-8);
      if(beforeTask&&beforeTask.doneS!==null){
        expect(Math.hypot(r.x-beforeTask.toX,r.y-beforeTask.toY)).toBeCloseTo(2,8);
        expect(r.underlift).toBeUndefined();
        if(beforeTask.countsTowardDemand!==false)completedExternal=true;
      }
    }
    expect([...seen]).toEqual(expect.arrayContaining(["approach","dock-under","close-gap","lift","extract","carry","lower","retract","exit"]));
    expect(groundedContact).toBe(true);expect(exitMoves).toBe(true);expect(completedExternal).toBe(true);
    expect(state.doneCount).toBe(2);expect(state.physicalDoneCount).toBe(4);
    expect(state.tasks.filter(t=>t.countsTowardDemand!==false).map(t=>t.id)).toEqual([0,1]);
    expect(state.tasks.filter(t=>t.countsTowardDemand===false).map(t=>t.operation).sort()).toEqual(["prefetch-pod","return-pod"]);
    for(const pod of state.demoUnderlift!.pods){expect([pod.x,pod.y,pod.liftM]).toEqual([pod.home.x,pod.home.y,0]);expect(pod.robotId).toBeNull();}
    expect(state.demoTraffic.collisionCount).toBe(0);expect(state.demoTraffic.minimumClearanceM).toBeGreaterThanOrEqual(0.15-1e-8);
    expect(summarize(state)).toMatchObject({arrivedPeak:2,donePeak:2});
  });

  it("extracts a loaded pod straight out of compact rows before turning and returns the permanent pod",()=>{
    const {state}=fixture(true),ids=state.demoUnderlift!.pods.map(p=>p.id),seen=new Set<string>();
    expect(ids.length).toBeGreaterThan(700);
    let extractionSteps=0;
    while(state.tS<state.endS) {
      const r=state.robots[0]!,before={x:r.x,y:r.y,stage:r.underlift?.stage};stepPlayback(state);
      const u=r.underlift;if(u){seen.add(u.stage);const pod=state.demoUnderlift!.pods.find(p=>p.id===u.podId)!;
        if(u.stage==="extract") {
          extractionSteps++;expect(u.entryOffsetM).toBe(2);expect(u.podLiftM).toBeCloseTo(.06);
          expect([pod.x,pod.y]).toEqual([r.x,r.y]);expect(pod.heading).toBe(u.headingRad);
          const dock=state.demoUnderlift!.docks.find(d=>Math.hypot(d.x-r.task!.fromX,d.y-r.task!.fromY)<1e-8)!;
          expect(u.headingRad).toBe(dock.heading);expect(Math.abs(r.x-dock.x)*Math.abs(r.y-dock.y)).toBeLessThan(1e-8);
        }
        if(before.stage==="extract"&&u.stage==="carry")expect(r.distM).toBeCloseTo(u.extractionUntilM!,8);
        if(u.stage==="carry"&&r.pathLenM-r.distM<=2+1e-8)for(const alpha of [.5,.9]){
          const preview=previewInterpolate(state,alpha),moving=preview.carriers.find(p=>p.id===u.podId)!;
          for(const parked of preview.carriers.filter(p=>p.id!==moving.id&&p.phase!=="carrying"))expect(rectangleGap(orientedBounds(moving,1.4,1,moving.heading),orientedBounds(parked,1.4,1,parked.heading))).toBeGreaterThanOrEqual(.15-1e-8);
        }
      }
      const gap=nearestStockGap(state,r);if(gap)expect(gap.gapM,JSON.stringify({t:state.tS,r,gap})).toBeGreaterThanOrEqual(.15-1e-8);
      expect(Math.hypot(r.x-before.x,r.y-before.y)).toBeLessThanOrEqual(1.5+1e-8);
    }
    expect(extractionSteps).toBeGreaterThan(0);expect([...seen]).toContain("extract");expect(state.doneCount).toBe(2);expect(state.physicalDoneCount).toBe(4);
    expect(state.demoUnderlift!.pods.map(p=>p.id)).toEqual(ids);expect(state.demoUnderlift!.pods.every(p=>p.x===p.home.x&&p.y===p.home.y&&p.liftM===0)).toBe(true);
    expect(state.demoTraffic.collisionCount).toBe(0);
  });

  it("does not restart extraction after a later blocked transit replan",()=>{
    const {state}=fixture(true),r=state.robots[0]!;
    while(state.tS<state.endS&&r.underlift?.stage!=="extract")stepPlayback(state);
    expect(stockSweepIsClear(state,r,[{x:r.x,y:r.y},{x:r.x,y:r.y+.01}])).toBe(false);
    while(state.tS<state.endS&&r.underlift?.stage!=="carry")stepPlayback(state);
    expect(r.underlift?.stage).toBe("carry");const point={x:r.x,y:r.y};r.underlift!.routeStage=undefined;
    expect(prepareUnderliftRoute(state,r,()=>null)).toBe(false);syncUnderlift(state,new Map());
    expect(r.underlift!.stage).toBe("carry");expect([r.x,r.y]).toEqual([point.x,point.y]);
  });

  it("freezes blocked exit without moving the pod or finishing the request",()=>{
    const {state}=fixture();
    while(state.tS<state.endS&&state.robots[0]!.underlift?.stage!=="exit")stepPlayback(state);
    const r=state.robots[0]!,task=r.task!,timer=r.timerS,pos={x:r.x,y:r.y},pod=state.demoUnderlift!.pods.find(p=>p.id===r.underlift!.podId)!;
    r.distM=0;r.x=task.toX;r.y=task.toY;
    const physicalPos={x:r.x,y:r.y};
    expect(underliftHandling(state,r,1,()=>false)).toBe(false);
    expect([r.x,r.y,r.timerS]).toEqual([physicalPos.x,physicalPos.y,timer]);
    expect(task.doneS).toBeNull();expect(pod.liftM).toBe(0);expect(r.underlift!.platformTopM).toBe(0.38);
    expect(pos).toBeDefined();
  });

  it("returns an empty shelf after shipping and refills it only during receiving service", () => {
    const { state } = fixture();
    const pod = state.demoUnderlift!.pods[0]!;
    expect(pod).toMatchObject({ contents: "full", inventoryNotModelled: true });
    let outboundExit = false, emptyReturn = false, emptyAtHome = false, emptyPrefetch = false, receivingService = false, fullInbound = false;
    while (state.tS < state.endS) {
      const robot = state.robots[0]!, previousTask = robot.task;
      stepPlayback(state);
      const frame = playbackFrame(state), current = frame.robots[0]!;
      expect(frame.inventory.goodsInventoryModelled).toBe(false);
      expect(frame.carriers[0]!.contents).toBe(pod.contents);
      if (current.task) {
        expect(current.carrierContents).toBe(pod.contents);
        expect(current.podPose!.contents).toBe(pod.contents);
      }
      if (current.path.length) {
        expect(current.path).not.toBe(robot.path);
        expect(current.path[0]).not.toBe(robot.path[0]);
      }
      if (robot.task?.id === 0 && robot.underlift?.stage === "exit") {
        outboundExit = true;
        expect(pod.contents).toBe("empty"); expect(pod.liftM).toBe(0);
      }
      if (robot.task?.operation === "return-pod") {
        expect(pod.contents).toBe("empty");
        if (current.loaded) { emptyReturn = true; expect(current.carrierContents).toBe("empty"); }
      }
      if (previousTask?.operation === "return-pod" && previousTask.doneS !== null) {
        emptyAtHome = true;
        expect([pod.x, pod.y, pod.contents]).toEqual([pod.home.x, pod.home.y, "empty"]);
      }
      if (robot.task?.operation === "prefetch-pod") { emptyPrefetch = true; expect(pod.contents).toBe("empty"); }
      if (robot.task?.id === 1 && robot.phase === "loading") { receivingService = true; expect(pod.contents).toBe("empty"); }
      if (robot.task?.id === 1 && robot.phase === "toDrop") { fullInbound = true; expect(pod.contents).toBe("full"); }
    }
    expect([outboundExit, emptyReturn, emptyAtHome, emptyPrefetch, receivingService, fullInbound]).toEqual([true, true, true, true, true, true]);
    expect(pod.contents).toBe("full");
  });

  it("never invents cargo for repeated outbound requests or changes dispatch for content availability", () => {
    const make = () => {
      const { state } = fixture();
      state.tasks[1] = { ...state.tasks[0]!, id: 1 };
      return state;
    };
    const full = make(), empty = make();
    empty.demoUnderlift!.pods[0]!.contents = "empty";
    let repeatedAssigned = false, fullPrefetchObserved = false;
    while (full.tS < full.endS) {
      stepPlayback(full); stepPlayback(empty);
      if (full.robots[0]!.task?.id === 1) {
        repeatedAssigned = true;
        expect(full.demoUnderlift!.pods[0]!.contents).toBe("empty");
        expect(full.robots[0]!.task!.contentsAvailabilityUnverified).toBe(true);
        expect(playbackFrame(full).robots[0]!.task!.contentsAvailabilityUnverified).toBe(true);
      }
    }
    expect(repeatedAssigned).toBe(true);
    expect(full.demoUnderlift!.pods[0]!.contents).toBe("empty");
    expect(full.doneCount).toBe(2); expect(full.physicalDoneCount).toBe(4);
    expect(summarize(full)).toEqual(summarize(empty));
    expect(full.rng).toEqual(empty.rng);

    const inbound = fixture().state;
    inbound.tasks.splice(0, 1);
    while (inbound.tS < inbound.endS && !fullPrefetchObserved) {
      stepPlayback(inbound);
      if (inbound.robots[0]!.task?.operation === "prefetch-pod") {
        fullPrefetchObserved = true;
        expect(inbound.demoUnderlift!.pods[0]!.contents).toBe("full");
        expect(inbound.robots[0]!.task!.contentsAvailabilityUnverified).toBe(true);
      }
    }
    expect(fullPrefetchObserved).toBe(true);
  });

  it("is idempotently prepared and exactly replayable, including internal IDs and carrier poses",()=>{
    const a=fixture(),b=fixture();
    expect(prepareWarehouseTraffic(a.input)).toEqual(a.input);
    const inputKey=simInputIdentity(a.input);
    for(let i=0;i<425;i++)stepPlayback(a.state);
    for(let i=0;i<25;i++)stepPlayback(b.state,17);
    expect(a.state).toEqual(b.state);expect(playbackFrame(a.state)).toEqual(playbackFrame(b.state));
    const before=JSON.stringify(a.state),preview=previewInterpolate(a.state,0.5);
    expect(JSON.stringify(a.state)).toBe(before);expect(simInputIdentity(a.state.input)).toBe(inputKey);
    for(const pod of preview.carriers.filter(p=>p.phase==="carrying")){
      const robot=preview.robots.find(r=>r.id===pod.robotId)!;expect([pod.x,pod.y]).toEqual([robot.x,robot.y]);expect(robot.podPose).toMatchObject({x:pod.x,y:pod.y,contents:pod.contents});
    }
  });
});
