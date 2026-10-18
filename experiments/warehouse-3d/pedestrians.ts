import type { PedestrianInput, SimLayout } from "../../lib/sim/types";
import { siteSegmentIsClear } from "../../lib/sim/site-layout";
import { positionAlong, routeLengthM } from "../../lib/sim/routing";

type Point = { x: number; y: number };
type Body = Point & { id: number; path: Point[]; distM: number };
type Person = PedestrianInput["people"][number];
type Stock={id:string;x:number;y:number;heading:number;phase?:string;robotId:number|null;spec:{lengthM:number;widthM:number}};
type CrossingLeg={a:Person["trajectory"][number];b:Person["trajectory"][number];length:number;speed:number};
export type PedestrianRuntime = {
  config: PedestrianInput; tS: number;
  robots: Record<number, { velocityMps: number; reason: string | null; personId: string | null }>;
  collisionCount: number; brakingViolations: number; minimumClearanceM: number | null;
  firstViolation?: { tS: number; robotId: number; personId: string; clearanceM: number; reason: string; x:number; y:number };
  controlled:Record<string,{phase:"at-curb"|"requesting"|"crossing";leg:number;progressM:number;x:number;y:number;actualStartS:number|null;evacuating:Record<number,{entered:boolean}>;history:{desiredStartS:number;actualStartS:number;completedAtS:number|null;waitS:number}[]}>;
  plans:Record<string,CrossingLeg[]>;
};
const EPS = 1e-8;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
function exact(v: unknown, keys: string[]): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).every(k => keys.includes(k));
}
/** Source boundary shared by bridge and physical initialization. Never accepts runtime status. */
export function validatePedestrians(value: unknown, site?: SimLayout): asserts value is PedestrianInput {
  if (!exact(value, ["version", "policy", "crossingWidthM", "reactionTimeS", "decelerationMps2", "accelerationMps2", "clearanceM", "people"]) || value.version !== "pedestrians-1") throw new Error("Неверная модель пешеходов");
  if(value.policy!==undefined&&value.policy!=="fixed-trajectory"&&value.policy!=="controlled-crossing")throw new Error("Неверная политика пешеходного перехода");
  if(value.policy==="controlled-crossing"&&(!finite(value.crossingWidthM)||value.crossingWidthM<.5||value.crossingWidthM>4))throw new Error("Нужна ширина контролируемого перехода от 0,5 до 4 м");
  for (const key of ["reactionTimeS", "decelerationMps2", "accelerationMps2", "clearanceM"]) {
    const n = value[key]; if (!finite(n) || n < (key === "reactionTimeS" || key === "clearanceM" ? .05 : .1) || n > (key === "reactionTimeS" ? 5 : 3)) throw new Error("Неверные допущения реакции и торможения");
  }
  if (!Array.isArray(value.people) || !value.people.length || value.people.length > 16) throw new Error("Нужно от 1 до 16 пешеходов");
  const ids = new Set<string>();
  for (const person of value.people) {
    if (!exact(person, ["id", "radiusM", "trajectory"]) || typeof person.id !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(person.id) || ids.has(person.id) || !finite(person.radiusM) || person.radiusM < .15 || person.radiusM > .6 || !Array.isArray(person.trajectory) || person.trajectory.length < 2 || person.trajectory.length > 128) throw new Error("Неверная траектория человека");
    ids.add(person.id); let previous: { tS: number; x: number; y: number } | undefined;
    for (const point of person.trajectory) {
      if (!exact(point, ["tS", "x", "y"]) || !finite(point.tS) || point.tS < 0 || point.tS > 86400 || !finite(point.x) || !finite(point.y) || (previous && point.tS <= previous.tS)) throw new Error("Точки человека: метры и возрастающее время в секундах");
      const p = point as { tS: number; x: number; y: number };
      const personSite = site ? { ...site, routingGraph: { nodes:[],edges:[],...site.routingGraph,clearanceM: person.radiusM } } : undefined;
      if (personSite && (!siteSegmentIsClear(personSite, p, p) || (previous && !siteSegmentIsClear(personSite, previous, p)))) throw new Error("Траектория человека пересекает препятствие или границу плана");
      if (previous && Math.hypot(p.x - previous.x, p.y - previous.y) / (p.tS - previous.tS) > 2.5) throw new Error("Скорость пешехода выше 2,5 м/с");
      previous = p;
    }
    if (person.trajectory[0]?.tS !== 0) throw new Error("Человек должен иметь известную позицию с начала прогона");
    if(value.policy==="controlled-crossing"&&new Set(person.trajectory.map(p=>`${p.x};${p.y}`)).size!==2)throw new Error("Контролируемому переходу нужны ровно два явно заданных бордюра");
  }
}
export function personPosition(person: Person, tS: number): Point {
  const points = person.trajectory;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    if (tS <= b.tS) { const f = Math.max(0, Math.min(1, (tS - a.tS) / (b.tS - a.tS))); return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }; }
  }
  return { x: points.at(-1)!.x, y: points.at(-1)!.y };
}
export function createPedestrians(config: PedestrianInput | undefined, site: SimLayout): PedestrianRuntime | undefined {
  if (!config) return undefined;
  validatePedestrians(config, site);
  return { config: structuredClone(config), tS: 0, robots: {}, collisionCount: 0, brakingViolations: 0, minimumClearanceM: null, plans:Object.fromEntries(config.people.map(p=>[p.id,legs(p)])),controlled:Object.fromEntries(config.policy==="controlled-crossing"?config.people.map(p=>[p.id,{phase:"at-curb",leg:0,progressM:0,x:p.trajectory[0]!.x,y:p.trajectory[0]!.y,actualStartS:null,evacuating:{},history:[]}]):[]) };
}
function pointDistance(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x, dy = b.y - a.y, d = dx * dx + dy * dy;
  const f = d ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / d)) : 0;
  return Math.hypot(p.x - a.x - f * dx, p.y - a.y - f * dy);
}
const legs=(p:Person)=>p.trajectory.slice(1).flatMap((b,i)=>{const a=p.trajectory[i]!;return Math.hypot(b.x-a.x,b.y-a.y)>EPS?[{a,b,length:Math.hypot(b.x-a.x,b.y-a.y),speed:Math.hypot(b.x-a.x,b.y-a.y)/(b.tS-a.tS)}]:[];});
function firstPathContact(body:Body,a:Point,b:Point,spacing:number,maxM:number){if(!body.path.length)return Infinity;const end=Math.min(routeLengthM(body.path),body.distM+maxM);for(let m=body.distM;m<=end+EPS;m+=.1)if(pointDistance(positionAlong(body.path,m),a,b)<spacing)return Math.max(0,m-body.distM-.1);return Infinity;}
function runtimePose(runtime:PedestrianRuntime,p:Person,tS:number):Point{
  const c=runtime.controlled[p.id];if(!c)return personPosition(p,tS);
  let position:Point=p.trajectory[0]!;
  for(let i=0;i<c.history.length;i++){const h=c.history[i]!,leg=runtime.plans[p.id]![i]!;if(tS<h.actualStartS)break;
    const f=Math.max(0,Math.min(1,(tS-h.actualStartS)*leg.speed/leg.length));position={x:leg.a.x+(leg.b.x-leg.a.x)*f,y:leg.a.y+(leg.b.y-leg.a.y)*f};
    if(h.completedAtS===null||tS<h.completedAtS)break;
  }
  return position;
}
/** A scheduled request is not permission to walk into a body. Existing committed traffic clears first. */
export function beginPedestrians(runtime:PedestrianRuntime|undefined,bodies:Body[],robotRadiusM:number,stock:Stock[]=[]){
  if(!runtime)return;for(const r of Object.values(runtime.robots)){r.reason=null;r.personId=null;}
  for(const p of runtime.config.people){const c=runtime.controlled[p.id],leg=c?runtime.plans[p.id]![c.leg]:undefined;if(!c||!leg)continue;
    const zone=robotRadiusM+p.radiusM+runtime.config.clearanceM+(runtime.config.crossingWidthM??0)/2;
    if(c.phase==="at-curb"&&runtime.tS>=leg.a.tS){c.phase="requesting";
      for(const b of bodies){const v=runtime.robots[b.id]?.velocityMps??0;const inside=pointDistance(b,leg.a,leg.b)<zone;const stop=v*(runtime.config.reactionTimeS+1)+v*v/(2*runtime.config.decelerationMps2);
        if(inside||firstPathContact(b,leg.a,leg.b,zone,stop+.1)<=stop)c.evacuating[b.id]={entered:inside};}
    }
    if(c.phase!=="requesting")continue;
    for(const [id,e]of Object.entries(c.evacuating)){const b=bodies.find(r=>r.id===Number(id));if(!b){delete c.evacuating[Number(id)];continue;}const inside=pointDistance(b,leg.a,leg.b)<zone;if(inside)e.entered=true;else if(e.entered||firstPathContact(b,leg.a,leg.b,zone,routeLengthM(b.path))===Infinity)delete c.evacuating[b.id];}
    const clear=!Object.keys(c.evacuating).length&&stock.filter(s=>s.phase!=="carrying").every(s=>stockDistance(leg.a,leg.b,s)>=p.radiusM+runtime.config.clearanceM+(runtime.config.crossingWidthM??0)/2)&&bodies.every(b=>{const distance=pointDistance(b,leg.a,leg.b),v=runtime.robots[b.id]?.velocityMps??0;return distance>=zone&&!(v>EPS&&firstPathContact(b,leg.a,leg.b,zone,v*(runtime.config.reactionTimeS+1)+v*v/(2*runtime.config.decelerationMps2)+.1)<Infinity);});
    if(clear){c.phase="crossing";c.actualStartS=runtime.tS;c.history.push({desiredStartS:leg.a.tS,actualStartS:runtime.tS,completedAtS:null,waitS:runtime.tS-leg.a.tS});}
  }
}
/** Constant relative velocity on one pair of actual motion segments, not unrelated swept envelopes. */
export function relativeMotionDistance(a: Point, b: Point, c: Point, d: Point) {
  const x = a.x - c.x, y = a.y - c.y, vx = b.x - a.x - d.x + c.x, vy = b.y - a.y - d.y + c.y;
  const v2 = vx * vx + vy * vy, f = v2 ? Math.max(0, Math.min(1, -(x * vx + y * vy) / v2)) : 0;
  return Math.hypot(x + f * vx, y + f * vy);
}
/** One-second discrete braking. The extra one-step horizon is explicitly conservative. */
export function pedestrianMotionLimit(runtime: PedestrianRuntime | undefined, body: Body, nextM: number, robotRadiusM: number): number {
  if (!runtime || nextM <= body.distM + EPS) return nextM;
  const cfg = runtime.config, r = runtime.robots[body.id] ??= { velocityMps: 0, reason: null, personId: null };
  const nominal = nextM - body.distM, v = r.velocityMps;
  const horizon = cfg.reactionTimeS + v / cfg.decelerationMps2 + 1;
  const lookahead = Math.max(nominal, v) * (horizon + 1) + robotRadiusM + 1;
  const end = Math.min(routeLengthM(body.path), body.distM + lookahead);
  let obstacleM = Infinity; let personId: string | null = null;
  for (const p of cfg.people) {
    const crossing=runtime.controlled[p.id],leg=crossing?runtime.plans[p.id]![crossing.leg]:undefined;
    if(crossing&&leg&&(crossing.phase==="requesting"||crossing.phase==="crossing")&&!crossing.evacuating[body.id]){
      const distance=firstPathContact(body,leg.a,leg.b,robotRadiusM+p.radiusM+cfg.clearanceM+(cfg.crossingWidthM??0)/2,lookahead);
      if(distance<obstacleM){obstacleM=distance;personId=p.id;}
    }
    const times = [runtime.tS, ...p.trajectory.filter(q => q.tS > runtime.tS && q.tS < runtime.tS + horizon).map(q => q.tS), runtime.tS + horizon];
    const spacing = robotRadiusM + p.radiusM + cfg.clearanceM;
    for (let m = body.distM; m <= end + EPS; m += .1) {
      const point = positionAlong(body.path, Math.min(m, end));
      if (times.some((t, i) => i > 0 && pointDistance(point, runtimePose(runtime,p,times[i - 1]!), runtimePose(runtime,p,t)) < spacing)) {
        if (m - body.distM < obstacleM) { obstacleM = Math.max(0,m - body.distM-.1); personId = p.id; } break;
      }
    }
  }
  r.personId = personId;
  if (!personId) { r.reason = null; return body.distM + Math.min(nominal, v + cfg.accelerationMps2); }
  const latency=cfg.reactionTimeS+1, a=cfg.decelerationMps2;
  const target = obstacleM<.1?0:Math.min(nominal,Math.sqrt((a*latency)**2+2*a*obstacleM)-a*latency);
  const nextV = Math.max(Math.max(0, v - cfg.decelerationMps2), Math.min(target, v + cfg.accelerationMps2));
  r.reason = nextV <= EPS ? `Ожидание пешехода ${personId}` : `Торможение перед пешеходом ${personId}`;
  // The 10 cm search grid rounds the stop line outward; do not call that rounding a physical violation.
  if (v*cfg.reactionTimeS+v * v / (2 * cfg.decelerationMps2) > obstacleM + .1 + EPS) {
    runtime.brakingViolations++;
    runtime.firstViolation ??= { tS: runtime.tS, robotId: body.id, personId, clearanceM: obstacleM, reason: "Недостаточная дистанция с запасом на реакцию и торможение",x:body.x,y:body.y };
  }
  return body.distM + Math.min(nominal, nextV);
}
function actualBreakpoints(runtime:PedestrianRuntime,p:Person,startS:number,endS:number){
  const times=new Set([0,1,...p.trajectory.filter(q=>q.tS>startS&&q.tS<endS).map(q=>q.tS-startS)]);
  const c=runtime.controlled[p.id],leg=c?runtime.plans[p.id]![c.leg]:undefined;
  if(c?.phase==="crossing"&&leg){const arrival=(leg.length-c.progressM)/leg.speed;if(arrival>EPS&&arrival<1-EPS)times.add(arrival);}
  return times;
}
/** Segment to oriented rectangle distance, including intersection (without a scan-grid approximation). */
function stockDistance(a:Point,b:Point,stock:Stock){
  const c=Math.cos(stock.heading),s=Math.sin(stock.heading),local=(p:Point)=>({x:(p.x-stock.x)*c+(p.y-stock.y)*s,y:-(p.x-stock.x)*s+(p.y-stock.y)*c});
  const p=local(a),q=local(b),w=stock.spec.lengthM/2,h=stock.spec.widthM/2;
  let lo=0,hi=1;
  for(const [start,delta,min,max]of [[p.x,q.x-p.x,-w,w],[p.y,q.y-p.y,-h,h]]){
    if(Math.abs(delta!)<EPS){if(start!<min!||start!>max!){lo=2;break;}}
    else{const x=(min!-start!)/delta!,y=(max!-start!)/delta!;lo=Math.max(lo,Math.min(x,y));hi=Math.min(hi,Math.max(x,y));}
  }
  if(lo<=hi)return 0;
  const pointGap=(r:Point)=>Math.hypot(Math.max(0,Math.abs(r.x)-w),Math.max(0,Math.abs(r.y)-h));
  return Math.min(pointGap(p),pointGap(q),...[-w,w].flatMap(x=>[-h,h].map(y=>pointDistance({x,y},p,q))));
}
export function auditPedestrians(runtime: PedestrianRuntime | undefined, motions: { id: number; path: Point[] }[], endS: number, robotRadiusM: number,stock:Stock[] = []) {
  if (!runtime) return;
  const startS = endS - 1;
  for (const motion of motions) {
    const length = routeLengthM(motion.path), r = runtime.robots[motion.id] ??= { velocityMps: 0, reason: null, personId: null };
    r.velocityMps = length;
    for (const person of runtime.config.people) {
      const times = actualBreakpoints(runtime,person,startS,endS);
      let walked = 0; for (let i = 1; i < motion.path.length; i++) { walked += Math.hypot(motion.path[i]!.x - motion.path[i - 1]!.x, motion.path[i]!.y - motion.path[i - 1]!.y); if (length) times.add(walked / length); }
      const sorted = [...times].sort((a, b) => a - b); let gap = Infinity;
      for (let i = 1; i < sorted.length; i++) { const a = sorted[i - 1]!, b = sorted[i]!; gap = Math.min(gap, relativeMotionDistance(positionAlong(motion.path, length * a), positionAlong(motion.path, length * b), runtimePose(runtime,person,startS+a),runtimePose(runtime,person,startS+b)) - robotRadiusM - person.radiusM); }
      runtime.minimumClearanceM = Math.min(runtime.minimumClearanceM ?? Infinity, gap);
      if (gap < runtime.config.clearanceM - EPS) { runtime.collisionCount++; runtime.firstViolation ??= { tS: endS, robotId: motion.id, personId: person.id, clearanceM: gap, reason: "Нарушен модельный зазор до пешехода",x:motion.path.at(-1)!.x,y:motion.path.at(-1)!.y }; }
    }
  }
  // Attached stock is already enclosed by its robot's conservative radius. Grounded stock has no robot reservation.
  for(const person of runtime.config.people){const times=[...actualBreakpoints(runtime,person,startS,endS)].sort((a,b)=>a-b);
    for(const pod of stock){const owner=pod.robotId===null?undefined:motions.find(r=>r.id===pod.robotId);if(pod.phase==="carrying"||(owner&&owner.path.every(p=>Math.hypot(p.x-pod.x,p.y-pod.y)<.01)))continue;let gap=Infinity;
      for(let i=1;i<times.length;i++){const a=runtimePose(runtime,person,startS+times[i-1]!),b=runtimePose(runtime,person,startS+times[i]!);const reach=Math.hypot(pod.spec.lengthM,pod.spec.widthM)/2+person.radiusM+runtime.config.clearanceM;
        if(Math.max(a.x,b.x)+reach<pod.x||Math.min(a.x,b.x)-reach>pod.x||Math.max(a.y,b.y)+reach<pod.y||Math.min(a.y,b.y)-reach>pod.y)continue;
        gap=Math.min(gap,stockDistance(a,b,pod)-person.radiusM);}
      if(gap===Infinity)continue;runtime.minimumClearanceM=Math.min(runtime.minimumClearanceM??Infinity,gap);
      if(gap<runtime.config.clearanceM-EPS){runtime.collisionCount++;runtime.firstViolation??={tS:endS,robotId:-1,personId:person.id,clearanceM:gap,reason:`Пешеход пересекает наземный носитель ${pod.id}`,x:pod.x,y:pod.y};}
    }
  }
  for(const p of runtime.config.people){const c=runtime.controlled[p.id],leg=c?runtime.plans[p.id]![c.leg]:undefined;if(!c||!leg||c.phase!=="crossing")continue;const pose=runtimePose(runtime,p,endS),arrivalS=runtime.tS+(leg.length-c.progressM)/leg.speed;c.x=pose.x;c.y=pose.y;c.progressM=Math.min(leg.length,c.progressM+leg.speed);if(c.progressM>=leg.length-EPS){c.history.at(-1)!.completedAtS=arrivalS;c.phase="at-curb";c.leg++;c.progressM=0;c.actualStartS=null;c.evacuating={};}}
  runtime.tS = endS;
}
export function pedestrianFrame(runtime: PedestrianRuntime | undefined, tS: number) {
  return runtime?.config.people.map(p => {const c=runtime.controlled[p.id],active=c?.history.findIndex(h=>h.actualStartS<=tS&&(h.completedAtS===null||tS<h.completedAtS)),index=active!==undefined&&active>=0?active:c?.leg,leg=index===undefined?undefined:runtime.plans[p.id]![index],phase=active!==undefined&&active>=0?"crossing":c?.phase;return { id: p.id, ...runtimePose(runtime,p,tS), radiusM: p.radiusM, model: "pedestrians-1",...(c?{phase,desiredStartS:leg?.a.tS??null,actualStartS:active!==undefined&&active>=0?c.history[active]!.actualStartS:c.actualStartS,waitS:phase==="requesting"?tS-(leg?.a.tS??tS):0,crossings:structuredClone(c.history),crosswalk:leg?{from:leg.a,to:leg.b,widthM:runtime.config.crossingWidthM}:null}:{phase:"fixed-trajectory"})};}) ?? [];
}
