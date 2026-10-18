import { createDockAccess,requestDock,cancelDockRequest,dockPathAllowed,releaseDockAfterClear,dockDistance,type DockAccess } from "./dock-access";
import { buildClosedPodLayout } from "../../lib/sim/underlift-layout";
import { stockSweepIsClear, stockRouteIsClear, nearestStockGap, orientedBounds, rectangleGap, ROBOT_LENGTH_M, ROBOT_WIDTH_M } from "./pod-collision";
import { createSim, stepSim, type SimMovementGate, type SimHandlingGate } from "../../lib/sim/engine";
import { needsCharge, type SimDispatchGate } from "../../lib/sim/dispatch";
import { positionAlong, route, routeLengthBetween, routeLengthM } from "../../lib/sim/routing";
import { siteSegmentIsClear, validateProjectSiteLayout, validateSiteLayout } from "../../lib/sim/site-layout";
import type { SimEngineState, SimTask } from "../../lib/sim/state";
import type { SimInput, SimLayout } from "../../lib/sim/types";
import { accrueIncidentTime, createIncidentRuntime, defaultDemoIncidents, incidentHalts, updateIncidents, type IncidentConfig, type IncidentRuntime } from "./incidents";
import { recordZeroSocOperation, type AssessmentFacts, type AssessmentEvidence } from "./assessment";
import { POD_RADIUS_M, dockOf, validateUnderliftConfig, initUnderlift, underliftCanAssign, assignUnderlift, prepareUnderliftRoute, syncUnderlift, underliftHandling, type CarrierInput, type UnderliftState } from "./carriers";

export type TrafficPoint = { x: number; y: number };
export type BodySafety = { status: "clear" | "waiting"; blocked: boolean; reason: string | null; blockedBy: number | null; radiusM: number; requiredClearanceM: number; safeCenterDistanceM: number; nearestClearanceM: number | null; waitS: number; totalWaitS: number; replans: number; lastReplanS: number; blockedAtS: number; parking: boolean; assignments: number; yieldDistanceM: number | null; yieldStartedS: number | null };
export type TrafficController = {
  radiusM: number; clearanceM: number; tS: number; dtS: number;
  bodies: Record<number, BodySafety>; reservations: { id: number; path: TrafficPoint[]; box: Box }[];
  collisionCount: number; minimumClearanceM: number | null; detours: number; replansThisTick: number;
  replanCandidateId?: number | null;
  firstViolation?: AssessmentEvidence & { otherRobotId: number; clearanceM: number };
};
export type WarehouseDispatchPolicy = { version: "warehouse-dispatch-1"; pendingLookahead: 16; replanBudgetPerTick: 1; replanMinIntervalS: 5; selection: "oldest-feasible-nearest"; interruptHome: boolean; stationaryChargingConsumesRoute: false; homeConsumesTaskRoute: false };
const DISPATCH_POLICY: WarehouseDispatchPolicy = { version: "warehouse-dispatch-1", pendingLookahead: 16, replanBudgetPerTick: 1, replanMinIntervalS: 5, selection: "oldest-feasible-nearest", interruptHome: true, stationaryChargingConsumesRoute: false, homeConsumesTaskRoute: false };
export type DemoTrafficInput = CarrierInput & { demoIncidents?: IncidentConfig; demoTraffic: { version: "traffic-1.3.0" | "traffic-2.0.0"; radiusM: number; clearanceM: number; maxActiveRoutes: number; initialPositions: TrafficPoint[]; parkingBays: TrafficPoint[]; dispatchPolicy?: WarehouseDispatchPolicy } };
type RouteCommitment = { robotId: number; partnerId: number; leg: string; partnerLeg: string; travelledM: number };
export type WarehouseTrafficState = UnderliftState & { demoTraffic: TrafficController; demoIncidents?: IncidentRuntime; assessmentFacts?: AssessmentFacts; routeCommitments: RouteCommitment[];dockAccess:DockAccess };
type Body = TrafficPoint & { id: number };
const EPS = 1e-8;
type Box = { x0: number; x1: number; y0: number; y1: number };
function traceBox(path: TrafficPoint[]): Box { return { x0: Math.min(...path.map((p) => p.x)), x1: Math.max(...path.map((p) => p.x)), y0: Math.min(...path.map((p) => p.y)), y1: Math.max(...path.map((p) => p.y)) }; }
function boxesNear(a: Box, b: Box, spacing: number) { const dx = Math.max(0, a.x0 - b.x1, b.x0 - a.x1), dy = Math.max(0, a.y0 - b.y1, b.y0 - a.y1); return dx * dx + dy * dy < spacing * spacing; }

function pointSegmentDistance(p: TrafficPoint, a: TrafficPoint, b: TrafficPoint): number {
  const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
  const t = length2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
export function segmentDistance(a: TrafficPoint, b: TrafficPoint, c: TrafficPoint, d: TrafficPoint): number {
  const cross = (p: TrafficPoint, q: TrafficPoint, r: TrafficPoint) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const c1 = cross(a, b, c), c2 = cross(a, b, d), c3 = cross(c, d, a), c4 = cross(c, d, b);
  if (c1 * c2 <= 0 && c3 * c4 <= 0 && Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) <= Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) + EPS && Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) <= Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) + EPS) return 0;
  return Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b));
}
function traceDistance(a: TrafficPoint[], b: TrafficPoint[]): number {
  let distance = Infinity;
  for (let i = 0; i < Math.max(1, a.length - 1); i++) for (let j = 0; j < Math.max(1, b.length - 1); j++) distance = Math.min(distance, segmentDistance(a[i]!, a[Math.min(i + 1, a.length - 1)]!, b[j]!, b[Math.min(j + 1, b.length - 1)]!));
  return distance;
}

export function createTrafficController(robots: Body[], radiusM: number, clearanceM: number): TrafficController {
  const controller: TrafficController = { radiusM, clearanceM, tS: 0, dtS: 0, bodies: {}, reservations: [], collisionCount: 0, minimumClearanceM: null, detours: 0, replansThisTick: 0 };
  for (const r of robots) controller.bodies[r.id] = { status: "clear", blocked: false, reason: null, blockedBy: null, radiusM, requiredClearanceM: clearanceM, safeCenterDistanceM: 2 * radiusM + clearanceM, nearestClearanceM: null, waitS: 0, totalWaitS: 0, replans: 0, lastReplanS: -Infinity, blockedAtS: -Infinity, parking: false, assignments: 0, yieldDistanceM: null, yieldStartedS: null };
  auditTraffic(controller, robots);
  if (controller.collisionCount || (controller.minimumClearanceM !== null && controller.minimumClearanceM < clearanceM - EPS)) throw new Error("Начальная расстановка роботов нарушает безопасный габарит");
  return controller;
}
export function beginTrafficStep(controller: TrafficController, robots: Body[], tS: number, dtS: number) {
  controller.tS = tS; controller.dtS = dtS; controller.replansThisTick = 0;
  controller.reservations = robots.map((r) => ({ id: r.id, path: [{ x: r.x, y: r.y }], box: { x0: r.x, x1: r.x, y0: r.y, y1: r.y } }));
  for (const body of Object.values(controller.bodies)) { body.blocked = false; body.reason = null; body.blockedBy = null; body.status = "clear"; }
}
export function reserveTrafficMotion(controller: TrafficController, robotId: number, path: TrafficPoint[]): boolean {
  const safety = controller.bodies[robotId]!;
  const required = 2 * controller.radiusM + controller.clearanceM;
  const box = traceBox(path);
  for (const other of controller.reservations) if (other.id !== robotId && boxesNear(box, other.box, required) && traceDistance(path, other.path) < required - EPS) {
    safety.blocked = true; safety.status = "waiting"; safety.blockedBy = other.id; safety.reason = other.id < 0 ? `Защитная остановка: стоящий стеллаж pod-home-${-other.id - 999999}` : `Защитная остановка: уступает роботу ${other.id + 1}`;
    if (safety.blockedAtS !== controller.tS) { safety.waitS += controller.dtS; safety.totalWaitS += controller.dtS; safety.blockedAtS = controller.tS; }
    return false;
  }
  const reservation = controller.reservations.find((r) => r.id === robotId)!;
  reservation.path.push(...path.map((p) => ({ ...p })));
  reservation.box = { x0: Math.min(reservation.box.x0, box.x0), x1: Math.max(reservation.box.x1, box.x1), y0: Math.min(reservation.box.y0, box.y0), y1: Math.max(reservation.box.y1, box.y1) };
  if (safety.blockedAtS === controller.tS) { safety.totalWaitS -= controller.dtS; safety.blockedAtS = -Infinity; }
  safety.waitS = 0; safety.blocked = false; safety.status = "clear"; safety.reason = null; safety.blockedBy = null;
  return true;
}
export function auditTraffic(controller: TrafficController, robots: Body[]) {
  for (const r of robots) {
    let nearest = Infinity;
    for (const other of robots) if (r.id !== other.id) {
      const clearance = Math.hypot(r.x - other.x, r.y - other.y) - 2 * controller.radiusM;
      nearest = Math.min(nearest, clearance);
      if (clearance < controller.clearanceM - EPS) controller.firstViolation ??= { tS: controller.tS + controller.dtS, robotId: r.id, otherRobotId: other.id, x: r.x, y: r.y, clearanceM: clearance };
      if (r.id < other.id && clearance < -EPS) controller.collisionCount++;
    }
    controller.bodies[r.id]!.nearestClearanceM = Number.isFinite(nearest) ? nearest : null;
    if (Number.isFinite(nearest)) controller.minimumClearanceM = controller.minimumClearanceM === null ? nearest : Math.min(controller.minimumClearanceM, nearest);
  }
}
export function trafficSummary(controller: TrafficController) {
  return { policy: "swept-disc-reservation" as const, radiusM: controller.radiusM, requiredClearanceM: controller.clearanceM, safeCenterDistanceM: 2 * controller.radiusM + controller.clearanceM, waitingRobots: Object.values(controller.bodies).filter((b) => b.blocked).length, detours: controller.detours, collisionCount: controller.collisionCount, minimumClearanceM: controller.minimumClearanceM, totalWaitS: Object.values(controller.bodies).reduce((sum, b) => sum + b.totalWaitS, 0) };
}

/** Real graph-connected bays off the main centre lines, not renderer offsets or stacked slots. */
export function prepareWarehouseTraffic(input: SimInput): DemoTrafficInput {
  if (input.transportWorkflow === "single-leg-pallet-1") throw new Error("Подстеллажная 3D-модель не подтверждает однорейсовую паллетную перевозку вилочным роботом или тягачом");
  const prepared = input as DemoTrafficInput;
  if (prepared.demoUnderlift && prepared.demoTraffic?.version === "traffic-2.0.0" && prepared.siteLayout) {
    const issues = validateSiteLayout(prepared.siteLayout);
    if (issues.length || !Number.isFinite(prepared.demoTraffic.radiusM) || prepared.demoTraffic.radiusM < POD_RADIUS_M || !Number.isFinite(prepared.demoTraffic.clearanceM) || prepared.demoTraffic.clearanceM < 0.15 || prepared.siteLayout.routingGraph!.clearanceM < prepared.demoTraffic.radiusM + 0.05 - 1e-8) throw new Error("Повреждён подготовленный подстеллажный план");
    validateUnderliftConfig(prepared.siteLayout,prepared.demoUnderlift);
    if (prepared.demoTraffic.parkingBays.length < input.robots.count) throw new Error("Для нового парка повторите подготовку по исходному плану");
    const copy = structuredClone(prepared);
    copy.demoTraffic.initialPositions = copy.demoTraffic.parkingBays.slice(0, input.robots.count);
    copy.demoTraffic.maxActiveRoutes = input.robots.count;
    return copy;
  }
  if (input.siteLayout) {
    const issues = validateProjectSiteLayout(input.siteLayout);
    if (issues.length) throw new Error(`Неподдерживаемый исходный план: ${issues.join("; ")}`);
  }
  const { layout, config: underlift } = buildClosedPodLayout(input.layout, input.siteLayout);
  const graph = layout.routingGraph!, radiusM = POD_RADIUS_M, clearanceM = 0.15, spacing = radiusM * 2 + clearanceM;
  const baseNodes = [...graph.nodes], indices = new Map(baseNodes.map((n) => [n.id, n]));
  const baseEdges = graph.edges.map((e) => [indices.get(e.from)!, indices.get(e.to)!] as const);
  const bays: TrafficPoint[] = [], entries: TrafficPoint[][] = [];
  const desired = input.robots.count + Math.min(20, input.robots.count);
  const add = (p: TrafficPoint) => {
    const same = graph.nodes.find((n) => Math.abs(n.x - p.x) < EPS && Math.abs(n.y - p.y) < EPS);
    if (same) return same.id;
    const id = `parking-${graph.nodes.length}`; graph.nodes.push({ ...p, id }); return id;
  };
  // A genuine second lane in wide, obstacle-free corridors. Narrow doors get no bypass.
  // Keep the physical geometry fixed; every extra segment uses the same wall/body validator.
  const doorEdge = (a: TrafficPoint, b: TrafficPoint) => (layout.doors ?? []).some((d) => segmentDistance(a, b, { x: d.x + d.w / 2, y: d.y + d.h / 2 }, { x: d.x + d.w / 2, y: d.y + d.h / 2 }) < Math.max(d.w, d.h) / 2 + 1);
  for (const [a, b] of [...baseEdges].sort(([a, b], [c, d]) => Number(doorEdge(c, d)) - Number(doorEdge(a, b)) || Math.hypot(d.x - c.x, d.y - c.y) - Math.hypot(b.x - a.x, b.y - a.y))) {
    if (graph.nodes.length >= 320 || Math.hypot(b.x - a.x, b.y - a.y) < 5) continue;
    for (const sign of [-1, 1]) {
      if (graph.nodes.length >= 320) break;
      const dx = a.x === b.x ? sign * 2.2 : 0, dy = a.y === b.y ? sign * 2.2 : 0;
      const p = { x: a.x + dx, y: a.y + dy }, q = { x: b.x + dx, y: b.y + dy };
      if (![ [a, p], [p, q], [q, b] ].every(([u, v]) => siteSegmentIsClear(layout, u!, v!))) continue;
      const first = add(p), second = add(q);
      graph.edges.push({ from: a.id, to: first }, { from: first, to: second }, { from: second, to: b.id });
    }
  }
  const laneIndex = new Map(graph.nodes.map((n) => [n.id, n]));
  const laneEdges = graph.edges.map((e) => [laneIndex.get(e.from)!, laneIndex.get(e.to)!] as const);
  const parkingBase = { nodes: [...graph.nodes], edges: [...graph.edges] };
  const stockBounds = underlift.docks.filter(d => layout.slots.some(p => Math.hypot(p.x - d.x, p.y - d.y) < EPS)).map(d => orientedBounds(d, 1.4, 1, d.heading));
  const acceptBay = (node: typeof graph.nodes[number], elbow: TrafficPoint, bay: TrafficPoint): boolean => {
    if (bays.length >= desired || graph.nodes.length > 8190) return false;
    const entry = [node, elbow, bay];
    if (!siteSegmentIsClear(layout, node, elbow) || !siteSegmentIsClear(layout, elbow, bay)) return false;
    if (laneEdges.some(([a, b]) => pointSegmentDistance(bay, a, b) < spacing)) return false;
    if ([...layout.receiving, ...layout.shipping, ...layout.chargers].some((p) => Math.hypot(p.x - bay.x, p.y - bay.y) < spacing * 2)) return false;
    const entryBounds = [node, elbow, bay].map(p => orientedBounds(p, ROBOT_LENGTH_M, ROBOT_WIDTH_M, 0));
    if (stockBounds.some(fixed => entryBounds.some(box => rectangleGap(box, fixed) < .15 - EPS))) return false;
    if (bays.some((p) => Math.hypot(p.x - bay.x, p.y - bay.y) < spacing || traceDistance([p], entry) < spacing) || entries.some((path) => traceDistance([bay], path) < spacing)) return false;
    const middle = add(elbow), end = add(bay);
    if (node.id !== middle) graph.edges.push({ from: node.id, to: middle });
    if (middle !== end) graph.edges.push({ from: middle, to: end });
    bays.push(bay); entries.push(entry); return true;
  };
  const legacyBays = () => {
    for (const node of [...baseNodes].sort((a,b)=>Math.min(...[...layout.receiving,...layout.shipping,...layout.chargers].map(p=>Math.hypot(p.x-a.x,p.y-a.y)))-Math.min(...[...layout.receiving,...layout.shipping,...layout.chargers].map(p=>Math.hypot(p.x-b.x,p.y-b.y))))) for (const dx of [-2.2, 2.2, -4.4, 4.4]) for (const dy of [-2.2, 2.2, -4.4, 4.4]) {
      acceptBay(node, { x: node.x + dx, y: node.y }, { x: node.x + dx, y: node.y + dy });
    }
  };
  // Long dock lanes have usable floor between their sparse operation nodes, too.
  // Attach each real bay to that existing segment; never move a task, wall or storage slot.
  const lateralBays = () => { for (const [a, b] of laneEdges) {
    const length = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    for (let offset = 2.2; offset < length - 1e-8 && bays.length < desired; offset += 2.2) {
      const p = { x: a.x + (b.x - a.x) * offset / length, y: a.y + (b.y - a.y) * offset / length };
      for (const sign of [-1, 1]) {
        const bay = { x: p.x + (a.x === b.x ? sign * 2.2 : 0), y: p.y + (a.y === b.y ? sign * 2.2 : 0) };
        const anchor = { ...p, id: graph.nodes.find(n => Math.abs(n.x - p.x) < EPS && Math.abs(n.y - p.y) < EPS)?.id ?? `parking-${graph.nodes.length}` };
        const previous = graph.nodes.length;
        if (!acceptBay(anchor, p, bay)) continue;
        if (anchor.id === `parking-${previous}`) graph.edges.push({ from: a.id, to: anchor.id }, { from: anchor.id, to: b.id });
      }
    }
  } };
  legacyBays(); lateralBays();
  if (bays.length < input.robots.count) {
    // Long L-shaped entries can consume valid short bays. Retry the same floor with short entries first.
    graph.nodes = [...parkingBase.nodes]; graph.edges = [...parkingBase.edges]; bays.length = 0; entries.length = 0;
    lateralBays(); legacyBays();
  }
  if (bays.length < input.robots.count) throw new Error(`Для ${input.robots.count} роботов недостаточно безопасных парковок: доступно ${bays.length}. Уменьшите парк или увеличьте объект.`);
  const issues = validateSiteLayout(layout);
  if (issues.length) throw new Error(`Непроходимая схема движения: ${issues.join("; ")}`);
  return { ...input, siteLayout: layout, demoUnderlift: underlift, demoIncidents: defaultDemoIncidents("warehouse", input.robots.count), demoTraffic: { version: "traffic-2.0.0", radiusM, clearanceM, maxActiveRoutes: input.robots.count, initialPositions: bays.slice(0, input.robots.count), parkingBays: bays, dispatchPolicy: { ...DISPATCH_POLICY } } };
}

export function isTrafficInput(input: SimInput): input is DemoTrafficInput { return "demoTraffic" in input; }
export function isWarehouseTrafficState(state: SimEngineState): state is WarehouseTrafficState { return "demoTraffic" in state; }
export function createWarehouseTrafficState(input: DemoTrafficInput): WarehouseTrafficState {
  if(input.demoUnderlift&&(input.demoTraffic.radiusM<POD_RADIUS_M||input.demoTraffic.clearanceM<0.15||!Number.isFinite(input.demoTraffic.radiusM)||!Number.isFinite(input.demoTraffic.clearanceM)))throw new Error("Недостаточный защитный габарит подстеллажного механизма");
  const state = createSim(structuredClone(input)) as WarehouseTrafficState;
  if (state.precheck !== "ok") throw new Error(`Недопустимый вход: ${state.precheck}`);
  state.robots.forEach((r, i) => { const p = input.demoTraffic.initialPositions[i]; if (!p) throw new Error("Нет парковки для робота"); r.x = p.x; r.y = p.y; });
  state.demoTraffic = createTrafficController(state.robots, input.demoTraffic.radiusM, input.demoTraffic.clearanceM);
  state.routeCommitments = [];state.dockAccess=createDockAccess(input.demoTraffic.radiusM*2+input.demoTraffic.clearanceM);
  state.demoIncidents = createIncidentRuntime(input.demoIncidents, state.robots.length);
  state.assessmentFacts = { zeroSocOperationRobotSeconds: 0 };
  if (input.demoUnderlift) initUnderlift(state, input.demoUnderlift);
  for (const r of state.robots) Object.assign(r, { safety: state.demoTraffic.bodies[r.id] });
  updateIncidents(state);
  return state;
}

export function pathSlice(path: TrafficPoint[], from: number, to: number): TrafficPoint[] {
  const out = [positionAlong(path, from)]; let distance = 0;
  for (let i = 1; i < path.length; i++) { distance += Math.abs(path[i]!.x - path[i - 1]!.x) + Math.abs(path[i]!.y - path[i - 1]!.y); if (distance > from + EPS && distance < to - EPS) out.push({ ...path[i]! }); }
  out.push(positionAlong(path, to)); return out;
}

type FloorGrid = { cell: number; x0: number; y0: number; width: number; height: number; free: Int8Array; right: Int8Array; up: Int8Array };
const floorGrids = new WeakMap<SimLayout, FloorGrid>();

/** This fallback routes over accessible floor, not just the sparse traffic lanes.
 * At most ~40k static cells / 12k A* expansions; failure still means a safe wait.
 * The immutable static geometry is cached; moving robot discs are checked afresh.
 */
function floorRoute(layout: SimLayout, from: TrafficPoint, to: TrafficPoint, clear: (a: TrafficPoint, b: TrafficPoint) => boolean): TrafficPoint[] | null {
  const polygon = layout.footprint;
  if (!polygon || !siteSegmentIsClear(layout, from, from) || !siteSegmentIsClear(layout, to, to)) return null;
  const margin = layout.routingGraph?.clearanceM ?? 0;
  const staticClear = (a: TrafficPoint, b: TrafficPoint) => siteSegmentIsClear(layout, a, b) && polygon.every((p, i) => segmentDistance(a, b, p, polygon[(i + 1) % polygon.length]!) >= margin - EPS);
  if (!staticClear(from, from) || !staticClear(to, to)) return null;
  let grid = floorGrids.get(layout);
  if (!grid) {
    const x0 = Math.min(...polygon.map((p) => p.x)), y0 = Math.min(...polygon.map((p) => p.y));
    const w = Math.max(...polygon.map((p) => p.x)) - x0, h = Math.max(...polygon.map((p) => p.y)) - y0;
    const cell = Math.max(0.8, Math.sqrt(w * h / 39000)), width = Math.floor(w / cell) + 1, height = Math.floor(h / cell) + 1;
    if (!Number.isFinite(cell) || width * height > 41000 || width < 2 || height < 2) return null;
    grid = { cell, x0, y0, width, height, free: new Int8Array(width * height), right: new Int8Array(width * height), up: new Int8Array(width * height) };
    floorGrids.set(layout, grid);
  }
  const { width, height, cell, x0, y0 } = grid;
  const point = (i: number) => ({ x: x0 + (i % width) * cell, y: y0 + Math.floor(i / width) * cell });
  // 0 = unexamined, +1 = free, -1 = blocked. A short escape need not scan the whole floor.
  const free = (i: number) => { if (!grid.free[i]) grid.free[i] = staticClear(point(i), point(i)) ? 1 : -1; return grid.free[i] === 1; };
  const edgeClear = (a: number, b: number, edges: Int8Array, index: number) => {
    if (!edges[index]) edges[index] = free(a) && free(b) && staticClear(point(a), point(b)) ? 1 : -1;
    return edges[index] === 1;
  };
  const connector = (a: TrafficPoint, b: TrafficPoint): TrafficPoint[] | null => {
    for (const corner of [{ x: a.x, y: b.y }, { x: b.x, y: a.y }]) if (staticClear(a, corner) && staticClear(corner, b) && clear(a, corner) && clear(corner, b)) return [a, corner, b];
    return null;
  };
  const connections = (p: TrafficPoint, reverse: boolean) => {
    const found = new Map<number, TrafficPoint[]>(), x = Math.floor((p.x - x0) / cell), y = Math.floor((p.y - y0) / cell);
    for (const xx of [x, x + 1]) for (const yy of [y, y + 1]) if (xx >= 0 && xx < width && yy >= 0 && yy < height) {
      const i = yy * width + xx;
      if (free(i)) { const path = reverse ? connector(point(i), p) : connector(p, point(i)); if (path) found.set(i, path); }
    }
    return found;
  };
  const starts = connections(from, false), goals = connections(to, true);
  if (!starts.size || !goals.size) return null;
  const size = width * height, costs = new Float64Array(size).fill(Infinity), previous = new Int32Array(size).fill(-1), closed = new Uint8Array(size);
  const heap: { i: number; f: number }[] = [];
  const push = (i: number, f: number) => { let j = heap.length; heap.push({ i, f }); while (j) { const k = (j - 1) >> 1; if (heap[k]!.f <= f) break; heap[j] = heap[k]!; j = k; } heap[j] = { i, f }; };
  const pop = () => { const first = heap[0]!, last = heap.pop()!; if (heap.length) { let j = 0; while (j * 2 + 1 < heap.length) { let k = j * 2 + 1; if (k + 1 < heap.length && heap[k + 1]!.f < heap[k]!.f) k++; if (heap[k]!.f >= last.f) break; heap[j] = heap[k]!; j = k; } heap[j] = last; } return first.i; };
  const heuristic = (i: number) => { const p = point(i); return Math.abs(p.x - to.x) + Math.abs(p.y - to.y); };
  for (const [i, path] of starts) { costs[i] = routeLengthM(path); push(i, costs[i]! + heuristic(i)); }
  let expanded = 0;
  while (heap.length && expanded < 12000) {
    const i = pop(); if (closed[i]) continue; closed[i] = 1; expanded++;
    if (goals.has(i)) {
      const indices = [i]; while (previous[indices[indices.length - 1]!]! >= 0) indices.push(previous[indices[indices.length - 1]!]!);
      indices.reverse();
      const raw = [...starts.get(indices[0]!)!, ...indices.slice(1).map(point), ...goals.get(i)!.slice(1)], path: TrafficPoint[] = [];
      for (const p of raw) {
        const a = path[path.length - 2], b = path[path.length - 1];
        if (b && Math.hypot(p.x - b.x, p.y - b.y) < EPS) continue;
        if (a && b && ((Math.abs(a.x - b.x) < EPS && Math.abs(b.x - p.x) < EPS) || (Math.abs(a.y - b.y) < EPS && Math.abs(b.y - p.y) < EPS))) path.pop();
        path.push({ x: p.x, y: p.y });
      }
      return path;
    }
    const p = point(i), neighbors: number[] = [];
    if (i % width && edgeClear(i, i - 1, grid.right, i - 1)) neighbors.push(i - 1);
    if (i % width < width - 1 && edgeClear(i, i + 1, grid.right, i)) neighbors.push(i + 1);
    if (i >= width && edgeClear(i, i - width, grid.up, i - width)) neighbors.push(i - width);
    if (i + width < size && edgeClear(i, i + width, grid.up, i)) neighbors.push(i + width);
    for (const next of neighbors) if (!closed[next] && costs[i]! + cell < costs[next]! - EPS && clear(p, point(next))) {
      costs[next] = costs[i]! + cell; previous[next] = i; push(next, costs[next]! + heuristic(next));
    }
  }
  return null;
}

/** Sparse graph A* first, bounded accessible-floor A* if lane connectivity is blocked. */
export function freeGraphRoute(layout: SimLayout, from: TrafficPoint, to: TrafficPoint, others: Body[], spacing: number, stockClear: (a:TrafficPoint,b:TrafficPoint)=>boolean = ()=>true): TrafficPoint[] | null {
  if (others.some((p) => Math.hypot(p.x - to.x, p.y - to.y) < spacing - EPS)) return null;
  const graph = layout.routingGraph!, nodes = [...graph.nodes, { ...from, id: "traffic-start" }], start = nodes.length - 1;
  const byId = new Map(nodes.map((n, i) => [n.id, i]));
  const adjacent = nodes.map(() => [] as { node: number; edge: number }[]);
  const edgeChecks = new Int8Array(graph.edges.length);
  const buckets = new Map<string, Body[]>();
  for (const p of others) { const key = `${Math.floor(p.x / 8)},${Math.floor(p.y / 8)}`; buckets.set(key, [...(buckets.get(key) ?? []), p]); }
  const clear = (a: TrafficPoint, b: TrafficPoint) => {
    if (!stockClear(a,b)) return false;
    for (let x = Math.floor((Math.min(a.x, b.x) - spacing) / 8); x <= Math.floor((Math.max(a.x, b.x) + spacing) / 8); x++) for (let y = Math.floor((Math.min(a.y, b.y) - spacing) / 8); y <= Math.floor((Math.max(a.y, b.y) + spacing) / 8); y++) for (const p of buckets.get(`${x},${y}`) ?? []) if (pointSegmentDistance(p, a, b) < spacing - EPS) return false;
    return true;
  };
  for (const [edge, e] of graph.edges.entries()) {
    const a = byId.get(e.from)!, b = byId.get(e.to)!;
    // Validate a base link only if A* reaches it, retaining the original neighbour order.
    adjacent[a]!.push({ node: b, edge }); adjacent[b]!.push({ node: a, edge });
    if (pointSegmentDistance(from, nodes[a]!, nodes[b]!) < EPS) for (const end of [a, b]) if (clear(from, nodes[end]!)) { adjacent[start]!.push({ node: end, edge: -1 }); adjacent[end]!.push({ node: start, edge: -1 }); }
    // From the middle of a blocked lane, enter a genuinely free parallel lane laterally.
    const u = nodes[a]!, v = nodes[b]!;
    const p = u.x === v.x ? { x: u.x, y: from.y } : { x: from.x, y: u.y };
    if (pointSegmentDistance(p, u, v) < EPS && Math.hypot(p.x - from.x, p.y - from.y) > EPS && Math.hypot(p.x - from.x, p.y - from.y) <= 4.5 && siteSegmentIsClear(layout, from, p) && clear(from, p)) {
      const i = nodes.length; nodes.push({ ...p, id: `lateral-${i}` }); adjacent.push([{ node: start, edge: -1 }]); adjacent[start]!.push({ node: i, edge: -1 });
      for (const end of [a, b]) if (clear(p, nodes[end]!)) { adjacent[i]!.push({ node: end, edge: -1 }); adjacent[end]!.push({ node: i, edge: -1 }); }
    }
  }
  const target = nodes.findIndex((n) => Math.abs(n.x - to.x) < EPS && Math.abs(n.y - to.y) < EPS);
  if (!clear(to, to)) return null;
  if (target < 0) return floorRoute(layout, from, to, clear);
  const open = new Set([start]), cost = new Map([[start, 0]]), previous = new Map<number, number>();
  while (open.size) {
    let current = -1, score = Infinity;
    for (const i of open) { const p = nodes[i]!, f = cost.get(i)! + Math.abs(p.x - to.x) + Math.abs(p.y - to.y); if (f < score) { current = i; score = f; } }
    if (current === target) {
      const found = [target]; while (found[found.length - 1] !== start) found.push(previous.get(found[found.length - 1]!)!);
      return found.reverse().map((i) => ({ x: nodes[i]!.x, y: nodes[i]!.y }));
    }
    open.delete(current);
    for (const link of adjacent[current]!) {
      if (link.edge >= 0) {
        if (!edgeChecks[link.edge]) {
          const edge = graph.edges[link.edge]!;
          edgeChecks[link.edge] = clear(nodes[byId.get(edge.from)!]!, nodes[byId.get(edge.to)!]!) ? 1 : -1;
        }
        if (edgeChecks[link.edge]! < 0) continue;
      }
      const next = link.node;
      const a = nodes[current]!, b = nodes[next]!, value = cost.get(current)! + Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      if (value < (cost.get(next) ?? Infinity)) { cost.set(next, value); previous.set(next, current); open.add(next); }
    }
  }
  return floorRoute(layout, from, to, clear);
}

function movingLeg(state: WarehouseTrafficState, robot: WarehouseTrafficState["robots"][number]): string | null {
  if (incidentHalts(state, robot.id)) return null;
  if (state.demoTraffic.bodies[robot.id]!.parking) return "parking";
  return ["toPickup", "toDrop", "toCharger"].includes(robot.phase) ? `${robot.phase}:${robot.task?.id ?? "charge"}` : null;
}

function releaseRouteCommitments(state: WarehouseTrafficState) {
  state.routeCommitments = state.routeCommitments.filter((c) => {
    const robot = state.robots[c.robotId]!, partner = state.robots[c.partnerId]!, spacing = state.demoTraffic.bodies[robot.id]!.safeCenterDistanceM;
    if (!movingLeg(state, robot) || movingLeg(state, robot) !== c.leg || movingLeg(state, partner) !== c.partnerLeg) return false;
    return c.travelledM < spacing * 2 || Math.hypot(robot.x - partner.x, robot.y - partner.y) < spacing * 2;
  });
}

function commitDetour(state: WarehouseTrafficState, robotId: number, partnerId: number | null) {
  if (partnerId === null || partnerId < 0 || state.routeCommitments.some((c) => [c.robotId, c.partnerId].includes(robotId) || [c.robotId, c.partnerId].includes(partnerId))) return;
  const leg = movingLeg(state, state.robots[robotId]!), partnerLeg = movingLeg(state, state.robots[partnerId]!);
  if (leg && partnerLeg) state.routeCommitments.push({ robotId, partnerId, leg, partnerLeg, travelledM: 0 });
}

function selectReplanCandidate(state: WarehouseTrafficState): number | null {
  const input = state.input as DemoTrafficInput, policy = input.demoTraffic.dispatchPolicy;
  if (!policy) return null;
  const eligible = state.robots.filter(r => {
    const b = state.demoTraffic.bodies[r.id]!;
    return movingLeg(state, r) !== null && b.waitS >= 2 && state.tS - b.lastReplanS >= policy.replanMinIntervalS &&
      !state.routeCommitments.some(c => c.partnerId === r.id && c.robotId === b.blockedBy);
  }).sort((a, b) => {
    const x = state.demoTraffic.bodies[a.id]!, y = state.demoTraffic.bodies[b.id]!;
    return (x.lastReplanS - y.lastReplanS) || (y.waitS - x.waitS) || a.id - b.id;
  });
  return eligible[0]?.id ?? null;
}

function takeReplanTurn(state: WarehouseTrafficState, robotId: number): boolean {
  const policy = (state.input as DemoTrafficInput).demoTraffic.dispatchPolicy;
  if (!policy) return robotId === Math.floor(state.demoTraffic.tS) % state.robots.length;
  if (state.demoTraffic.replansThisTick >= policy.replanBudgetPerTick || state.demoTraffic.replanCandidateId !== robotId) return false;
  state.demoTraffic.replansThisTick++;
  return true;
}

function prepareCarrierRoute(state:WarehouseTrafficState,robot:SimEngineState["robots"][number]) {
  return prepareUnderliftRoute(state, robot, (from,entry) => freeGraphRoute(state.layout,from,entry,state.robots.filter(r=>r.id!==robot.id),state.demoTraffic.radiusM*2+state.demoTraffic.clearanceM,(a,b)=>stockRouteIsClear(state,robot,a,b)&&dockPathAllowed(state.dockAccess,robot.id,[a,b])));
}
/** Reverse without yawing, then let ordinary A* restart from a certified turn-clear point. */
export function tryReverseRetreat(state: WarehouseTrafficState, robot: SimEngineState["robots"][number]): boolean {
  const lift = robot.underlift;
  if (!lift || !["toPickup", "toDrop"].includes(robot.phase) ||
      ["extract", "exit", "retreat"].includes(lift.stage) || stockRouteIsClear(state, robot, robot, robot)) return false;

  const dx = Math.abs(Math.cos(lift.headingRad)) > .5 ? Math.sign(Math.cos(lift.headingRad)) : 0;
  const dy = Math.abs(Math.sin(lift.headingRad)) > .5 ? Math.sign(Math.sin(lift.headingRad)) : 0;
  const spacing = state.demoTraffic.radiusM * 2 + state.demoTraffic.clearanceM;
  const others = warehouseObstacles(state, robot.id);
  const start = { x: robot.x, y: robot.y };
  const probe = { ...robot, underlift: { ...lift, stage: "retreat" as const } };

  // Bounded local recovery: ten 20 cm candidates, with the original orientation throughout.
  for (let step = 1; step <= 10; step++) {
    const back = { x: start.x - dx * step * .2, y: start.y - dy * step * .2 };
    if (!siteSegmentIsClear(state.layout, start, back) ||
        !stockSweepIsClear(state, probe, [start, back], true) ||
        !dockPathAllowed(state.dockAccess, robot.id, [start, back]) ||
        others.some(body => pointSegmentDistance(body, start, back) < spacing - EPS)) break;
    if (!stockRouteIsClear(state, { ...robot, ...back }, back, back)) continue;

    // The tail preserves task identity for the base engine; it cannot be driven until replanned.
    const oldTail = pathSlice(robot.path, robot.distM, robot.pathLenM);
    robot.path = [start, back, ...oldTail];
    robot.pathLenM = routeLengthM(robot.path);
    robot.distM = 0;
    lift.stage = "retreat";
    lift.retreatUntilM = Math.hypot(back.x - start.x, back.y - start.y);
    lift.extractionUntilM = undefined;
    lift.routeStage = robot.phase === "toPickup" ? "pickup" : "drop";
    return true;
  }
  return false;
}

function approachingDock(state:WarehouseTrafficState,robot:SimEngineState["robots"][number],nextDistance:number):boolean {
 const task=robot.task,u=robot.underlift;if(!task||!u||!["toPickup","toDrop"].includes(robot.phase))return true;
 const pickup=robot.phase==="toPickup",point=pickup?{x:task.fromX,y:task.fromY}:{x:task.toX,y:task.toY},dock=dockOf(state,point,EPS);
 const proposed=pathSlice(robot.path,robot.distM,nextDistance),probe={spacingM:state.dockAccess.spacingM,grants:[{robotId:-1,key:"probe",center:point,entry:dock.entry}],waiters:[],nextSequence:0};
 if(dockPathAllowed(probe,robot.id,proposed))return true;
 const granted=requestDock(state.dockAccess,{robotId:robot.id,key:`${task.id}:${pickup?"pickup":"drop"}`,center:point,entry:dock.entry,tS:state.tS},state.robots);
 if(!granted){const body=state.demoTraffic.bodies[robot.id]!,blocker=state.dockAccess.grants.find(g=>g.robotId!==robot.id&&!dockPathAllowed({...state.dockAccess,grants:[g]},robot.id,[point,dock.entry]));body.blocked=true;body.status="waiting";body.blockedBy=blocker?.robotId??state.robots.find(r=>r.id!==robot.id&&dockDistance(r,{center:point,entry:dock.entry})<state.dockAccess.spacingM-EPS)?.id??null;body.reason="Ожидание освобождения подстеллажного заезда";if(body.blockedAtS!==state.tS){body.waitS++;body.totalWaitS++;body.blockedAtS=state.tS;}}
 return granted;
}
const warehouseGate: SimMovementGate = (plain, robot, nextDistance) => {
  const state = plain as WarehouseTrafficState, control = state.demoTraffic;
  if (robot.underlift?.stage === "retreat" && robot.distM >= (robot.underlift.retreatUntilM ?? Infinity) - EPS) {
    robot.underlift.stage = robot.phase === "toPickup" ? "approach" : "carry";
    robot.underlift.routeStage = undefined;
    robot.underlift.retreatUntilM = undefined;
  }
  if (!prepareCarrierRoute(state,robot)) {
    const body=control.bodies[robot.id]!;
    if(takeReplanTurn(state,robot.id))body.lastReplanS=control.tS;
    body.blocked=true;body.status="waiting";body.reason="Ожидание свободного прямого подстеллажного заезда";body.waitS++;body.totalWaitS++;return false;
  }
  const safety = control.bodies[robot.id]!;
  if (safety.yieldDistanceM !== null && robot.distM >= safety.yieldDistanceM - EPS) {
    safety.yieldStartedS ??= control.tS;
    const others = warehouseObstacles(state, robot.id), goal = robot.path[robot.path.length - 1]!;
    if (control.tS - safety.yieldStartedS >= 5 && takeReplanTurn(state, robot.id)) {
      if ((state.input as DemoTrafficInput).demoTraffic.dispatchPolicy) safety.lastReplanS = control.tS;
      if(robot.underlift) {
        cancelDockRequest(state.dockAccess,robot.id);
      const previousStage=robot.underlift.routeStage;robot.underlift.routeStage=undefined;
        if(prepareCarrierRoute(state,robot)){safety.yieldDistanceM=null;safety.yieldStartedS=null;}else robot.underlift.routeStage=previousStage;
      } else {
        const resumed = freeGraphRoute(state.layout, robot, goal, others, safety.safeCenterDistanceM,(a,b)=>stockRouteIsClear(state,robot,a,b)&&dockPathAllowed(state.dockAccess,robot.id,[a,b]));
        if (resumed) { robot.path = resumed; robot.pathLenM = routeLengthM(resumed); robot.distM = 0; safety.yieldDistanceM = null; safety.yieldStartedS = null; }
      }
    }
    safety.blocked = true; safety.status = "waiting"; safety.reason = "Уступает проезд: ожидание в парковочном кармане";
    safety.waitS++; safety.totalWaitS++; safety.blockedAtS = control.tS; return false;
  }
  let cappedDistance = safety.yieldDistanceM === null ? nextDistance : Math.min(nextDistance, safety.yieldDistanceM);
  if(robot.underlift?.stage==="retreat")cappedDistance=Math.min(cappedDistance,robot.underlift.retreatUntilM!);
  if(robot.underlift?.stage==="extract"&&robot.distM<(robot.underlift.extractionUntilM??0)-EPS)cappedDistance=Math.min(cappedDistance,robot.underlift.extractionUntilM!);
  if(robot.underlift&&robot.pathLenM-robot.distM>2+EPS)cappedDistance=Math.min(cappedDistance,robot.pathLenM-2);
  if (approachingDock(state,robot,cappedDistance)&&reserveWarehouseMotion(state, robot.id, pathSlice(robot.path, robot.distM, cappedDistance))) return cappedDistance;
  if(robot.underlift&&(robot.pathLenM-robot.distM<=2+EPS||robot.underlift.stage==="extract"||robot.underlift.stage==="retreat"))return false;
  const replanInterval = (state.input as DemoTrafficInput).demoTraffic.dispatchPolicy?.replanMinIntervalS ?? 10;
  if (safety.waitS >= 2 && control.tS - safety.lastReplanS >= replanInterval && takeReplanTurn(state, robot.id)) {
    // One side keeps its detour; simultaneous mirrored replans can circle indefinitely.
    if (state.routeCommitments.some((c) => c.partnerId === robot.id && c.robotId === safety.blockedBy)) return false;
    safety.lastReplanS = control.tS;
    if (!(state.input as DemoTrafficInput).demoTraffic.dispatchPolicy) control.replansThisTick++;
    if(robot.underlift) {
      cancelDockRequest(state.dockAccess,robot.id);
      const previousStage=robot.underlift.routeStage;robot.underlift.routeStage=undefined;
      if(prepareCarrierRoute(state,robot)){safety.replans++;control.detours++;safety.reason="Перестроен маршрут к прямому подстеллажному заезду";return false;}
      robot.underlift.routeStage=previousStage;
      if(tryReverseRetreat(state,robot)){safety.replans++;control.detours++;safety.reason="Безопасный отход задним ходом до места поворота";return false;}
      if(safety.blockedBy!==null&&(robot.id>safety.blockedBy||state.dockAccess.grants.some(g=>g.robotId===safety.blockedBy))) {
        const goal=robot.path.at(-1)!,input=state.input as DemoTrafficInput,spacing=safety.safeCenterDistanceM;
        const bays=input.demoTraffic.parkingBays.filter(p=>Math.hypot(p.x-robot.x,p.y-robot.y)>spacing&&!input.demoTraffic.initialPositions.some((h,id)=>id!==robot.id&&Math.hypot(h.x-p.x,h.y-p.y)<EPS)).sort((a,b)=>Math.hypot(a.x-robot.x,a.y-robot.y)-Math.hypot(b.x-robot.x,b.y-robot.y));
        for(const bay of bays.slice(0,4)) {
          const prefix=freeGraphRoute(state.layout,robot,bay,warehouseObstacles(state,robot.id),spacing,(a,b)=>stockRouteIsClear(state,robot,a,b)&&dockPathAllowed(state.dockAccess,robot.id,[a,b]));
          if(!prefix)continue;
          const tail=route(state.layout,bay,goal);robot.path=[...prefix,...tail.slice(1)];robot.pathLenM=routeLengthM(robot.path);robot.distM=0;robot.underlift.routeStage=robot.phase==="toPickup"?"pickup":"drop";
          safety.yieldDistanceM=routeLengthM(prefix);safety.yieldStartedS=null;safety.replans++;control.detours++;commitDetour(state,robot.id,safety.blockedBy);break;
        }
      }
      return false;
    }
    const goal = robot.path[robot.path.length - 1]!, others = warehouseObstacles(state, robot.id), spacing = control.radiusM * 2 + control.clearanceM;
    let detour = freeGraphRoute(state.layout, robot, goal, others, spacing,(a,b)=>stockRouteIsClear(state,robot,a,b)&&dockPathAllowed(state.dockAccess,robot.id,[a,b]));
    // If the goal is occupied, pull into a free off-route bay while preserving the actual task goal.
    if (!detour && (robot.id > (safety.blockedBy ?? Infinity)||state.dockAccess.grants.some(g=>g.robotId===safety.blockedBy))) {
      const input = state.input as DemoTrafficInput;
      const bays = input.demoTraffic.parkingBays.filter((p) => Math.hypot(p.x - robot.x, p.y - robot.y) > spacing && !input.demoTraffic.initialPositions.some((home, id) => id !== robot.id && Math.hypot(p.x - home.x, p.y - home.y) < EPS)).sort((a, b) => Math.hypot(a.x - robot.x, a.y - robot.y) - Math.hypot(b.x - robot.x, b.y - robot.y));
      for (const bay of bays.slice(0, 2)) {
        const prefix = freeGraphRoute(state.layout, robot, bay, others, spacing,(a,b)=>stockRouteIsClear(state,robot,a,b)&&dockPathAllowed(state.dockAccess,robot.id,[a,b]));
        if (prefix) { detour = [...prefix, ...route(state.layout, bay, goal).slice(1)]; safety.yieldDistanceM = routeLengthM(prefix); safety.yieldStartedS = null; break; }
      }
    }
    if (detour && routeLengthM(detour) > EPS) { commitDetour(state, robot.id, safety.blockedBy); robot.path = detour; robot.distM = 0; robot.pathLenM = routeLengthM(detour); safety.replans++; control.detours++; safety.reason = "Защитная остановка: найден объезд по свободным проходам"; }
  }
  return false;
};

function warehouseObstacles(state: WarehouseTrafficState, robotId: number): Body[] {
  return state.robots.filter(r => r.id !== robotId);
}
function reserveWarehouseMotion(state: WarehouseTrafficState, robotId: number, path: TrafficPoint[]): boolean {
  const robot=state.robots.find(r=>r.id===robotId)!;
  if(!dockPathAllowed(state.dockAccess,robotId,path)){const body=state.demoTraffic.bodies[robotId]!;body.blocked=true;body.status="waiting";body.blockedBy=state.dockAccess.grants.find(g=>g.robotId!==robotId&&!dockPathAllowed({...state.dockAccess,grants:[g]},robotId,path))?.robotId??null;body.reason="Ожидание освобождения подстеллажного заезда и выезда";if(body.blockedAtS!==state.tS){body.waitS++;body.totalWaitS++;body.blockedAtS=state.tS;}return false;}
  if(!stockSweepIsClear(state,robot,path)) {
    const body=state.demoTraffic.bodies[robotId]!;body.blocked=true;body.status="waiting";body.blockedBy=null;body.reason="Защитная остановка: прямоугольный габарит стеллажа или место поворота заняты";
    if(body.blockedAtS!==state.demoTraffic.tS){body.waitS+=state.demoTraffic.dtS;body.totalWaitS+=state.demoTraffic.dtS;body.blockedAtS=state.demoTraffic.tS;}return false;
  }
  return reserveTrafficMotion(state.demoTraffic, robotId, path);
}
const warehouseHandlingGate: SimHandlingGate = (plain, robot, dt) => underliftHandling(plain as WarehouseTrafficState, robot, dt,
  (body, next) => reserveWarehouseMotion(plain as WarehouseTrafficState, body.id, pathSlice(body.path, body.distM, next)));

function occupiesRoute(state: WarehouseTrafficState, robot: SimEngineState["robots"][number]): boolean {
  const input = state.input as DemoTrafficInput;
  if (input.demoTraffic.dispatchPolicy) return robot.task !== null || robot.phase === "toCharger";
  const home = input.demoTraffic.initialPositions[robot.id]!;
  return robot.phase !== "idle" || Math.hypot(robot.x - home.x, robot.y - home.y) > EPS;
}

const pickupReservations = new WeakMap<WarehouseTrafficState, { tS: number; head: number; points: Map<string, boolean> }>();
function pickupIsReserved(state: WarehouseTrafficState, task: SimTask): boolean {
  let cache = pickupReservations.get(state);
  // Dispatch precedes movement; head changes on each assignment, time on each physical step.
  if (!cache || cache.tS !== state.tS || cache.head !== state.head) {
    cache = { tS: state.tS, head: state.head, points: new Map() }; pickupReservations.set(state, cache);
  }
  const key = `${task.fromX};${task.fromY}`, cached = cache.points.get(key);
  if (cached !== undefined) return cached;
  const reserved = state.robots.some(r => r.task && ((!r.loaded && Math.hypot(r.task.fromX - task.fromX, r.task.fromY - task.fromY) < 0.01) || Math.hypot(r.task.toX - task.fromX, r.task.toY - task.fromY) < 0.01));
  cache.points.set(key, reserved);
  return reserved;
}

const warehouseDispatchGate: SimDispatchGate = (plain, robot, task) => {
  const state = plain as WarehouseTrafficState, input = state.input as DemoTrafficInput, body = state.demoTraffic.bodies[robot.id]!;
  const policy = input.demoTraffic.dispatchPolicy;
  if (incidentHalts(state, robot.id) || (!policy && (body.parking || body.yieldDistanceM !== null))) return false;
  // A floor detour can briefly leave graph centre lines; resume assignment after actual re-entry.
  if (policy && body.parking) {
    const target = task ? { x: task.fromX, y: task.fromY } : state.points.find(p => p.kind === "charger");
    if (target) { try { routeLengthBetween(state.layout, robot.x, robot.y, target.x, target.y); } catch { return false; } }
  }
  // A full-fleet ceiling cannot reject an idle robot; avoid rescanning the whole fleet for it.
  if (input.demoTraffic.maxActiveRoutes < state.robots.length) {
    const active = state.robots.filter(r => occupiesRoute(state, r)).length;
    if (active >= input.demoTraffic.maxActiveRoutes && !occupiesRoute(state, robot)) return false;
  }
  if (!task) return state.points.some((p) => p.kind === "charger" && p.holder === null && p.queue.length === 0);
  if (needsCharge(state, robot)) return false;
  if (!policy) {
    const eligible = state.robots.filter((r) => r.phase === "idle" && !incidentHalts(state, r.id) && !needsCharge(state, r) && !state.demoTraffic.bodies[r.id]!.parking);
    const leastAssignments = Math.min(...eligible.map((r) => state.demoTraffic.bodies[r.id]!.assignments));
    if (body.assignments > leastAssignments) return false;
  }
  // Backpressure before committing another robot to an already occupied task endpoint.
  return !pickupIsReserved(state, task) && underliftCanAssign(state, robot, task);
};

const warehousePolicyGate: SimDispatchGate = Object.assign(
  ((state, robot, task) => warehouseDispatchGate(state, robot, task)) as SimDispatchGate,
  { policy: { pendingLookahead: DISPATCH_POLICY.pendingLookahead }, onAssigned: (plain: SimEngineState, robot: SimEngineState["robots"][number], task: Parameters<NonNullable<SimDispatchGate["onAssigned"]>>[2]) => {
    const state = plain as WarehouseTrafficState, body = state.demoTraffic.bodies[robot.id]!;
    cancelDockRequest(state.dockAccess,robot.id);
    body.parking = false; body.yieldDistanceM = null; body.yieldStartedS = null;
    state.routeCommitments = state.routeCommitments.filter(c => c.robotId !== robot.id && c.partnerId !== robot.id);
    assignUnderlift(state, robot, task);
  } },
);

export function stepWarehouseTraffic(state: WarehouseTrafficState) {
  updateIncidents(state);
  for(const robot of state.robots)releaseDockAfterClear(state.dockAccess,robot.id,robot);
  releaseRouteCommitments(state);
  accrueIncidentTime(state, 1);
  const idleAtStart = new Set(state.robots.filter((r) => r.phase === "idle").map((r) => r.id));
  const tasksBefore = state.robots.map((r) => r.task?.id ?? null);
  const physicalTasksBefore = new Map(state.robots.flatMap(r => r.task ? [[r.id, r.task] as const] : []));
  const phasesBefore = state.robots.map((r) => r.phase);
  const positionsBefore = state.robots.map((r) => ({ x: r.x, y: r.y, timerS: r.timerS, soc: r.soc }));
  // Select before beginTrafficStep clears last tick's blocker ids; a committed partner is not eligible.
  const replanCandidateId = selectReplanCandidate(state);
  beginTrafficStep(state.demoTraffic, state.robots, state.tS, 1);
  if ((state.input as DemoTrafficInput).demoTraffic.dispatchPolicy) state.demoTraffic.replanCandidateId = replanCandidateId;
  stepSim(state, 1, warehouseGate, (state.input as DemoTrafficInput).demoTraffic.dispatchPolicy ? warehousePolicyGate : warehouseDispatchGate, (s, r) => !incidentHalts(s as WarehouseTrafficState, r.id), warehouseHandlingGate);
  syncUnderlift(state, physicalTasksBefore);
  for (const r of state.robots) if (r.task && r.task.id !== tasksBefore[r.id]) state.demoTraffic.bodies[r.id]!.assignments++;
  for (const r of state.robots) if (r.phase !== phasesBefore[r.id]) { const body = state.demoTraffic.bodies[r.id]!; body.yieldDistanceM = null; body.yieldStartedS = null; }
  for (const robot of state.robots) {
    if (incidentHalts(state, robot.id)) continue;
    const safety = state.demoTraffic.bodies[robot.id]!;
    if (!idleAtStart.has(robot.id) || robot.phase !== "idle") { safety.parking = false; continue; }
    const home = (state.input as DemoTrafficInput).demoTraffic.initialPositions[robot.id]!;
    if (Math.hypot(home.x - robot.x, home.y - robot.y) < EPS) { safety.parking = false;continue; }
    if (!safety.parking) { robot.path = route(state.layout, robot, home); robot.pathLenM = routeLengthM(robot.path); robot.distM = 0; safety.parking = true; }
    const next = Math.min(robot.pathLenM, robot.distM + state.input.robots.speedMps);
    if (reserveWarehouseMotion(state, robot.id, pathSlice(robot.path, robot.distM, next))) {
      robot.distM = next; const p = positionAlong(robot.path, next); robot.x = p.x; robot.y = p.y;
      if (state.tS > state.warmupS) { state.acc.idleS -= 1; state.acc.emptyS += 1; }
      if (next >= robot.pathLenM - EPS) safety.parking = false;
    } else {
      if (safety.waitS >= 2 && state.demoTraffic.tS - safety.lastReplanS >= 5 && takeReplanTurn(state, robot.id)) {
        if (!state.routeCommitments.some((c) => c.partnerId === robot.id && c.robotId === safety.blockedBy)) {
          safety.lastReplanS = state.demoTraffic.tS;
          const detour = freeGraphRoute(state.layout, robot, home, warehouseObstacles(state, robot.id), safety.safeCenterDistanceM,(a,b)=>stockRouteIsClear(state,robot,a,b)&&dockPathAllowed(state.dockAccess,robot.id,[a,b]));
          if (detour) { commitDetour(state, robot.id, safety.blockedBy); robot.path = detour; robot.pathLenM = routeLengthM(detour); robot.distM = 0; safety.replans++; state.demoTraffic.detours++; }
        }
      }
      if (state.tS > state.warmupS) { state.acc.idleS -= 1; state.acc.waitPointS += 1; }
    }
  }
  for(const robot of state.robots)releaseDockAfterClear(state.dockAccess,robot.id,robot);
  for (const c of state.routeCommitments) c.travelledM += routeLengthM(state.demoTraffic.reservations.find((r) => r.id === c.robotId)!.path);
  auditTraffic(state.demoTraffic, state.robots);
  for (const robot of state.robots) {
    const closest=nearestStockGap(state,robot);if(!closest)continue;
    const gap=closest.gapM,body=state.demoTraffic.bodies[robot.id]!;
    body.nearestClearanceM=body.nearestClearanceM===null?gap:Math.min(body.nearestClearanceM,gap);
    state.demoTraffic.minimumClearanceM=state.demoTraffic.minimumClearanceM===null?gap:Math.min(state.demoTraffic.minimumClearanceM,gap);
    if(gap<state.demoTraffic.clearanceM-EPS)state.demoTraffic.firstViolation??={tS:state.tS,robotId:robot.id,otherRobotId:-1000000-(state.demoUnderlift?.podIndex[closest.podId]??0),x:robot.x,y:robot.y,clearanceM:gap};
    if(gap < -EPS)state.demoTraffic.collisionCount++;
  }
  for (const r of state.robots) {
    const prev = positionsBefore[r.id]!;
    const operated = Math.hypot(r.x - prev.x, r.y - prev.y) > EPS || ((phasesBefore[r.id] === "loading" || phasesBefore[r.id] === "unloading") && (r.timerS !== prev.timerS || r.phase !== phasesBefore[r.id]));
    if (prev.soc <= 0 && operated) recordZeroSocOperation(state, r, 1);
  }
  updateIncidents(state);
}

export function attachWarehouseSafety<T extends { robots: { id: number }[] }>(frame: T, state: WarehouseTrafficState) {
  return { ...frame, robots: frame.robots.map((r) => {
    const safety = state.demoTraffic.bodies[r.id]!, robot = state.robots.find((body) => body.id === r.id)!;
    const parkingPath = safety.parking ? pathSlice(robot.path, robot.distM, robot.pathLenM) : null;
    return { ...r, ...(parkingPath ? { phase: "parking", path: parkingPath, remainingPath: parkingPath, target: parkingPath[parkingPath.length - 1] } : {}), safety: { ...safety } };
  }), safety: { ...trafficSummary(state.demoTraffic), maxActiveRoutes: (state.input as DemoTrafficInput).demoTraffic.maxActiveRoutes, activeRoutes: state.robots.filter((r) => occupiesRoute(state, r)).length, returningHomeRoutes: state.robots.filter(r => r.phase === "idle" && state.demoTraffic.bodies[r.id]!.parking).length, parkedRobots: state.robots.filter((r) => r.phase === "idle" && !state.demoTraffic.bodies[r.id]!.parking).length } };
}
