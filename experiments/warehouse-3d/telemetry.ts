import { isDone, stepSim } from "../../lib/sim/engine";
import { positionAlong } from "../../lib/sim/routing";
import { queueLength, type SimEngineState, type SimRobot } from "../../lib/sim/state";
import type { RobotPhase } from "../../lib/sim/types";
import { incidentHalts } from "./incidents";

const PHASES: RobotPhase[] = ["idle", "toPickup", "waitPoint", "loading", "toDrop", "unloading", "toCharger", "waitCharger", "charging"];
export type TelemetryEvent = { id: number; tS: number; observedAtS?: number; robotId: number; type: "phase" | "task-assigned" | "task-completed" | "charge-started" | "charge-finished"; from?: string; to?: string; taskId?: number };
type RobotTelemetry = { distanceM: number; tasksDone: number; vMps: number; heading: number; phaseSinceS: number; timeByPhase: Record<RobotPhase | "incidentStop", number>; socHistory: { tS: number; soc: number }[] };
type Telemetry = { robots: Map<number, RobotTelemetry>; events: TelemetryEvent[]; nextEvent: number };
const telemetry = new WeakMap<SimEngineState, Telemetry>();

export function initTelemetry(state: SimEngineState): Telemetry {
  const existing = telemetry.get(state);
  if (existing) return existing;
  const value: Telemetry = {
    robots: new Map(state.robots.map((r) => [r.id, { distanceM: 0, tasksDone: 0, vMps: 0, heading: 0, phaseSinceS: state.tS, timeByPhase: Object.fromEntries([...PHASES, "incidentStop"].map((p) => [p, 0])) as Record<RobotPhase | "incidentStop", number>, socHistory: [{ tS: state.tS, soc: r.soc }] }])),
    events: [], nextEvent: 0,
  };
  telemetry.set(state, value);
  return value;
}

const moving = (phase: RobotPhase) => phase === "toPickup" || phase === "toDrop" || phase === "toCharger";
function direction(path: SimRobot["path"], distance: number, fallback: number): number {
  const a = positionAlong(path, Math.max(0, distance - 0.0001));
  const b = positionAlong(path, distance + 0.0001);
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) > 1e-9 ? Math.atan2(b.y - a.y, b.x - a.x) : fallback;
}

/** Observe canonical one-second steps; lookahead previews never call this function. */
export function observeStep(state: SimEngineState, step: () => void): void {
  const store = initTelemetry(state);
  const startS = state.tS;
  const before = state.robots.map((r) => ({ phase: r.phase, incidentHeld: incidentHalts(state, r.id), loaded: r.loaded, path: r.path, distM: r.distM, task: r.task, taskId: r.task?.id ?? null }));
  step();
  const dt = state.tS - startS;
  const event = (entry: Omit<TelemetryEvent, "id">) => store.events.push({ ...entry, observedAtS: state.tS, id: store.nextEvent++ });
  state.robots.forEach((r, i) => {
    const prev = before[i]!;
    const data = store.robots.get(r.id)!;
    const samePath = prev.path === r.path;
    const travelled = samePath ? Math.max(0, r.distM - prev.distM) : r.distM;
    data.distanceM += travelled;
    data.vMps = dt > 0 ? travelled / dt : 0;
    if (travelled > 0) data.heading = direction(r.path, r.distM, data.heading);
    let spentPhase = prev.phase;
    if (prev.phase === "idle" && (moving(r.phase) || r.phase === "waitCharger")) spentPhase = "toCharger";
    if (prev.phase === "idle" && r.task) spentPhase = travelled > 0 ? "toPickup" : r.phase;
    if (prev.phase === "waitPoint" && (r.phase === "loading" || r.phase === "unloading" || r.phase === "toDrop" || r.phase === "idle")) spentPhase = prev.loaded ? "unloading" : "loading";
    if (prev.phase === "waitCharger" && (r.phase === "charging" || r.phase === "idle")) spentPhase = "charging";
    data.timeByPhase[prev.incidentHeld ? "incidentStop" : spentPhase] += dt;
    if (r.phase !== prev.phase) {
      data.phaseSinceS = state.tS;
      event({ tS: state.tS, robotId: r.id, type: "phase", from: prev.phase, to: r.phase, taskId: r.task?.id ?? prev.taskId ?? undefined });
    }
    if (r.task && r.task.id !== prev.taskId) event({ tS: startS, robotId: r.id, type: "task-assigned", taskId: r.task.id });
    if (prev.task && prev.task.doneS !== null) {
      data.tasksDone++;
      event({ tS: prev.task.doneS, robotId: r.id, type: "task-completed", taskId: prev.task.id });
    }
    if (r.phase === "charging" && prev.phase !== "charging") event({ tS: startS, robotId: r.id, type: "charge-started" });
    if (prev.phase === "charging" && r.phase !== "charging") event({ tS: state.tS, robotId: r.id, type: "charge-finished" });
    if (state.tS % 30 === 0) {
      data.socHistory.push({ tS: state.tS, soc: r.soc });
      if (data.socHistory.length > 120) data.socHistory.shift();
    }
  });
  store.events.sort((a, b) => a.tS - b.tS || a.id - b.id);
  if (store.events.length > 200) store.events.splice(0, store.events.length - 200);
}

function restOfPath(r: SimRobot, distance = r.distM, position = { x: r.x, y: r.y }) {
  if (!moving(r.phase) || r.path.length < 2) return [];
  let walked = 0;
  for (let i = 1; i < r.path.length; i++) {
    walked += Math.abs(r.path[i]!.x - r.path[i - 1]!.x) + Math.abs(r.path[i]!.y - r.path[i - 1]!.y);
    if (walked > distance + 1e-9) return [{ ...position }, ...r.path.slice(i).map((p) => ({ ...p }))];
  }
  return [];
}

export function frameOf(state: SimEngineState) {
  const store = initTelemetry(state);
  const robots = state.robots.map((r) => {
    const data = store.robots.get(r.id)!;
    const task = r.task ? { id: r.task.id, kind: r.task.kind, from: { x: r.task.fromX, y: r.task.fromY }, to: { x: r.task.toX, y: r.task.toY }, arrivalS: r.task.arrivalS, startS: r.task.startS } : null;
    const remainingDistM = moving(r.phase) ? Math.max(0, r.pathLenM - r.distM) : 0;
    const speed = state.input.robots.speedMps * (r.phase === "toDrop" ? state.input.robots.loadedSpeedFactor : 1);
    const ownHandlingS = r.phase === "toPickup" ? state.input.robots.handlingSec : r.phase === "loading" || r.phase === "unloading" ? Math.max(0, r.timerS) : 0;
    return {
      id: r.id, x: r.x, y: r.y, phase: r.phase, loaded: r.loaded, soc: r.soc,
      path: restOfPath(r), remainingPath: restOfPath(r), target: moving(r.phase) ? { ...r.path[r.path.length - 1]! } : r.pointIdx >= 0 ? { x: state.points[r.pointIdx]!.x, y: state.points[r.pointIdx]!.y } : null,
      task, remainingDistM, etaS: r.phase === "idle" || r.phase === "waitPoint" || r.phase === "waitCharger" ? null : r.phase === "charging" ? Math.max(0, state.input.charge.stopSoc - r.soc) * state.input.robots.chargeMin! * 60 : remainingDistM / speed + ownHandlingS, etaIncludesQueues: false,
      vMps: data.vMps, heading: data.heading, distanceM: data.distanceM, tasksDone: data.tasksDone,
      handlingProgress: r.phase === "loading" || r.phase === "unloading" ? Math.max(0, Math.min(1, 1 - r.timerS / Math.max(1e-9, state.input.robots.handlingSec))) : null,
      timeByPhase: { ...data.timeByPhase }, incidentStopS: data.timeByPhase.incidentStop, socHistory: data.socHistory.map((p) => ({ ...p })),
      waitReason: r.phase === "waitPoint" ? "Точка занята / очередь FIFO" : r.phase === "waitCharger" ? "Ожидание зарядной станции" : null,
      waitElapsedS: r.phase === "waitPoint" || r.phase === "waitCharger" ? state.tS - data.phaseSinceS : 0,
    };
  });
  return {
    tS: state.tS, endS: state.endS, warmupS: state.warmupS, robots,
    // Observation time is distinct from the interpolated display clock.
    provenance: { source: "simulation" as const, observedAtS: state.tS, stepS: 1, coordinateFrame: "site-metres" as const, positionSource: "model" as const, routeSource: "planned" as const },
    points: state.points.map(({ id, x, y, kind, holder, queue }) => ({ id, x, y, kind, busy: holder !== null, holder, queue: [...queue] })),
    queue: queueLength(state),
    events: store.events.map((e) => ({ ...e })),
    tasks: state.tasks.filter((t) => t.doneS === null).map((t) => ({ id: t.id, kind: t.kind, from: { x: t.fromX, y: t.fromY }, to: { x: t.toX, y: t.toY }, arrivalS: t.arrivalS, startS: t.startS, status: t.startS === null ? "queued" : "active", robotId: state.robots.find((r) => r.task?.id === t.id)?.id ?? null })),
    telemetry: { distanceM: robots.reduce((sum, r) => sum + r.distanceM, 0), tasksDone: robots.reduce((sum, r) => sum + r.tasksDone, 0), activeTasks: robots.filter((r) => r.task).length, chargingRobots: robots.filter((r) => r.phase === "charging" && !incidentHalts(state, r.id)).length, waitingRobots: robots.filter((r) => (r.phase === "waitPoint" || r.phase === "waitCharger") && !incidentHalts(state, r.id)).length, incidentStoppedRobots: robots.filter((r) => incidentHalts(state, r.id)).length },
  };
}

const previews = new WeakMap<SimEngineState, { tS: number; next: SimEngineState }>();
export function previewFrame(state: SimEngineState, alpha: number) {
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) throw new Error("Preview fraction must be between 0 and 1");
  const frame = frameOf(state);
  if (isDone(state) || alpha === 0) return frame;
  let preview = previews.get(state);
  if (!preview || preview.tS !== state.tS) {
    const next = structuredClone(state);
    stepSim(next);
    preview = { tS: state.tS, next };
    previews.set(state, preview);
  }
  const next = preview.next;
  frame.tS = state.tS + alpha;
  frame.robots.forEach((robot, i) => {
    const current = state.robots[i]!;
    const future = next.robots[i]!;
    // Cloning changes path identity: phase/path length identifies a newly assigned route.
    const newRoute = current.phase === "idle" && Math.abs(future.x - current.x) + Math.abs(future.y - current.y) > 1e-9;
    const path = newRoute ? future.path : current.path;
    const from = newRoute ? 0 : current.distM;
    const to = newRoute ? future.distM : moving(current.phase) ? Math.min(current.pathLenM, future.distM) : from;
    if (to > from && path.length) {
      const distance = from + (to - from) * alpha;
      const position = positionAlong(path, distance);
      robot.x = position.x;
      robot.y = position.y;
      robot.heading = direction(path, distance, robot.heading);
      robot.vMps = to - from;
      const source = newRoute ? future : current;
      robot.remainingPath = restOfPath(source, distance, position);
      robot.path = robot.remainingPath;
      robot.remainingDistM = Math.max(0, source.pathLenM - distance);
    }
    robot.soc += (future.soc - current.soc) * alpha;
  });
  return frame;
}
