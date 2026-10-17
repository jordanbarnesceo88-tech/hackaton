import { pointInFootprint, siteSegmentIsClear } from "../../lib/sim/site-layout";
import type { SimLayout } from "../../lib/sim/types";
import { complexSite } from "./site";
import { auditTraffic, beginTrafficStep, createTrafficController, reserveTrafficMotion, segmentDistance, trafficSummary, type BodySafety, type TrafficController } from "./traffic";
import { accrueIncidentTime, attachIncidentFrame, createIncidentRuntime, defaultDemoIncidents, incidentHalts, incidentSummary, updateIncidents, type IncidentConfig, type IncidentRuntime, type DemoIncident } from "./incidents";
import { assessCleaning, recordZeroSocOperation, type AssessmentFacts } from "./assessment";

type Point = { x: number; y: number };
// The displayed squeegee reaches 0.551 m from the turn centre; retain a 0.029 m margin.
const BODY_CLEARANCE_M = 0.58;
type Phase = "idle" | "transit" | "working" | "toDock" | "waitingDock" | "charging" | "parking" | "done" | "incidentStop";
type Leg = { path: Point[]; working: boolean };
export type SectionGrid = { originX: number; originY: number; cellSizeM: number; width: number; height: number; freeMask: number[]; links: number[]; sectionOf: number[]; excludedUnreachableM2: number };
export type SectionDefinition = { id: string; label: string; name: string; polygon: Point[]; targetCells: number[]; sweepPaths: Point[][] };
export type SectionInput = {
  kind: "cleaning"; seed: number; layout: SimLayout; grid: SectionGrid; sections: SectionDefinition[];
  robots: { count: number; speedMps: number; transitSpeedMps: number; brushWidthM: number; autonomyH: number; chargeMin: number; angularSpeedRadS: number };
  durationS: number; activeAreaM2: number; docks: number[]; parking: number[];
  demoIncidents?: IncidentConfig;
};
type TaskState = { status: "pending" | "in_progress" | "completed" | "incomplete"; robotId: number | null; cleanedCells: number; startedS: number | null; doneS: number | null };
type TransitCommitment = { robotId: number; partnerId: number; leg: number; partnerLeg: number; startDistanceM: number };
type SectionRobot = {
  id: number; x: number; y: number; phase: Phase; heading: number; soc: number; zoneIndex: number | null;
  legs: Leg[]; leg: number; point: number; distanceM: number; cleanedCells: number; tasksDone: number; vMps: number;
  timeByPhase: Record<Phase, number>; socHistory: { tS: number; soc: number }[]; phaseSinceS: number; dock: number | null;
  maneuver: "turning" | "moving" | "stationary"; angularVelocityRadS: number;
  safety?: BodySafety;
  incident?: DemoIncident | null; operationalState?: string;
};
export type SectionState = {
  kind: "cleaning"; input: SectionInput; tick: number; carryS: number; tS: number; endS: number; warmupS: number;
  robots: SectionRobot[]; sections: TaskState[]; covered: number[]; coverageVersion: number;
  docks: { holder: number | null; queue: number[] }[];
  traffic: TrafficController;
  transitCommitments: TransitCommitment[];
  demoIncidents?: IncidentRuntime;
  assessmentFacts?: AssessmentFacts;
  events: { id: number; tS: number; observedAtS: number; robotId: number; type: string; from?: string; to?: string; taskId?: number }[]; nextEvent: number;
};
const PHASES: Phase[] = ["idle", "transit", "working", "toDock", "waitingDock", "charging", "parking", "done", "incidentStop"];
const DIRECTIONS = [{ dx: 1, dy: 0, bit: 1 }, { dx: 0, dy: 1, bit: 2 }, { dx: -1, dy: 0, bit: 4 }, { dx: 0, dy: -1, bit: 8 }];
const EPS = 1e-8;
export const SECTION_CASE = { id: "sections", title: "Уборка секций", description: "Роботы убирают рабочие полосы в пяти отделениях; покрытие накапливается по пройденным клеткам." } as const;

export function sectionCellCenter(grid: SectionGrid, index: number): Point {
  return { x: grid.originX + (index % grid.width + 0.5) * grid.cellSizeM, y: grid.originY + (Math.floor(index / grid.width) + 0.5) * grid.cellSizeM };
}

function neighbors(grid: SectionGrid, cell: number): number[] {
  return DIRECTIONS.filter((d) => grid.links[cell]! & d.bit).map((d) => cell + d.dy * grid.width + d.dx);
}

function nearestCell(grid: SectionGrid, point: Point, excluded = new Set<number>()): number {
  let best = -1, distance = Infinity;
  for (let i = 0; i < grid.freeMask.length; i++) if (grid.freeMask[i] && !excluded.has(i)) {
    const p = sectionCellCenter(grid, i), d = Math.abs(p.x - point.x) + Math.abs(p.y - point.y);
    if (d < distance) { best = i; distance = d; }
  }
  if (best < 0) throw new Error("Нет доступной клетки для робота");
  return best;
}

/** Four-connected A*: connectors are driven through free cells, never straight through fixtures. */
export function sectionGridRoute(grid: SectionGrid, from: number, to: number, passable?: (from: number, to: number) => boolean): number[] {
  if (!grid.freeMask[from] || !grid.freeMask[to]) throw new Error("Начало/конец маршрута недоступны");
  const heuristic = (i: number) => Math.abs(i % grid.width - to % grid.width) + Math.abs(Math.floor(i / grid.width) - Math.floor(to / grid.width));
  const open = new Set([from]), score = new Map([[from, 0]]), previous = new Map<number, number>();
  while (open.size) {
    let current = -1, best = Infinity;
    for (const i of open) { const f = score.get(i)! + heuristic(i); if (f < best) { current = i; best = f; } }
    if (current === to) {
      const path = [to]; while (path[path.length - 1] !== from) path.push(previous.get(path[path.length - 1]!)!);
      return path.reverse();
    }
    open.delete(current);
    for (const next of neighbors(grid, current)) {
      if (passable && !passable(current, next)) continue;
      const distance = score.get(current)! + 1;
      if (distance < (score.get(next) ?? Infinity)) { score.set(next, distance); previous.set(next, current); open.add(next); }
    }
  }
  throw new Error("Нет связного маршрута к секции");
}

function buildGrid(layout: SimLayout): SectionGrid {
  const cellSizeM = 0.8, width = Math.ceil(layout.widthM / cellSizeM), height = Math.ceil(layout.heightM / cellSizeM);
  const grid: SectionGrid = { originX: 0, originY: 0, cellSizeM, width, height, freeMask: Array<number>(width * height).fill(0), links: Array<number>(width * height).fill(0), sectionOf: Array<number>(width * height).fill(-1), excludedUnreachableM2: 0 };
  for (let i = 0; i < grid.freeMask.length; i++) {
    const p = sectionCellCenter(grid, i);
    const bodyInside = [-BODY_CLEARANCE_M, BODY_CLEARANCE_M].every((dx) => [-BODY_CLEARANCE_M, BODY_CLEARANCE_M].every((dy) => pointInFootprint({ x: p.x + dx, y: p.y + dy }, layout.footprint!)));
    if (bodyInside && siteSegmentIsClear(layout, p, p)) grid.freeMask[i] = 1;
  }
  for (let i = 0; i < grid.freeMask.length; i++) if (grid.freeMask[i]) {
    const x = i % width, y = Math.floor(i / width);
    for (const d of DIRECTIONS) {
      const nx = x + d.dx, ny = y + d.dy, next = ny * width + nx;
      if (nx >= 0 && ny >= 0 && nx < width && ny < height && grid.freeMask[next] && siteSegmentIsClear(layout, sectionCellCenter(grid, i), sectionCellCenter(grid, next))) grid.links[i]! |= d.bit;
    }
  }
  const first = nearestCell(grid, layout.chargers[0]!);
  const reached = new Set<number>(), pending = [first];
  while (pending.length) { const i = pending.pop()!; if (reached.has(i)) continue; reached.add(i); pending.push(...neighbors(grid, i)); }
  for (let i = 0; i < grid.freeMask.length; i++) if (grid.freeMask[i] && !reached.has(i)) { grid.freeMask[i] = 0; grid.links[i] = 0; grid.excludedUnreachableM2 += cellSizeM ** 2; }
  return grid;
}

function sweepRuns(grid: SectionGrid, cells: number[]): number[][] {
  const rows = new Map<number, number[]>();
  for (const cell of cells) { const y = Math.floor(cell / grid.width); rows.set(y, [...(rows.get(y) ?? []), cell]); }
  const runs: number[][] = [];
  for (const [row, indices] of [...rows].sort(([a], [b]) => a - b)) {
    indices.sort((a, b) => row % 2 === 0 ? a - b : b - a);
    let run: number[] = [];
    for (const cell of indices) {
      if (run.length && !neighbors(grid, run[run.length - 1]!).includes(cell)) { runs.push(run); run = []; }
      run.push(cell);
    }
    if (run.length) runs.push(run);
  }
  return runs;
}

export function createSectionInput(overrides: { fleet?: number; areaM2?: number } = {}): SectionInput {
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) throw new Error("Неверные параметры уборки");
  for (const key of Object.keys(overrides)) if (key !== "fleet" && key !== "areaM2") throw new Error(`Уборка не поддерживает параметр ${key}`);
  const count = overrides.fleet ?? 4, areaM2 = overrides.areaM2 ?? 2000;
  if (!Number.isInteger(count) || count < 1 || count > 8) throw new Error("Парк уборки: от 1 до 8 роботов");
  if (!Number.isFinite(areaM2) || areaM2 < 1000 || areaM2 > 10000) throw new Error("Площадь уборки: от 1000 до 10000 м²");
  // Reuse the validated display geometry; the cleaning grid has its own physical clearance.
  const layout = complexSite(Math.max(2000, areaM2), 3);
  if (areaM2 < 2000) {
    const scale = Math.sqrt(areaM2 / 2000);
    layout.widthM *= scale; layout.heightM *= scale;
    for (const rectangles of [layout.zones, layout.walls, layout.obstacles, layout.columns, layout.doors, layout.compartments, layout.staging]) for (const r of rectangles ?? []) { r.x *= scale; r.y *= scale; r.w *= scale; r.h *= scale; }
    for (const p of [...layout.footprint!, ...layout.slots, ...layout.receiving, ...layout.shipping, ...layout.chargers, ...layout.routingGraph!.nodes]) { p.x *= scale; p.y *= scale; }
    layout.crossAislesY = layout.crossAislesY.map((v) => v * scale); layout.rackAislesX = layout.rackAislesX.map((v) => v * scale);
  }
  layout.routingGraph!.clearanceM = BODY_CLEARANCE_M;
  const grid = buildGrid(layout);
  const order = ["storage-west", "storage-east", "packing", "receiving", "shipping"];
  const sections: SectionDefinition[] = order.map((id) => {
    const room = layout.compartments!.find((r) => r.id === id)!;
    return { id, label: room.label, name: room.label, polygon: [{ x: room.x, y: room.y }, { x: room.x + room.w, y: room.y }, { x: room.x + room.w, y: room.y + room.h }, { x: room.x, y: room.y + room.h }], targetCells: [], sweepPaths: [] };
  });
  const charging = layout.staging!.find((s) => s.kind === "charger")!;
  for (let i = 0; i < grid.freeMask.length; i++) if (grid.freeMask[i]) {
    const p = sectionCellCenter(grid, i);
    if (p.x >= charging.x && p.x <= charging.x + charging.w && p.y >= charging.y && p.y <= charging.y + charging.h) continue;
    const s = sections.findIndex((section) => pointInFootprint(p, section.polygon));
    if (s >= 0) { sections[s]!.targetCells.push(i); grid.sectionOf[i] = s; }
  }
  for (const section of sections) {
    if (!section.targetCells.length) throw new Error(`Секция ${section.label} недоступна`);
    section.sweepPaths = sweepRuns(grid, section.targetCells).map((run) => run.map((i) => sectionCellCenter(grid, i)));
  }
  const used = new Set<number>();
  const select = (p: Point) => { const cell = nearestCell(grid, p, used), center = sectionCellCenter(grid, cell); for (let j = 0; j < grid.freeMask.length; j++) if (Math.hypot(sectionCellCenter(grid, j).x - center.x, sectionCellCenter(grid, j).y - center.y) < 1.28 - EPS) used.add(j); return cell; };
  const docks = layout.chargers.map(select);
  const parking: number[] = [];
  for (let i = 0; i < count; i++) parking.push(select({ x: charging.x + charging.w * (0.25 + i * 0.06), y: charging.y + charging.h * 0.65 }));
  return { kind: "cleaning", seed: 1, layout, grid, sections, robots: { count, speedMps: 0.65, transitSpeedMps: 0.9, brushWidthM: 0.8, autonomyH: 3, chargeMin: 90, angularSpeedRadS: Math.PI / 2 }, durationS: 7200, activeAreaM2: areaM2, docks, parking, demoIncidents: defaultDemoIncidents("cleaning", count) };
}

export function createSectionPlayback(input: SectionInput): SectionState {
  if (input.kind !== "cleaning" || input.grid.freeMask.length !== input.grid.width * input.grid.height || input.robots.count < 1 || input.robots.count > 8 || input.durationS <= 0) throw new Error("Недопустимый вход модели уборки");
  const state: SectionState = { kind: "cleaning", input, tick: 0, carryS: 0, tS: 0, endS: input.durationS, warmupS: 0, traffic: createTrafficController([], BODY_CLEARANCE_M, 0.12),
    robots: input.parking.map((cell, id) => ({ id, ...sectionCellCenter(input.grid, cell), phase: "idle", heading: Math.PI / 2, soc: 0.9, zoneIndex: null, legs: [], leg: 0, point: 1, distanceM: 0, cleanedCells: 0, tasksDone: 0, vMps: 0, timeByPhase: Object.fromEntries(PHASES.map((p) => [p, 0])) as Record<Phase, number>, socHistory: [{ tS: 0, soc: 0.9 }], phaseSinceS: 0, dock: null, maneuver: "stationary", angularVelocityRadS: 0 })),
    sections: input.sections.map(() => ({ status: "pending", robotId: null, cleanedCells: 0, startedS: null, doneS: null })), covered: Array<number>(input.grid.freeMask.length).fill(0), coverageVersion: 0,
    docks: input.docks.map(() => ({ holder: null, queue: [] })), transitCommitments: [], events: [], nextEvent: 0,
  };
  state.traffic = createTrafficController(state.robots, BODY_CLEARANCE_M, 0.12);
  state.demoIncidents = createIncidentRuntime(input.demoIncidents, state.robots.length);
  state.assessmentFacts = { zeroSocOperationRobotSeconds: 0 };
  for (const r of state.robots) r.safety = state.traffic.bodies[r.id];
  updateIncidents(state);
  return state;
}

function event(state: SectionState, r: SectionRobot, type: string, from?: string, to?: string) {
  state.events.push({ id: state.nextEvent++, tS: state.tS, observedAtS: (state.tick + 1) / 10, robotId: r.id, type, from, to, taskId: r.zoneIndex ?? undefined });
  if (state.events.length > 200) state.events.shift();
}
function phase(state: SectionState, r: SectionRobot, value: Phase) {
  if (r.phase !== value) { event(state, r, "phase", r.phase, value); r.phase = value; r.phaseSinceS = state.tS; }
}
function routeFromRobot(state: SectionState, r: SectionRobot, to: number): Point[] {
  const grid = state.input.grid, from = nearestCell(grid, r);
  const points = sectionGridRoute(grid, from, to).map((i) => sectionCellCenter(grid, i));
  return [{ x: r.x, y: r.y }, ...points.filter((p, i) => i > 0 || Math.abs(p.x - r.x) + Math.abs(p.y - r.y) > EPS)];
}
function setLegs(r: SectionRobot, legs: Leg[]) { r.legs = legs; r.leg = 0; r.point = 1; }

function assignSection(state: SectionState, r: SectionRobot): boolean {
  const index = state.sections.findIndex((s) => s.status === "pending");
  if (index < 0) return false;
  const definition = state.input.sections[index]!, task = state.sections[index]!;
  task.status = "in_progress"; task.robotId = r.id; task.startedS = state.tS; r.zoneIndex = index;
  const legs: Leg[] = []; let from = nearestCell(state.input.grid, r);
  for (const run of sweepRuns(state.input.grid, definition.targetCells)) {
    const connection = sectionGridRoute(state.input.grid, from, run[0]!).map((i) => sectionCellCenter(state.input.grid, i));
    if (connection.length > 1) legs.push({ path: connection, working: false });
    const sweep = run.map((i) => sectionCellCenter(state.input.grid, i));
    if (sweep.length === 1) {
      // A small moving brush pass covers an isolated raster cell; a stationary clock never does.
      const p = sweep[0]!, neighbor = neighbors(state.input.grid, run[0]!)[0]!;
      const q = sectionCellCenter(state.input.grid, neighbor);
      sweep.push({ x: p.x + (q.x - p.x) / 4, y: p.y + (q.y - p.y) / 4 }, { ...p });
    }
    legs.push({ path: sweep, working: true }); from = run[run.length - 1]!;
  }
  setLegs(r, legs); phase(state, r, legs[0]!.working ? "working" : "transit"); event(state, r, "task-assigned");
  return true;
}

function requestDock(state: SectionState, r: SectionRobot) {
  let dock = 0;
  for (let i = 1; i < state.docks.length; i++) if (state.docks[i]!.queue.length + (state.docks[i]!.holder === null ? 0 : 1) < state.docks[dock]!.queue.length + (state.docks[dock]!.holder === null ? 0 : 1)) dock = i;
  r.dock = dock; state.docks[dock]!.queue.push(r.id);
  setLegs(r, [{ path: routeFromRobot(state, r, state.input.parking[r.id]!), working: false }]); phase(state, r, "toDock");
}

function markSwept(state: SectionState, r: SectionRobot, a: Point, b: Point) {
  if (r.zoneIndex === null || Math.abs(a.x - b.x) + Math.abs(a.y - b.y) < EPS) return;
  const grid = state.input.grid, half = state.input.robots.brushWidthM / 2;
  const x0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - half) / grid.cellSizeM)), x1 = Math.min(grid.width - 1, Math.floor((Math.max(a.x, b.x) + half) / grid.cellSizeM));
  const y0 = Math.max(0, Math.floor((Math.min(a.y, b.y) - half) / grid.cellSizeM)), y1 = Math.min(grid.height - 1, Math.floor((Math.max(a.y, b.y) + half) / grid.cellSizeM));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const index = y * grid.width + x, p = sectionCellCenter(grid, index);
    if (grid.sectionOf[index] !== r.zoneIndex || state.covered[index] || !grid.freeMask[index]) continue;
    if (p.x >= Math.min(a.x, b.x) - half - EPS && p.x <= Math.max(a.x, b.x) + half + EPS && p.y >= Math.min(a.y, b.y) - half - EPS && p.y <= Math.max(a.y, b.y) + half + EPS) {
      state.covered[index] = r.id + 1; state.coverageVersion++; r.cleanedCells++; state.sections[r.zoneIndex]!.cleanedCells++;
    }
  }
}

function headingDifference(target: number, current: number): number {
  return Math.atan2(Math.sin(target - current), Math.cos(target - current));
}

function isTransitRobot(state: SectionState, r: SectionRobot) {
  return !incidentHalts(state, r.id) && ["transit", "toDock", "parking"].includes(r.phase) && r.legs[r.leg]?.working === false;
}

function releaseTransitCommitments(state: SectionState) {
  state.transitCommitments = state.transitCommitments.filter((c) => {
    const robot = state.robots[c.robotId]!, partner = state.robots[c.partnerId]!, spacing = state.traffic.bodies[robot.id]!.safeCenterDistanceM;
    if (!isTransitRobot(state, robot) || !isTransitRobot(state, partner) || robot.leg !== c.leg || partner.leg !== c.partnerLeg) return false;
    return robot.distanceM - c.startDistanceM < spacing * 2 || Math.hypot(robot.x - partner.x, robot.y - partner.y) < spacing * 2;
  });
}

function replanSectionTransit(state: SectionState, r: SectionRobot) {
  const safety = state.traffic.bodies[r.id]!, leg = r.legs[r.leg];
  if (!leg || leg.working || safety.waitS < 1 || state.tS - safety.lastReplanS < 5 || state.tick % state.robots.length !== r.id) return;
  // Keep one side of an encounter on its detour: mirrored replans otherwise repeat the same conflict.
  if (state.transitCommitments.some((c) => c.partnerId === r.id && c.robotId === safety.blockedBy)) return;
  safety.lastReplanS = state.tS;
  const others = state.robots.filter((p) => p.id !== r.id), spacing = safety.safeCenterDistanceM, grid = state.input.grid;
  const clear = (a: Point, b: Point) => !others.some((p) => segmentDistance(a, b, p, p) < spacing - EPS);
  const to = nearestCell(grid, leg.path[leg.path.length - 1]!);
  // A robot between grid centres may retreat to the centre behind it; never snap to the nearest occupied centre.
  const starts = grid.freeMask.flatMap((free, i) => {
    if (!free) return []; const p = sectionCellCenter(grid, i);
    return Math.hypot(p.x - r.x, p.y - r.y) <= grid.cellSizeM * 1.1 && (Math.abs(p.x - r.x) < EPS || Math.abs(p.y - r.y) < EPS) && clear(r, p) && siteSegmentIsClear(state.input.layout, r, p) ? [i] : [];
  });
  const find = (target: number): number[] | null => {
    for (const from of starts) try { return sectionGridRoute(grid, from, target, (a, b) => clear(sectionCellCenter(grid, a), sectionCellCenter(grid, b))); } catch { /* try the free centre behind */ }
    return null;
  };
  let cells = find(to);
  if (!cells && r.id > (safety.blockedBy ?? Infinity)) {
    const blocker = others.find((p) => p.id === safety.blockedBy)!;
    const candidates = grid.freeMask.flatMap((free, i) => {
      if (!free) return []; const p = sectionCellCenter(grid, i), d = Math.hypot(p.x - r.x, p.y - r.y);
      return d > spacing * 2 && d < 8 && segmentDistance(p, p, r, blocker) >= spacing && clear(p, p) ? [{ i, d }] : [];
    }).sort((a, b) => a.d - b.d);
    for (const candidate of candidates.slice(0, 12)) {
      const retreat = find(candidate.i);
      if (retreat) { cells = [...retreat, ...sectionGridRoute(grid, candidate.i, to).slice(1)]; break; }
    }
  }
  if (cells) {
    const partner = state.robots.find((p) => p.id === safety.blockedBy);
    if (partner && isTransitRobot(state, partner) && !state.transitCommitments.some((c) => [c.robotId, c.partnerId].includes(r.id) || [c.robotId, c.partnerId].includes(partner.id))) {
      state.transitCommitments.push({ robotId: r.id, partnerId: partner.id, leg: r.leg, partnerLeg: partner.leg, startDistanceM: r.distanceM });
    }
    leg.path = [{ x: r.x, y: r.y }, ...cells.map((i) => sectionCellCenter(grid, i))]; r.point = 1; safety.replans++; state.traffic.detours++;
  }
}

function advanceRobot(state: SectionState, r: SectionRobot, dt: number) {
  if (incidentHalts(state, r.id)) {
    r.timeByPhase.incidentStop += dt; r.vMps = 0; r.angularVelocityRadS = 0; r.maneuver = "stationary";
    r.soc = Math.max(0, r.soc - dt / (state.input.robots.autonomyH * 3600) * 0.65);
    return;
  }
  if (r.phase === "idle") { if (!assignSection(state, r)) requestDock(state, r); }
  if (r.phase === "waitingDock" && r.dock !== null) {
    const dock = state.docks[r.dock]!;
    if (dock.holder === null && dock.queue[0] === r.id) {
      dock.queue.shift(); dock.holder = r.id;
      setLegs(r, [{ path: routeFromRobot(state, r, state.input.docks[r.dock]!), working: false }]); phase(state, r, "toDock");
    }
  }
  const spentPhase = r.phase; r.timeByPhase[spentPhase] += dt; r.vMps = 0; r.angularVelocityRadS = 0; r.maneuver = "stationary";
  if (r.phase === "charging") {
    r.soc = Math.min(0.95, r.soc + dt / (state.input.robots.chargeMin * 60));
    if (r.soc >= 0.95 - EPS) {
      state.docks[r.dock!]!.holder = null; event(state, r, "charge-finished");
      setLegs(r, [{ path: routeFromRobot(state, r, state.input.parking[r.id]!), working: false }]); phase(state, r, "parking");
    }
    return;
  }
  if (r.phase === "done" || r.phase === "waitingDock") return;
  r.soc = Math.max(0, r.soc - dt / (state.input.robots.autonomyH * 3600) * (r.phase === "working" ? 1 : 0.65));
  const leg = r.legs[r.leg];
  if (!leg) return;
  const target = leg.path[r.point];
  if (target) {
    const desired = Math.atan2(target.y - r.y, target.x - r.x), difference = headingDifference(desired, r.heading);
    if (Math.abs(difference) > EPS) {
      const turn = Math.sign(difference) * Math.min(Math.abs(difference), state.input.robots.angularSpeedRadS * dt);
      r.heading += turn; r.angularVelocityRadS = turn / dt; r.maneuver = "turning";
    } else {
      const speed = leg.working ? state.input.robots.speedMps : state.input.robots.transitSpeedMps;
      let budgetM = speed * dt;
      while (r.point < leg.path.length && budgetM > EPS) {
        const next = leg.path[r.point]!, distance = Math.abs(next.x - r.x) + Math.abs(next.y - r.y);
        if (distance <= EPS) { r.point++; continue; }
        // Collinear grid points do not create stops; an actual corner waits for the next turn tick.
        if (Math.abs(headingDifference(Math.atan2(next.y - r.y, next.x - r.x), r.heading)) > EPS) break;
        const step = Math.min(distance, budgetM), before = { x: r.x, y: r.y };
        const after = { x: r.x + (next.x - r.x) * step / distance, y: r.y + (next.y - r.y) * step / distance };
        if (!reserveTrafficMotion(state.traffic, r.id, [before, after])) { replanSectionTransit(state, r); break; }
        r.x = after.x; r.y = after.y;
        r.distanceM += step; r.vMps += step / dt; budgetM -= step;
        if (leg.working && step > 0) markSwept(state, r, before, r);
        if (distance - step <= EPS) { r.x = next.x; r.y = next.y; r.point++; }
      }
      if (r.vMps > EPS) r.maneuver = "moving";
    }
  }
  if (r.point >= leg.path.length) {
    r.leg++; r.point = 1;
    const next = r.legs[r.leg];
    if (next) phase(state, r, next.working ? "working" : "transit");
    else if (r.phase === "toDock") {
      if (state.docks[r.dock!]!.holder === r.id) { phase(state, r, "charging"); event(state, r, "charge-started"); }
      else phase(state, r, "waitingDock");
    } else if (r.phase === "parking") phase(state, r, "done");
    else {
      const task = state.sections[r.zoneIndex!]!, targetCount = state.input.sections[r.zoneIndex!]!.targetCells.length;
      task.status = task.cleanedCells === targetCount ? "completed" : "incomplete"; task.doneS = state.tS;
      if (task.status === "completed") r.tasksDone++;
      event(state, r, task.status === "completed" ? "task-completed" : "task-incomplete"); phase(state, r, "idle");
    }
  }
}

export function sectionDone(state: SectionState): boolean {
  return state.tS >= state.endS || (state.sections.every((s) => s.status === "completed" || s.status === "incomplete") && state.robots.every((r) => r.phase === "done"));
}

/** Canonical 0.1s ticks make batching and visual frame rates independent of coverage. */
export function stepSectionPlayback(state: SectionState, seconds = 1): void {
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 3600) throw new Error("Шаг уборки: от 0 до 3600 с");
  const total = state.carryS + seconds, ticks = Math.floor(total * 10 + 1e-8); state.carryS = Math.max(0, total - ticks / 10);
  for (let n = 0; n < ticks && !sectionDone(state); n++) {
    updateIncidents(state); accrueIncidentTime(state, 0.1);
    releaseTransitCommitments(state);
    beginTrafficStep(state.traffic, state.robots, state.tS, 0.1);
    for (const robot of state.robots) {
      const distanceBefore = robot.distanceM, socBefore = robot.soc;
      advanceRobot(state, robot, 0.1);
      if (socBefore <= 0 && (robot.distanceM > distanceBefore || Math.abs(robot.angularVelocityRadS) > EPS)) recordZeroSocOperation(state, { id: robot.id, x: robot.x, y: robot.y, zoneId: robot.zoneIndex === null ? undefined : state.input.sections[robot.zoneIndex]!.id }, 0.1, (state.tick + 1) / 10);
    }
    auditTraffic(state.traffic, state.robots);
    state.tick++; state.tS = state.tick / 10;
    updateIncidents(state);
    if (state.tick % 300 === 0) for (const r of state.robots) { r.socHistory.push({ tS: state.tS, soc: r.soc }); if (r.socHistory.length > 120) r.socHistory.shift(); }
  }
}

function remainingPath(r: SectionRobot): Point[] { return [{ x: r.x, y: r.y }, ...(r.legs[r.leg]?.path.slice(r.point).map((p) => ({ ...p })) ?? [])]; }
function pathLength(points: Point[]) { return points.slice(1).reduce((sum, p, i) => sum + Math.abs(p.x - points[i]!.x) + Math.abs(p.y - points[i]!.y), 0); }
function sectionEndpoints(definition: SectionDefinition) {
  const first = definition.sweepPaths[0]!, last = definition.sweepPaths[definition.sweepPaths.length - 1]!;
  return { from: { ...first[0]! }, to: { ...last[last.length - 1]! } };
}
export function sectionFrame(state: SectionState) {
  const area = state.input.grid.cellSizeM ** 2;
  const sections = state.input.sections.map((s, i) => ({ id: s.id, label: s.label, name: s.label, robotId: state.sections[i]!.robotId, assignedRobotIds: state.sections[i]!.robotId === null ? [] : [state.sections[i]!.robotId!], status: state.sections[i]!.status, startS: state.sections[i]!.startedS, doneS: state.sections[i]!.doneS, targetM2: s.targetCells.length * area, totalAreaM2: s.targetCells.length * area, cleanedM2: state.sections[i]!.cleanedCells * area, cleanedAreaM2: state.sections[i]!.cleanedCells * area, progress: state.sections[i]!.cleanedCells / s.targetCells.length * 100, polygon: s.polygon }));
  const robots = state.robots.map((r) => {
    const section = r.zoneIndex === null ? null : sections[r.zoneIndex]!, path = remainingPath(r), moving = ["transit", "working", "toDock", "parking"].includes(r.phase), distance = moving ? pathLength(path) : 0;
    const definition = r.zoneIndex === null ? null : state.input.sections[r.zoneIndex]!;
    const task = section && state.sections[r.zoneIndex!]!.status === "in_progress" ? { id: r.zoneIndex!, kind: "cleaning", name: section.label, zoneId: section.id, ...sectionEndpoints(definition!), arrivalS: state.sections[r.zoneIndex!]!.startedS, startS: state.sections[r.zoneIndex!]!.startedS } : null;
    return { id: r.id, x: r.x, y: r.y, phase: r.phase, loaded: false, soc: r.soc, heading: r.heading, vMps: r.vMps, path, remainingPath: path, target: moving ? path[path.length - 1]! : null, task,
      zoneId: section?.id ?? null, working: r.phase === "working", brushWidthM: state.input.robots.brushWidthM, cleanedM2: r.cleanedCells * area, coveragePct: section?.progress ?? 0,
      maneuver: r.maneuver, angularVelocityRadS: r.angularVelocityRadS, safety: { ...state.traffic.bodies[r.id]! },
      distanceM: r.distanceM, tasksDone: r.tasksDone, timeByPhase: { ...r.timeByPhase }, socHistory: r.socHistory.map((p) => ({ ...p })), remainingDistM: distance, etaS: moving ? distance / (r.phase === "working" ? state.input.robots.speedMps : state.input.robots.transitSpeedMps) : null, etaIncludesQueues: false, etaIncludesTurns: false,
      waitReason: r.safety?.blocked ? r.safety.reason : r.phase === "waitingDock" ? "Ожидание свободного зарядного поста" : null, waitElapsedS: r.safety?.blocked ? r.safety.waitS : r.phase === "waitingDock" ? state.tS - r.phaseSinceS : 0, handlingProgress: null };
  });
  return attachIncidentFrame({ kind: "cleaning" as const, tS: state.tS, endS: state.endS, warmupS: 0, robots, sections, safety: trafficSummary(state.traffic),
    provenance: { source: "simulation" as const, observedAtS: state.tS, stepS: 0.1, coordinateFrame: "site-metres" as const, positionSource: "model" as const, routeSource: "planned" as const },
    coverage: { version: state.coverageVersion, cellSizeM: state.input.grid.cellSizeM, width: state.input.grid.width, height: state.input.grid.height, originX: 0, originY: 0, freeMask: [...state.input.grid.freeMask], covered: [...state.covered] },
    points: state.input.layout.chargers.map((p, i) => ({ ...p, busy: state.docks[i]!.holder !== null, holder: state.docks[i]!.holder, queue: [...state.docks[i]!.queue] })),
    queue: state.sections.filter((s) => s.status === "pending").length,
    tasks: state.sections.flatMap((s, i) => {
      const definition = state.input.sections[i]!;
      return s.status === "pending" || s.status === "in_progress" ? [{ id: i, kind: "cleaning", name: definition.label, zoneId: definition.id, ...sectionEndpoints(definition), arrivalS: 0, startS: s.startedS, status: s.status === "pending" ? "queued" : "active", robotId: s.robotId }] : [];
    }),
    events: state.events.map((e) => ({ ...e })), telemetry: { distanceM: robots.reduce((sum, r) => sum + r.distanceM, 0), tasksDone: robots.reduce((sum, r) => sum + r.tasksDone, 0), activeTasks: robots.filter((r) => r.task).length, chargingRobots: robots.filter((r) => r.phase === "charging").length, waitingRobots: robots.filter((r) => r.phase === "waitingDock").length, cleanedM2: state.coverageVersion * area, targetM2: sections.reduce((sum, s) => sum + s.targetM2, 0) },
  }, state);
}

type Pose = Pick<SectionRobot, "x" | "y" | "heading" | "vMps" | "maneuver" | "angularVelocityRadS">;
const posePreviews = new WeakMap<SectionState, { tick: number; carryS: number; endS: number; poses: Pose[][] }>();
const posesOf = (state: SectionState): Pose[] => state.robots.map(({ x, y, heading, vMps, maneuver, angularVelocityRadS }) => ({ x, y, heading, vMps, maneuver, angularVelocityRadS }));

/** Predict on one cached clone; only display poses escape, never future coverage/events/counters. */
export function previewSectionFrame(state: SectionState, alpha: number) {
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) throw new Error("Доля предварительного кадра: 0..1");
  const frame = sectionFrame(state);
  if (sectionDone(state)) return frame;
  let cache = posePreviews.get(state);
  if (!cache || cache.tick !== state.tick || cache.carryS !== state.carryS) {
    const copy = structuredClone(state), poses = [posesOf(state)];
    for (let i = 0; i < 10; i++) { stepSectionPlayback(copy, 0.1); poses.push(posesOf(copy)); }
    cache = { tick: state.tick, carryS: state.carryS, endS: copy.tS, poses }; posePreviews.set(state, cache);
  }
  frame.tS = Math.min(state.endS, cache.endS, state.tS + alpha);
  const at = alpha * 10, lo = Math.floor(at), hi = Math.min(10, lo + 1), part = at - lo;
  for (let i = 0; i < frame.robots.length; i++) {
    const robot = frame.robots[i]!, a = cache.poses[lo]![i]!, b = cache.poses[hi]![i]!;
    if (robot.incident?.active && robot.incident.haltsRobot) { robot.vMps = 0; robot.maneuver = "stationary"; robot.angularVelocityRadS = 0; continue; }
    robot.x = a.x + (b.x - a.x) * part; robot.y = a.y + (b.y - a.y) * part;
    robot.heading = a.heading + (b.heading - a.heading) * part;
    robot.vMps = (part === 0 ? a : b).vMps; robot.maneuver = (part === 0 ? a : b).maneuver; robot.angularVelocityRadS = (part === 0 ? a : b).angularVelocityRadS;
  }
  return frame;
}

export function summarizeSections(state: SectionState) {
  const frame = sectionFrame(state), cleanedM2 = frame.telemetry.cleanedM2, targetM2 = frame.telemetry.targetM2;
  return { kind: "cleaning" as const, unit: "м²/ч", cleanedM2, targetM2, coveragePct: cleanedM2 / targetM2 * 100, achievedM2PerH: state.tS > 0 ? cleanedM2 * 3600 / state.tS : 0, elapsedS: state.tS, completedSections: state.sections.filter((s) => s.status === "completed").length, totalSections: state.sections.length, fleet: state.robots.length, distanceM: frame.telemetry.distanceM, incidentSummary: incidentSummary(state), verdict: cleanedM2 >= targetM2 - EPS && state.sections.every((s) => s.status === "completed") ? "COMPLETED" : "PARTIAL" };
}

export function calculateSectionCase(overrides: { fleet?: number; areaM2?: number } = {}) {
  const input = createSectionInput(overrides), state = createSectionPlayback(input);
  while (!sectionDone(state)) stepSectionPlayback(state, 60);
  const area = input.grid.cellSizeM ** 2;
  return { ...SECTION_CASE, kind: "cleaning" as const, activeAreaM2: input.activeAreaM2, modelVersion: "sections-1.4.0", simModelVersion: "cleaning-demo-incidents-1.4.0", dataVersion: "designed-sections-1", input, layout: input.layout,
    sections: input.sections.map((s) => ({ ...s, targetM2: s.targetCells.length * area, assignedRobotIds: [] as number[] })), racks: input.layout.obstacles!.filter((r) => r.kind === "rack"), summary: summarizeSections(state), assessment: assessCleaning(state), finance: null,
    financeUnavailableReason: "Демонстрационная модель уборки секций: экономика и реальная производительность оборудования не рассчитаны.",
    product: { name: "Условный клининговый робот", speedMps: input.robots.speedMps, loadedSpeedFactor: 1, brushWidthM: input.robots.brushWidthM },
    sources: ["Геометрия — проектное допущение демо; реальный план объекта не использован.", "Принципы разделения уникального покрытия и повторных проходов изучены в robots-reference/packages/shared/src/map-scene/types.ts и dashboard/client/src/map/coverage.ts. Реальные маски уборки и телеметрия не импортировались.", "Сетка проходимости и маршруты A* рассчитываются в этой демонстрационной модели, а не восстановлены из датчиков."],
    assumptions: ["Все показатели — модельные, не факт реальной уборки и не характеристика PUDU, Agibot или Viggo. Инциденты и этапы их диагностики заданы расписанием: это автоматический учебный процесс, не реальные сигналы, ремонт или операторские команды.", "Рабочая скорость 0,65 м/с, переезды 0,9 м/с, эффективная прямоугольная полоса 0,8 м, автономность 3 ч и полный заряд за 90 мин — явные допущения демо.", "Перед изменением направления робот останавливается и поворачивает на месте не быстрее 90°/с. На прямых скорость постоянна; ускорение, тормозной путь и динамика привода не моделируются. ETA не включает будущие повороты и очереди.", "Уникальная площадь — число впервые покрытых доступных клеток 0,8×0,8 м; повторный проход площадь не увеличивает. Клеточное приближение не доказывает качество мытья.", "Покрытие добавляется только при движении рабочего инструмента в назначенной секции. Переезды, стоянка, повороты на месте, зарядка и предварительные визуальные кадры не убирают пол.", "Доступный план исключает стены, стеллажи, колонны, защитный отступ 0,58 м, недостижимые клетки и парковочную зарядную зону. Поэтому целевая площадь меньше общей площади объекта.", "Маршруты огибают препятствия и проходят через реальные дверные разрывы. Корпус — диск радиусом 0,58 м, дополнительный зазор между роботами 0,12 м. На каждом шаге 0,1 с резервируется весь перемещаемый отрезок; при конфликте робот ждёт, на переездах ищет объезд или отступает в свободное пространство. Глобальная гарантия отсутствия тупиков не заявляется.", "Планировочный горизонт — 2 ч. Процент завершения не подгоняется к концу: невыполненные секции остаются частичными."],
  };
}
