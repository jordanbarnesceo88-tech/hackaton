import type { SimEngineState, SimRobot, SimTask } from "../../lib/sim/state";
import type { SimInput } from "../../lib/sim/types";
import { validateUnderliftConfig, type Dock, type UnderliftConfig } from "../../lib/sim/underlift-layout";
import { underliftHandlingBudgetS } from "../../lib/sim/underlift-timing";
export { prepareUnderliftLayout, validateUnderliftConfig } from "../../lib/sim/underlift-layout";
export type { Dock, UnderliftConfig } from "../../lib/sim/underlift-layout";
import { orientedBounds, podBounds, rectangleGap, cardinalHeading, ROBOT_LENGTH_M, ROBOT_WIDTH_M } from "./pod-collision";
import { route, routeLengthM, positionAlong } from "../../lib/sim/routing";

export const POD_RADIUS_M = 0.9;
export const POD_SPACING_M = 1.95;
export const PLATFORM_REST_M = 0.38;
export type CarrierContents = "full" | "empty";
export type CarrierSpec = { kind: "pallet" | "mobile-rack"; lengthM: number; widthM: number; heightM: number; baseClearanceM: number; liftHeightM: number; levels: number; label: string; rateUnit: string; sourceNote: string };
export const MOBILE_RACK_SPEC: CarrierSpec = {
  kind: "mobile-rack", lengthM: 1.4, widthM: 1, heightM: 2.2, baseClearanceM: 0.44, liftHeightM: 0.06, levels: 5, label: "Мобильный стеллаж", rateUnit: "пал./ч",
  sourceNote: "Пять ярусов и подстеллажный подхват — по референсу. Габариты 1,4 × 1,0 × 2,2 м, основание 0,44 м, платформа 0,38 м и подъём 0,06 м — проектные допущения. Постоянный парк стеллажей возвращается на свои места: перед приёмкой выполняется подача, после отгрузки — возврат. Дополнительные рейсы участвуют в физике и загрузке, но не считаются новыми паллетными заказами. Начальное заполнение принято полным; после отгрузки стеллаж пуст, при приёмке заполняется в ходе обслуживания. Наличие товара для следующего заказа и складское пополнение не моделируются: состояние содержимого не подтверждает товарный запас. Учёт исходного потока и экономики остаётся в паллетах, без пересчёта в стеллажи/ч.",
};
export type CarrierInput = SimInput & { loadCarrier?: CarrierSpec; demoUnderlift?: UnderliftConfig };
export type RackCarrier = { id: string; home: { x: number; y: number }; taskId: number | null; robotId: number | null; reservedForTaskId: number | null; spec: CarrierSpec; contents: CarrierContents; inventoryNotModelled: true; x: number; y: number; heading: number; phase: "parked" | "pickup" | "loading" | "carrying" | "unloading" | "delivered"; liftM: number; visible: boolean };
export type UnderliftState = SimEngineState & { demoUnderlift?: { pods: RackCarrier[]; docks: Dock[]; nextInternalId: number; podIndex: Record<string,number>; homeIndex: Record<string,number>; revision:number; stockRevision:number; cacheAtS:number; cacheRevision:number; feasibility:Record<number,boolean> } };
const same = (a: {x:number;y:number}, b: {x:number;y:number}) => Math.hypot(a.x-b.x,a.y-b.y) < 1e-7;
const pointKey=(p:{x:number;y:number})=>`${p.x};${p.y}`;
const clamp = (v: number) => Math.max(0,Math.min(1,v));
export function carrierSpec(input?: Partial<CarrierInput> | null): CarrierSpec {
  const spec = input?.loadCarrier?.kind === "pallet" ? MOBILE_RACK_SPEC : input?.loadCarrier ?? MOBILE_RACK_SPEC;
  if (["lengthM", "widthM", "heightM", "baseClearanceM", "liftHeightM", "levels"].some(key => spec[key as keyof CarrierSpec] !== MOBILE_RACK_SPEC[key as keyof CarrierSpec])) throw new Error("Недопустимые габариты носителя: подстеллажный механизм поддерживает только согласованный стеллаж 1,4 × 1,0 × 2,2 м с пятью ярусами");
  if (spec.kind !== "mobile-rack" || ![spec.lengthM,spec.widthM,spec.heightM].every(v=>Number.isFinite(v)&&v>0) || ![spec.baseClearanceM,spec.liftHeightM].every(v=>Number.isFinite(v)&&v>=0) || spec.baseClearanceM < PLATFORM_REST_M || spec.baseClearanceM >= spec.heightM || Math.hypot(spec.lengthM,spec.widthM)/2 > POD_RADIUS_M || !Number.isInteger(spec.levels) || spec.levels<1 || spec.levels>8 || ![spec.label,spec.rateUnit,spec.sourceNote].every(v=>typeof v==="string"&&v.length>0)) throw new Error("Недопустимые габариты носителя: нужен подстеллажный просвет и защитный диск не меньше габарита 0,90 м");
  return {...spec};
}
export function carrierPose(robot: {phase:string;loaded:boolean;underlift?:SimRobot["underlift"]}, spec: CarrierSpec) {
  const u=robot.underlift, podLiftM=u?.podLiftM??0, platformTopM=u?.platformTopM??PLATFORM_REST_M;
  return { visible: Boolean(u && u.stage!=="approach" && (u.stage!=="retreat" || podLiftM>0)), liftM:podLiftM,podLiftM,platformTopM,platformLiftM:platformTopM-PLATFORM_REST_M,contactGapM:u?.contactGapM??spec.baseClearanceM-platformTopM,contact:u?.contact??false,underliftPhase:u?.stage??"approach" };
}

export function initUnderlift(state: UnderliftState, config: UnderliftConfig): void {
  validateUnderliftConfig(state.layout,config);
  const spec=carrierSpec(state.input), pods=state.layout.slots.map((home,i)=>{const dock=config.docks.find(d=>same(d,home))!;return {id:`pod-home-${i+1}`,home:{...home},taskId:null,robotId:null,reservedForTaskId:null,spec:{...spec},contents:"full" as const,inventoryNotModelled:true as const,...home,heading:dock.heading,phase:"parked" as const,liftM:0,visible:true};});
  if(pods.some(p=>state.robots.some(r=>rectangleGap(orientedBounds(p,1.4,1,p.heading),orientedBounds(r,ROBOT_LENGTH_M,ROBOT_WIDTH_M,0))<.15-1e-8)))throw new Error("Парковка робота пересекает место постоянного стеллажа");
  state.demoUnderlift={pods,docks:structuredClone(config.docks),nextInternalId:-1,podIndex:Object.fromEntries(pods.map((p,i)=>[p.id,i])),homeIndex:Object.fromEntries(pods.map((p,i)=>[pointKey(p.home),i])),revision:0,stockRevision:0,cacheAtS:-1,cacheRevision:-1,feasibility:{}}; state.nextDemandTaskId=0;state.physicalDoneCount=0;
}
const dockIndexes = new WeakMap<Dock[], Map<string, Dock>>();
export function dockOf(state: UnderliftState, point: { x: number; y: number }, toleranceM = 1e-7): Dock {
  const docks = state.demoUnderlift!.docks;
  let index = dockIndexes.get(docks);
  if (!index) { index = new Map(docks.map(dock => [pointKey(dock), dock])); dockIndexes.set(docks, index); }
  const dock = index.get(pointKey(point)) ?? docks.find(candidate => Math.hypot(candidate.x - point.x, candidate.y - point.y) < toleranceM);
  if (!dock) throw new Error("Для точки отсутствует безопасный подстеллажный заезд");
  return dock;
}
function podOf(state:UnderliftState,task:SimTask) {const runtime=state.demoUnderlift;return runtime&&task.podId?runtime.pods[runtime.podIndex[task.podId]!]:undefined;}
function internalTask(state:UnderliftState,pod:RackCarrier,parent:SimTask,operation:"prefetch-pod"|"return-pod") {
  const prefetch=operation==="prefetch-pod",to=prefetch?{x:parent.fromX,y:parent.fromY}:pod.home;
  const task:SimTask={id:state.demoUnderlift!.nextInternalId--,kind:parent.kind,operation,countsTowardDemand:false,parentTaskId:parent.id,podId:pod.id,fromPoint:prefetch?-1:parent.toPoint,fromX:pod.x,fromY:pod.y,toPoint:prefetch?parent.fromPoint:-1,toX:to.x,toY:to.y,arrivalS:state.tS,startS:null,doneS:null};
  state.tasks.push(task);return task;
}
export function underliftCanAssign(state:UnderliftState,robot:SimRobot,task:SimTask|null):boolean {
  if(!state.demoUnderlift||!task)return true;
  const runtime=state.demoUnderlift;
  if(runtime.cacheAtS!==state.tS||runtime.cacheRevision!==runtime.revision){runtime.cacheAtS=state.tS;runtime.cacheRevision=runtime.revision;runtime.feasibility={};}
  if(Object.hasOwn(runtime.feasibility,task.id))return runtime.feasibility[task.id]!;
  const result=evaluateUnderliftAssignment(state,robot,task);
  runtime.feasibility[task.id]=result;return result;
}
function evaluateUnderliftAssignment(state:UnderliftState,robot:SimRobot,task:SimTask):boolean {
  const runtime=state.demoUnderlift!;
  let pod=podOf(state,task);
  if(task.countsTowardDemand!==false) {
    const home=task.kind==="inbound"?{x:task.toX,y:task.toY}:{x:task.fromX,y:task.fromY};
    pod=runtime.pods[runtime.homeIndex[pointKey(home)]!]; if(!pod||pod.robotId!==null||(pod.reservedForTaskId!==null&&pod.reservedForTaskId!==task.id))return false;
    task.operation="transport";task.countsTowardDemand=true;
    if(task.kind==="inbound"&&same(pod,pod.home)&&pod.reservedForTaskId===null) {pod.reservedForTaskId=task.id;task.podId=pod.id;internalTask(state,pod,task,"prefetch-pod");runtime.revision++;return false;}
    if(task.kind==="inbound"&&!same(pod,{x:task.fromX,y:task.fromY}))return false;
    if(task.kind==="outbound"&&!same(pod,pod.home))return false;
  }
  if(!pod||pod.robotId!==null||!same(pod,{x:task.fromX,y:task.fromY}))return false;
  const destination=dockOf(state,{x:task.toX,y:task.toY}),targetBox=orientedBounds(destination,1.4,1,destination.heading);
  if(runtime.pods.some(p=>p.id!==pod!.id&&Math.abs(p.x-destination.x)<=POD_SPACING_M&&Math.abs(p.y-destination.y)<=POD_SPACING_M&&rectangleGap(podBounds(p),targetBox)<.15-1e-8))return false;
  if(state.robots.some(r=>r.id!==robot.id&&r.task&&Math.hypot(r.task.toX-task.toX,r.task.toY-task.toY)<POD_SPACING_M))return false;
  return true;
}
export function assignUnderlift(state:UnderliftState,robot:SimRobot,task:SimTask|null):void {
  if(!state.demoUnderlift)return;
  if(!task){robot.underlift=undefined;return;}
  const home=task.kind==="inbound"?{x:task.toX,y:task.toY}:{x:task.fromX,y:task.fromY};
  const pod=podOf(state,task)??state.demoUnderlift.pods[state.demoUnderlift.homeIndex[pointKey(home)]!];if(!pod)throw new Error("Назначение без физического стеллажа");
  // Goods availability is diagnostic only; the existing demand/dispatch model is unchanged.
  task.contentsAvailabilityUnverified = task.operation === "prefetch-pod" && pod.contents === "full" || task.countsTowardDemand !== false && task.kind === "outbound" && pod.contents === "empty";
  state.demoUnderlift.revision++;
  task.podId=pod.id;pod.reservedForTaskId=task.parentTaskId??task.id;pod.robotId=robot.id;pod.taskId=task.id;pod.phase="pickup";
  robot.underlift={podId:pod.id,stage:"approach",progress:0,platformTopM:PLATFORM_REST_M,podLiftM:0,contactGapM:pod.spec.baseClearanceM-PLATFORM_REST_M,contact:false,headingRad:pod.heading,entryOffsetM:2};
}
export function prepareUnderliftRoute(state:UnderliftState,robot:SimRobot,planner:(from:{x:number;y:number},entry:{x:number;y:number},pickup:boolean)=>{x:number;y:number}[]|null):boolean {
  const u=robot.underlift,task=robot.task;if(!state.demoUnderlift||!u||!task)return true;
  const pickup=robot.phase==="toPickup",drop=robot.phase==="toDrop";if(!pickup&&!drop)return true;
  const stage=pickup?"pickup":"drop";if(u.routeStage===stage)return true;
  const point=pickup?{x:task.fromX,y:task.fromY}:{x:task.toX,y:task.toY},dock=dockOf(state,point),source=dockOf(state,{x:task.fromX,y:task.fromY});
  const extracting=drop&&(u.stage==="lift"||u.stage==="extract"),from=extracting?source.entry:robot;
  const prefix=planner(from,dock.entry,pickup)??(extracting?route(state.layout,from,dock.entry):null);if(!prefix)return false;
  const exit=extracting?[{x:robot.x,y:robot.y},{...source.entry}]:[];
  robot.path=[...exit,...prefix.slice(exit.length?1:0),{x:point.x,y:point.y}];robot.pathLenM=routeLengthM(robot.path);robot.distM=0;u.routeStage=stage;
  if(extracting){u.stage="extract";u.headingRad=source.heading;u.extractionUntilM=routeLengthM(exit);u.entryOffsetM=2;}
  return true;
}
export function stationaryPods(state:UnderliftState,robotId:number) {
  const robot=state.robots.find(r=>r.id===robotId);
  const underOwn=robot&&(["loading","unloading"].includes(robot.phase)||(robot.phase==="toPickup"||robot.phase==="waitPoint"&&!robot.loaded)&&robot.underlift?.routeStage==="pickup"&&robot.pathLenM-robot.distM<=2+1e-8);
  return (state.demoUnderlift?.pods??[]).map((p,i)=>({p,i})).filter(({p})=>p.phase!=="carrying"&&!(p.robotId===robotId&&underOwn)).map(({p,i})=>({id:-1000000-i,x:p.x,y:p.y}));
}
function heading(robot:SimRobot,fallback:number) {let walked=0;for(let i=1;i<robot.path.length;i++){const a=robot.path[i-1]!,b=robot.path[i]!;walked+=Math.abs(b.x-a.x)+Math.abs(b.y-a.y);if(walked>=robot.distM-1e-8&&!same(a,b))return cardinalHeading(a,b,fallback);}return fallback;}
export function syncUnderlift(state:UnderliftState,before:Map<number,SimTask>):void {
  if(!state.demoUnderlift)return;
  state.demoUnderlift.revision++;
  for(const robot of state.robots) {
    const task=robot.task,u=robot.underlift;if(task&&u) {
      const pod=podOf(state,task)!;
      const retreating=u.stage==="retreat";
      // Arrival can change phase within the movement tick; lock the actual final docking heading before lifting.
      if (robot.phase === "loading" && same(robot, pod)) u.headingRad = dockOf(state, { x: task.fromX, y: task.fromY }).heading;
      if(!retreating&&robot.phase==="toPickup") {u.stage=Math.hypot(robot.x-pod.x,robot.y-pod.y)<1.3?"dock-under":"approach";u.headingRad=heading(robot,u.headingRad);}
      if(robot.phase==="toDrop"||robot.loaded&&robot.phase==="waitPoint"||robot.phase==="unloading"&&u.stage==="carry") {const extracting=robot.phase==="toDrop"&&(u.stage==="lift"||u.stage==="extract"&&(u.extractionUntilM===undefined||robot.distM<u.extractionUntilM-1e-8));u.stage=retreating?"retreat":extracting?"extract":"carry";u.progress=1;u.podLiftM=pod.spec.liftHeightM;u.platformTopM=pod.spec.baseClearanceM+u.podLiftM;u.contactGapM=0;u.contact=true;if(!extracting&&!retreating)u.headingRad=heading(robot,u.headingRad);pod.x=robot.x;pod.y=robot.y;pod.heading=u.headingRad;pod.liftM=u.podLiftM;if(pod.phase!=="carrying")state.demoUnderlift.stockRevision++;pod.phase="carrying";}
    }
    const completed=before.get(robot.id);if(!completed||completed.doneS===null||task?.id===completed.id)continue;
    const pod=podOf(state,completed)!;pod.robotId=null;pod.taskId=null;pod.liftM=0;pod.phase=same(pod,pod.home)?"parked":"delivered";robot.underlift=undefined;
    if(completed.operation==="prefetch-pod")continue;
    if(completed.countsTowardDemand!==false&&completed.kind==="outbound")internalTask(state,pod,completed,"return-pod");else pod.reservedForTaskId=null;
  }
}
export function underliftHandling(state:UnderliftState,robot:SimRobot,dt:number,reserve:(robot:SimRobot,next:number)=>boolean):boolean {
  const u=robot.underlift,task=robot.task;if(!state.demoUnderlift||!u||!task)return true;
  const pod=podOf(state,task)!,loading=robot.phase==="loading";
  if(loading&&!same(robot,pod))return false;
  if(loading&&!["close-gap","lift"].includes(u.stage)||!loading&&!["lower","retract","exit"].includes(u.stage)) {u.handlingTotalS=underliftHandlingBudgetS(state.input.robots.handlingSec);robot.timerS=u.handlingTotalS;}
  if(!loading&&pod.phase==="carrying")state.demoUnderlift.stockRevision++;
  const total=u.handlingTotalS!,progress=clamp((total-robot.timerS+dt)/total);u.progress=progress;
  if(loading) {
    u.stage=progress<=0.5?"close-gap":"lift";u.podLiftM=pod.spec.liftHeightM*clamp((progress-0.5)*2);u.platformTopM=progress<=0.5?PLATFORM_REST_M+(pod.spec.baseClearanceM-PLATFORM_REST_M)*progress*2:pod.spec.baseClearanceM+u.podLiftM;
    pod.phase="loading";
    if(progress>=1&&task.countsTowardDemand!==false&&task.kind==="inbound")pod.contents="full";
  } else if(progress<=1/3) {u.stage="lower";u.podLiftM=pod.spec.liftHeightM*(1-progress*3);u.platformTopM=pod.spec.baseClearanceM+u.podLiftM;pod.phase="unloading";
  } else if(progress<=2/3) {u.stage="retract";u.podLiftM=0;u.platformTopM=pod.spec.baseClearanceM-(pod.spec.baseClearanceM-PLATFORM_REST_M)*(progress*3-1);pod.phase="unloading";
  } else {
    // The existing station-service timer covers unloading; cartons leave before reverse exit.
    if(task.countsTowardDemand!==false&&task.kind==="outbound")pod.contents="empty";
    u.stage="exit";u.podLiftM=0;u.platformTopM=PLATFORM_REST_M;pod.phase="delivered";
    u.contactGapM=pod.spec.baseClearanceM-PLATFORM_REST_M;u.contact=false;pod.liftM=0;
    if(u.routeStage!=="exit") {const dock=dockOf(state,{x:task.toX,y:task.toY});robot.path=[{x:task.toX,y:task.toY},{...dock.entry}];robot.pathLenM=routeLengthM(robot.path);robot.distM=0;u.routeStage="exit";u.headingRad=dock.heading;}
    const exitSpeed=Math.min(state.input.robots.speedMps,robot.pathLenM/(total/3));
    const next=Math.min(robot.pathLenM,robot.distM+exitSpeed*dt);
    if(next>robot.distM&&!reserve(robot,next))return false;
    robot.distM=next;const point=positionAlong(robot.path,next);robot.x=point.x;robot.y=point.y;
    if(robot.timerS<=dt+1e-9&&robot.distM<robot.pathLenM-1e-8)return false;
  }
  u.contactGapM=Math.max(0,pod.spec.baseClearanceM+u.podLiftM-u.platformTopM);u.contact=u.contactGapM<1e-8;pod.liftM=u.podLiftM;
  return true;
}
export function frameCarriers(state:UnderliftState) {return (state.demoUnderlift?.pods??[]).map(p=>({...p,home:{...p.home},spec:{...p.spec}}));}
