import { describe, expect, it } from "vitest";
import { auditPedestrians, beginPedestrians, createPedestrians, pedestrianMotionLimit, pedestrianFrame, relativeMotionDistance, validatePedestrians } from "./pedestrians";
import type { PedestrianInput, SimLayout } from "../../lib/sim/types";
import { warehouseBaseInput } from "../../lib/sim/fixtures";
import { complexSite } from "./site";
import { createWarehouseTrafficState, prepareWarehouseTraffic, stepWarehouseTraffic } from "./traffic";
import { createSpatialProjectSnapshot, parseSpatialProjectSnapshot } from "../../lib/sim/spatial-bridge";
import { calculateProjectPreview } from "./project-input";
import { serialize, deserialize } from "node:v8";
const site:SimLayout={widthM:40,heightM:20,footprint:[{x:0,y:0},{x:40,y:0},{x:40,y:20},{x:0,y:20}],zones:[],receiving:[],shipping:[],chargers:[],slots:[],crossAislesY:[],rackAislesX:[]};
const config=():PedestrianInput=>({version:"pedestrians-1",reactionTimeS:.5,decelerationMps2:.8,accelerationMps2:.8,clearanceM:.25,people:[{id:"person-1",radiusM:.3,trajectory:[{tS:0,x:15,y:3},{tS:5,x:15,y:3},{tS:10,x:15,y:8},{tS:20,x:15,y:8},{tS:25,x:15,y:13},{tS:60,x:15,y:13}]}]});
function run(batches:number[]=[1]){
  const runtime=createPedestrians(config(),site)!;const body={id:0,x:1,y:8,path:[{x:1,y:8},{x:35,y:8}],distM:0};const frames=[];
  for(let n=0;n<40;){for(let j=0;j<batches[n%batches.length]!&&n<40;j++,n++){
    const start={x:body.x,y:body.y};const next=pedestrianMotionLimit(runtime,body,Math.min(34,body.distM+1.5),.9);body.distM=next;body.x=1+next;
    auditPedestrians(runtime,[{id:0,path:[start,{x:body.x,y:body.y}]}],n+1,.9);
    frames.push({tS:n+1,x:body.x,v:runtime.robots[0]!.velocityMps,reason:runtime.robots[0]!.reason,people:pedestrianFrame(runtime,n+1)});
  }}return {runtime,frames};
}
describe("deterministic pedestrians and conservative braking",()=>{
  it("slows, stops before the same moving person, then resumes without violating clearance",()=>{
    const {runtime,frames}=run();
    expect(runtime.collisionCount).toBe(0);expect(runtime.brakingViolations).toBe(0);expect(runtime.minimumClearanceM).toBeGreaterThanOrEqual(.25-1e-8);
    expect(frames.some(f=>f.reason?.includes("Торможение")&&f.v>0&&f.v<1.5)).toBe(true);
    const stopped=frames.findIndex(f=>f.reason?.includes("Ожидание")&&f.v===0);expect(stopped).toBeGreaterThan(0);
    expect(frames.slice(stopped+1).some(f=>f.v===1.5&&f.reason===null)).toBe(true);
    for(let i=1;i<frames.length;i++)expect(frames[i-1]!.v-frames[i]!.v).toBeLessThanOrEqual(.8+1e-8);
  });
  it("preserves exact poses, velocities and reasons across batched replay speeds and rewind",()=>{
    expect(run([1,5,10,50,500])).toEqual(run());expect(run()).toEqual(run());
  });
  it("reports a late physical crossing through a stationary robot as violation, never moves or hides the person",()=>{
    const cfg=config();cfg.people[0]!.trajectory=[{tS:0,x:15,y:7},{tS:1,x:15,y:9}];
    const runtime=createPedestrians(cfg,site)!;
    auditPedestrians(runtime,[{id:0,path:[{x:15,y:8},{x:15,y:8}]}],1,.9);
    expect(runtime.collisionCount).toBeGreaterThan(0);expect(runtime.firstViolation?.personId).toBe("person-1");
    expect(pedestrianFrame(runtime,1)[0]).toMatchObject({x:15,y:9});
  });
  it("uses simultaneous relative motion, rejecting crossing trajectories at the same time",()=>{
    expect(relativeMotionDistance({x:0,y:0},{x:2,y:0},{x:1,y:-1},{x:1,y:1})).toBe(0);
    expect(relativeMotionDistance({x:0,y:0},{x:2,y:0},{x:3,y:-1},{x:3,y:1})).toBeGreaterThan(1);
  });
  it("audits the real fractional curb arrival after a delayed controlled start",()=>{
    const cfg=config();cfg.policy="controlled-crossing";cfg.crossingWidthM=.5;cfg.people[0]!.trajectory=[{tS:0,x:10,y:10},{tS:.8,x:12,y:10}];
    const runtime=createPedestrians(cfg,site)!;runtime.tS=2;beginPedestrians(runtime,[],.9);
    auditPedestrians(runtime,[{id:0,path:[{x:13.4,y:7.45},{x:13.4,y:10.45}]}],3,.9);
    expect(runtime.minimumClearanceM).toBeCloseTo(.2,12);expect(runtime.collisionCount).toBe(1);
    expect(pedestrianFrame(runtime,2.4)[0]).toMatchObject({x:11,y:10,phase:"crossing",actualStartS:2});
    expect(pedestrianFrame(runtime,2.9)[0]).toMatchObject({x:12,y:10,phase:"at-curb"});
  });
  it("audits a grounded carrier even when assigned to a distant robot, without double counting attached stock",()=>{
    const cfg=config();cfg.people[0]!.trajectory=[{tS:0,x:13,y:8},{tS:2,x:17,y:8}];
    const pod={id:"pod-test",x:15,y:8,heading:0,phase:"parked",robotId:7,spec:{lengthM:1.4,widthM:1}};
    const runtime=createPedestrians(cfg,site)!;
    auditPedestrians(runtime,[{id:7,path:[{x:1,y:1},{x:1,y:1}]}],1,.9,[pod]);
    expect(runtime.collisionCount).toBe(1);expect(runtime.firstViolation).toMatchObject({x:15,y:8,personId:"person-1"});
    const attached=createPedestrians(cfg,site)!;auditPedestrians(attached,[{id:7,path:[{x:15,y:8},{x:15,y:8}]}],1,.9,[{...pod,phase:"carrying"}]);
    expect(attached.collisionCount).toBe(1);
  });
  it("rejects tampered fields, clocks, units, obstacle paths and unbounded speed",()=>{
    for(const mutate of [
      (c:PedestrianInput&{runtime?:unknown})=>{c.runtime={safe:true};},
      (c:PedestrianInput)=>{c.decelerationMps2=0;},
      (c:PedestrianInput)=>{c.people[0]!.trajectory[1]!.tS=0;},
      (c:PedestrianInput)=>{c.people[0]!.trajectory[1]!.x=Number.NaN;},
      (c:PedestrianInput)=>{c.people[0]!.trajectory[1]!.x=39;},
    ]){const cfg=config();mutate(cfg);expect(()=>validatePedestrians(cfg,site)).toThrow();}
    const blocked={...site,walls:[{x:14,y:5,w:2,h:5}]};expect(()=>createPedestrians(config(),blocked)).toThrow();
    expect(createPedestrians(undefined,site)).toBeUndefined();
  });
  it("holds a requested pedestrian visibly at the curb until a blocked existing robot really exits",()=>{
    const cfg=config();cfg.policy="controlled-crossing";cfg.crossingWidthM=2;cfg.people[0]!.trajectory=[{tS:0,x:15,y:3},{tS:1,x:15,y:13}];
    // Keep walking speed valid, request at 0 with a ten-second traversal.
    cfg.people[0]!.trajectory[1]!.tS=10;
    const runtime=createPedestrians(cfg,site)!;const b={id:0,x:15,y:8,path:[{x:15,y:8},{x:25,y:8}],distM:0};
    for(let t=0;t<4;t++){beginPedestrians(runtime,[b],.9);auditPedestrians(runtime,[{id:0,path:[{x:b.x,y:b.y},{x:b.x,y:b.y}]}],t+1,.9);}
    expect(pedestrianFrame(runtime,4)[0]).toMatchObject({phase:"requesting",x:15,y:3,waitS:4});
    b.x=25;b.distM=10;beginPedestrians(runtime,[b],.9);
    expect(pedestrianFrame(runtime,4)[0]).toMatchObject({phase:"crossing",actualStartS:4});
    for(let t=4;t<14;t++)auditPedestrians(runtime,[{id:0,path:[{x:25,y:8},{x:25,y:8}]}],t+1,.9);
    expect(runtime.controlled["person-1"]!.history).toEqual([{desiredStartS:0,actualStartS:4,completedAtS:14,waitS:4}]);
    expect(runtime.collisionCount).toBe(0);
  });
  it("roundtrips the canonical person input through the real project factory and replays a serialized traffic checkpoint exactly",()=>{
    const input=warehouseBaseInput(2,{transportWorkflow:"closed-pod-1"});input.siteLayout=complexSite(10000,2,true);
    input.layout={...input.layout,activeAreaM2:10000,receivingDocksCount:2,shippingDocksCount:2,chargers:2};
    input.demand={...input.demand,warmupMin:0,peakMin:2,avgPerH:60,peakPerH:60};input.pedestrians=config();
    const snap=createSpatialProjectSnapshot({requestId:"person-source",scenarioKey:"p",scenarioName:"Пешеход",variantId:"calculated",input});
    expect(parseSpatialProjectSnapshot(JSON.parse(JSON.stringify(snap))).input.pedestrians).toEqual(input.pedestrians);
    const prepared=calculateProjectPreview(snap);expect(prepared.input.pedestrians).toEqual(input.pedestrians);
    const state=createWarehouseTrafficState(prepareWarehouseTraffic(input));state.demoIncidents!.config.enabled=false;
    for(let t=0;t<20;t++)stepWarehouseTraffic(state);
    const checkpoint=deserialize(serialize(state)) as typeof state;
    for(let t=0;t<30;t++){stepWarehouseTraffic(state);stepWarehouseTraffic(checkpoint);}
    expect(checkpoint).toEqual(state);
    const bad=JSON.parse(JSON.stringify(snap));bad.input.pedestrians.runtime={safe:true};expect(()=>parseSpatialProjectSnapshot(bad)).toThrow();
  });
});
