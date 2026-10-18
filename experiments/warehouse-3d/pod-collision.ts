import { orientedBounds, rectangleGap, pointBoxDistance, type Bounds } from "../../lib/sim/underlift-layout";
export { orientedBounds, rectangleGap, pointBoxDistance } from "../../lib/sim/underlift-layout";
export type { Bounds } from "../../lib/sim/underlift-layout";
import type { SimRobot } from "../../lib/sim/state";
import type { RackCarrier, UnderliftState } from "./carriers";

export const STOCK_CLEARANCE_M = 0.15;
export const ROBOT_LENGTH_M = 1.044;
export const ROBOT_WIDTH_M = 0.654;
type Point = { x: number; y: number };
const EPS = 1e-8;

export function cardinalHeading(a:Point,b:Point,fallback=0):number {const dx=b.x-a.x,dy=b.y-a.y;if(Math.abs(dx)<1e-6&&Math.abs(dy)<1e-6)return fallback;if(Math.abs(dx)<1e-6)return dy>0?Math.PI/2:-Math.PI/2;if(Math.abs(dy)<1e-6)return dx>0?0:Math.PI;throw new Error("Подстеллажный маршрут должен быть ортогональным");}
type PodShape = Pick<RackCarrier, "x" | "y" | "heading" | "spec">;
const podBoxes = new WeakMap<PodShape, { x: number; y: number; heading: number; lengthM: number; widthM: number; bounds: Bounds }>();
export function podBounds(pod: PodShape): Bounds {
  const cached = podBoxes.get(pod);
  if (cached && cached.x === pod.x && cached.y === pod.y && cached.heading === pod.heading && cached.lengthM === pod.spec.lengthM && cached.widthM === pod.spec.widthM) return cached.bounds;
  const bounds = orientedBounds(pod, pod.spec.lengthM, pod.spec.widthM, pod.heading);
  podBoxes.set(pod, { x: pod.x, y: pod.y, heading: pod.heading, lengthM: pod.spec.lengthM, widthM: pod.spec.widthM, bounds });
  return bounds;
}
export function movingShape(robot: SimRobot) {
  const carried = (robot.underlift?.podLiftM ?? 0) > EPS;
  return { lengthM: carried ? 1.4 : ROBOT_LENGTH_M, widthM: carried ? 1 : ROBOT_WIDTH_M };
}
export function ownPodException(robot: SimRobot, pod: RackCarrier): boolean {
  if (pod.robotId !== robot.id) return false;
  return ["loading", "unloading"].includes(robot.phase) ||
    (robot.phase === "toPickup" || robot.phase === "waitPoint" && !robot.loaded) &&
      robot.underlift?.routeStage === "pickup" && robot.pathLenM - robot.distM <= 2 + EPS;
}
const stockIndexes = new WeakMap<UnderliftState, { revision: number; buckets: Map<string, RackCarrier[]> }>();
function nearby(state: UnderliftState, box: Bounds): RackCarrier[] {
  const runtime = state.demoUnderlift;
  if (!runtime) return [];
  let index = stockIndexes.get(state);
  // Carried pods are excluded; only a pickup or set-down changes this floor index.
  if (!index || index.revision !== runtime.stockRevision) {
    index = { revision: runtime.stockRevision, buckets: new Map() };
    for (const pod of runtime.pods) if (pod.phase !== "carrying") {
      const key = `${Math.floor(pod.x / 8)},${Math.floor(pod.y / 8)}`;
      const bucket = index.buckets.get(key);
      if (bucket) bucket.push(pod); else index.buckets.set(key, [pod]);
    }
    stockIndexes.set(state, index);
  }
  const found: RackCarrier[] = [];
  for (let x = Math.floor((box.x0 - 1) / 8); x <= Math.floor((box.x1 + 1) / 8); x++) {
    for (let y = Math.floor((box.y0 - 1) / 8); y <= Math.floor((box.y1 + 1) / 8); y++) found.push(...index.buckets.get(`${x},${y}`) ?? []);
  }
  return found;
}

/** Straight translation uses exact rectangular swept bounds; turns reserve a complete rotation disk. */
export function stockSweepIsClear(state: UnderliftState, robot: SimRobot, path: Point[], includeOwnPod = false, allowTurnAtStart = true): boolean {
  if (!state.demoUnderlift || !path.length) return true;
  const body = movingShape(robot), radius = Math.hypot(body.lengthM, body.widthM) / 2;
  const extent = { x0: Math.min(...path.map(p => p.x)) - radius - STOCK_CLEARANCE_M, x1: Math.max(...path.map(p => p.x)) + radius + STOCK_CLEARANCE_M, y0: Math.min(...path.map(p => p.y)) - radius - STOCK_CLEARANCE_M, y1: Math.max(...path.map(p => p.y)) + radius + STOCK_CLEARANCE_M };
  const pods = nearby(state, extent).filter(p => !(p.robotId === robot.id && p.phase === "carrying") && (includeOwnPod || !ownPodException(robot, p)));
  let previous = robot.underlift?.headingRad;
  for (let i = 0; i < Math.max(1, path.length - 1); i++) {
    const a = path[i]!, b = path[Math.min(i + 1, path.length - 1)]!;
    if(Math.abs(a.x-b.x)>1e-6&&Math.abs(a.y-b.y)>1e-6)return false;
    const locked = robot.underlift?.stage === "exit" || robot.underlift?.stage === "extract" || robot.underlift?.stage === "retreat";
    if(locked&&Math.abs((b.x-a.x)*Math.sin(robot.underlift!.headingRad)-(b.y-a.y)*Math.cos(robot.underlift!.headingRad))>EPS)return false;
    const heading = locked ? robot.underlift!.headingRad : Math.abs(a.x - b.x) + Math.abs(a.y - b.y) > EPS ? cardinalHeading(a,b,previous??0) : previous ?? 0;
    const bounds = orientedBounds(a, body.lengthM, body.widthM, heading);
    const sweep = { x0: Math.min(bounds.x0, bounds.x0 + b.x - a.x), x1: Math.max(bounds.x1, bounds.x1 + b.x - a.x), y0: Math.min(bounds.y0, bounds.y0 + b.y - a.y), y1: Math.max(bounds.y1, bounds.y1 + b.y - a.y) };
    for (const pod of pods) {
      const fixed = podBounds(pod);
      if (rectangleGap(sweep, fixed) < STOCK_CLEARANCE_M - EPS) return false;
      if ((i > 0 || allowTurnAtStart) && previous !== undefined && Math.abs(Math.sin((heading - previous) / 2)) > EPS && pointBoxDistance(a, fixed) - radius < STOCK_CLEARANCE_M - EPS) return false;
    }
    previous = heading;
  }
  return true;
}

export function nearestStockGap(state: UnderliftState, robot: SimRobot): { gapM: number; podId: string } | null {
  const body = movingShape(robot), heading = actualHeading(robot), box = orientedBounds(robot, body.lengthM, body.widthM, heading);
  let nearest: { gapM: number; podId: string } | null = null;
  for (const pod of nearby(state, { x0: robot.x - 3, x1: robot.x + 3, y0: robot.y - 3, y1: robot.y + 3 })) {
    if (ownPodException(robot, pod)) continue;
    const gapM = rectangleGap(box, podBounds(pod));
    if (!nearest || gapM < nearest.gapM) nearest = { gapM, podId: pod.id };
  }
  return nearest;
}

export function actualHeading(robot: SimRobot): number {
  if (robot.underlift && ["dock-under", "close-gap", "lift", "extract", "retreat", "lower", "retract", "exit"].includes(robot.underlift.stage)) return robot.underlift.headingRad;
  let distance = 0;
  for (let i=1;i<robot.path.length;i++) { const a=robot.path[i-1]!,b=robot.path[i]!; const length=Math.abs(b.x-a.x)+Math.abs(b.y-a.y); if(length>EPS && distance+length>=robot.distM-EPS) return cardinalHeading(a,b,robot.underlift?.headingRad??0);distance+=length; }
  return robot.underlift?.headingRad ?? 0;
}
/** Graph links are usable only when their translation and complete endpoint turns clear stock. */
export function stockRouteIsClear(state: UnderliftState,robot:SimRobot,a:Point,b:Point):boolean {
 if(Math.abs(a.x-b.x)>1e-6&&Math.abs(a.y-b.y)>1e-6)return false;
 const probe={...robot,underlift:robot.underlift?{...robot.underlift,stage:"carry" as const,headingRad:cardinalHeading(a,b,robot.underlift?.headingRad??0)}:undefined};
 if(!stockSweepIsClear(state,probe,[a,b],true,false))return false;
 const body=movingShape(robot),radius=Math.hypot(body.lengthM,body.widthM)/2;
 const pods=nearby(state,{x0:Math.min(a.x,b.x)-radius-.15,x1:Math.max(a.x,b.x)+radius+.15,y0:Math.min(a.y,b.y)-radius-.15,y1:Math.max(a.y,b.y)+radius+.15});
 return pods.every(p=>p.robotId===robot.id&&p.phase==="carrying" || [a,b].every(q=>pointBoxDistance(q,podBounds(p))-radius>=.15-EPS));
}
