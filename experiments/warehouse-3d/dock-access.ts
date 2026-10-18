type Point={x:number;y:number};
export type DockGrant={robotId:number;key:string;center:Point;entry:Point};
export type DockAccess={spacingM:number;grants:DockGrant[];waiters:(DockGrant&{sinceS:number;sequence:number})[];nextSequence:number};
const EPS=1e-8;
function pointDistance(p:Point,a:Point,b:Point){const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);}
function gap(a:Point,b:Point,c:Point,d:Point){const cross=(p:Point,q:Point,r:Point)=>(q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);if(cross(a,b,c)*cross(a,b,d)<=0&&cross(c,d,a)*cross(c,d,b)<=0&&Math.max(Math.min(a.x,b.x),Math.min(c.x,d.x))<=Math.min(Math.max(a.x,b.x),Math.max(c.x,d.x))+EPS&&Math.max(Math.min(a.y,b.y),Math.min(c.y,d.y))<=Math.min(Math.max(a.y,b.y),Math.max(c.y,d.y))+EPS)return 0;return Math.min(pointDistance(a,c,d),pointDistance(b,c,d),pointDistance(c,a,b),pointDistance(d,a,b));}
export const dockDistance=(point:Point,dock:{center:Point;entry:Point})=>pointDistance(point,dock.center,dock.entry);
export function createDockAccess(spacingM=1.95):DockAccess{return {spacingM,grants:[],waiters:[],nextSequence:0};}
/** Only the physical docking/extraction capsule is owned; no future travel leg is reserved. */
export function requestDock(c:DockAccess,request:DockGrant&{tS:number},bodies:({id:number}&Point)[]):boolean {
 if(c.grants.some(g=>g.robotId===request.robotId&&g.key===request.key))return true;
 let waiting=c.waiters.find(w=>w.robotId===request.robotId&&w.key===request.key);if(!waiting){waiting={...request,sinceS:request.tS,sequence:c.nextSequence++};c.waiters.push(waiting);}
 if(c.grants.some(g=>g.robotId!==request.robotId&&gap(g.center,g.entry,request.center,request.entry)<c.spacingM-EPS))return false;
 if(bodies.some(b=>b.id!==request.robotId&&dockDistance(b,request)<c.spacingM-EPS))return false;
 if(!c.grants.some(g=>g.robotId===request.robotId)&&c.waiters.some(w=>w.robotId!==request.robotId&&w.sequence<waiting!.sequence&&gap(w.center,w.entry,request.center,request.entry)<c.spacingM-EPS))return false;
 c.waiters=c.waiters.filter(w=>w.robotId!==request.robotId||w.key!==request.key);
 c.grants.push({robotId:request.robotId,key:request.key,center:{...request.center},entry:{...request.entry}});return true;
}
export function dockPathAllowed(c:DockAccess,robotId:number,path:Point[]):boolean {return c.grants.every(g=>g.robotId===robotId||path.every((p,i)=>gap(p,path[Math.min(i+1,path.length-1)]!,g.center,g.entry)>=c.spacingM-EPS));}
export function releaseDockAfterClear(c:DockAccess,robotId:number,point:Point):void {c.grants=c.grants.filter(g=>g.robotId!==robotId||dockDistance(point,g)<c.spacingM-EPS);}

export function cancelDockRequest(c:DockAccess,robotId:number):void {c.waiters=c.waiters.filter(w=>w.robotId!==robotId);}
