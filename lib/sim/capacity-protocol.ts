import { customerWorkStarts } from "./customer-work";
import { simInputIdentity } from "./identity";
import { SPATIAL_MODEL_VERSION } from "./spatial-version";
import type { SimEngineState, SimTask } from "./state";
import type { SimInput } from "./types";
import { stableJson } from "../tz/version";

export const CAPACITY_PROTOCOL = { id: "periodic-110-15-120-cohort-closed-1", offeredFactor: 1.10, warmupMin: 15, peakMin: 120 } as const;
type Check = { id: string; category: string; status: string; affectsOverall: boolean };
export type CapacityAssessment = { terminal: boolean; checks: readonly Check[] };
export type QualificationDiagnostics = {
  pendingWaitMaxS: number;
  blockedWaitMaxS: number;
  unfinished: { taskId: number; kind: SimTask["kind"]; operation: NonNullable<SimTask["operation"]>; parentTaskId?: number; podId?: string; ageS: number; pendingWaitS: number; blockedWaitS: number; robotId?: number; reason?: string }[];
};
export type CapacityProof = {
  schemaVersion: "capacity-proof-1";
  protocolId: typeof CAPACITY_PROTOCOL.id;
  sourceInputKey: string;
  testInputKey: string;
  executionInputKey: string;
  input: SimInput;
  simModelVersion: string;
  terminal: boolean;
  status: "PASS" | "FAIL" | "NOT_EVALUATED";
  reason?: string;
  metrics: {
    requiredPerH: number; offeredPerH: number; arrivedPerH: number;
    deliveredCohort: number; closedCohort: number;
    deliveredCohortPerH: number; closedCohortPerH: number;
    measurementStartS: number; measurementEndS: number;
    unfinishedCustomerCount: number; unfinishedServiceCount: number; oldestUnfinishedAgeS: number;
  };
  qualificationDiagnostics: QualificationDiagnostics;
};

/** Only the offered profile and declared horizon change; the required business rate stays intact. */
export function deriveCapacityInput(source: SimInput): SimInput {
  if (source.demand.offered !== undefined || !Number.isFinite(source.demand.peakPerH) || source.demand.peakPerH < 0) throw new Error("Проверка мощности требует исходный вход без тестового профиля с конечной неотрицательной целью");
  const input = structuredClone(source);
  input.demand = { ...input.demand, warmupMin: CAPACITY_PROTOCOL.warmupMin, peakMin: CAPACITY_PROTOCOL.peakMin,
    offered: { protocol: "periodic-capacity-1", perH: source.demand.peakPerH * CAPACITY_PROTOCOL.offeredFactor } };
  return input;
}

type DiagnosticState = SimEngineState & { demoTraffic?: { bodies: Record<number, { blocked: boolean; waitS: number; reason: string | null }> } };
export type QualificationTracker = { blockedWaitMaxS: number; runs: Record<number, number>; previous: Record<number, { x: number; y: number; timerS: number; phase: string; taskId: number | undefined }> };
export function createQualificationTracker(): QualificationTracker { return { blockedWaitMaxS: 0, runs: {}, previous: {} }; }
/** Observer only: retries and changing labels cannot turn an unmoving blocked body into progress. */
export function observeQualification(tracker: QualificationTracker, state: DiagnosticState): void {
  for (const r of state.robots) {
    const before = tracker.previous[r.id], blocked = state.demoTraffic?.bodies[r.id]?.blocked;
    const progress = before && (r.x !== before.x || r.y !== before.y || r.timerS < before.timerS || r.phase !== before.phase || r.task?.id !== before.taskId);
    tracker.runs[r.id] = blocked && !progress ? (tracker.runs[r.id] ?? 0) + 1 : 0;
    tracker.blockedWaitMaxS = Math.max(tracker.blockedWaitMaxS, tracker.runs[r.id]!);
    tracker.previous[r.id] = { x: r.x, y: r.y, timerS: r.timerS, phase: r.phase, taskId: r.task?.id };
  }
}
export function qualificationDiagnostics(state: DiagnosticState, tracker: QualificationTracker): QualificationDiagnostics {
  const starts = customerWorkStarts(state.input, state.tasks, state.tS);
  const robots = new Map(state.robots.flatMap(r => r.task ? [[r.task.id, r] as const] : []));
  const unfinished = state.tasks.filter(t => t.doneS === null).map(t => {
    const robot = robots.get(t.id), body = robot && state.demoTraffic?.bodies[robot.id];
    const pending = t.countsTowardDemand === false ? t.startS === null : starts.get(t.id) === null;
    return { taskId: t.id, kind: t.kind, operation: t.operation ?? "transport", ...(t.parentTaskId === undefined ? {} : { parentTaskId: t.parentTaskId }), ...(t.podId ? { podId: t.podId } : {}),
      ageS: Math.max(0, state.tS - t.arrivalS), pendingWaitS: pending ? Math.max(0, state.tS - t.arrivalS) : 0,
      blockedWaitS: robot ? tracker.runs[robot.id] ?? 0 : 0,
      ...(robot ? { robotId: robot.id } : {}), ...(body?.reason ? { reason: body.reason } : {}) };
  });
  return { pendingWaitMaxS: Math.max(0, ...unfinished.map(t => t.pendingWaitS)), blockedWaitMaxS: tracker.blockedWaitMaxS, unfinished };
}

function safetyReasons(assessment: CapacityAssessment): string[] {
  const reasons: string[] = [];
  for (const id of ["safety", "energy", "validity", "underlift"]) {
    if (assessment.checks.find(c => c.id === id)?.status !== "PASS") reasons.push(`Не подтверждена проверка ${id}`);
  }
  for (const c of assessment.checks) if (c.category === "safety" && c.affectsOverall && c.status !== "PASS" && c.status !== "NOT_APPLICABLE") reasons.push(`Проверка ${c.id}: ${c.status}`);
  if (assessment.checks.some(c => c.id === "incidents" && c.status !== "PASS")) reasons.push("Остались активные инциденты");
  return [...new Set(reasons)];
}
export function nominalCapacityEligibility(assessment: CapacityAssessment, source: SimInput, diagnostics?: QualificationDiagnostics): { eligible: boolean; reasons: string[] } {
  const reasons = safetyReasons(assessment);
  if (source.transportWorkflow !== "closed-pod-1" || source.demand.peakPerH <= 0 || source.demand.offered !== undefined) reasons.push("Нужен исходный closed-pod сценарий с положительной целевой нагрузкой");
  if (!assessment.terminal) reasons.push("Номинальный прогон не завершён");
  for (const id of ["exposure", "intake_sla"]) if (assessment.checks.find(c => c.id === id)?.status !== "PASS") reasons.push(`Номинальная проверка ${id} не пройдена`);
  if (!diagnostics) reasons.push("Нет диагностики ожиданий номинального прогона");
  else if (diagnostics.pendingWaitMaxS > source.thresholds.p95WaitMaxMin * 60 || diagnostics.blockedWaitMaxS > source.thresholds.p95WaitMaxMin * 60) reasons.push("REVIEW_REQUIRED: индивидуальное ожидание превышает входной порог; требуется разбор, это не SLA полного цикла");
  return { eligible: reasons.length === 0, reasons };
}

export function capacityNotEvaluated(source: SimInput, reason: string): CapacityProof {
  const input = deriveCapacityInput(source), start = CAPACITY_PROTOCOL.warmupMin * 60, end = start + CAPACITY_PROTOCOL.peakMin * 60;
  return { schemaVersion: "capacity-proof-1", protocolId: CAPACITY_PROTOCOL.id, sourceInputKey: simInputIdentity(source), testInputKey: simInputIdentity(input), executionInputKey: "", input, simModelVersion: SPATIAL_MODEL_VERSION, terminal: false, status: "NOT_EVALUATED", reason,
    metrics: { requiredPerH: source.demand.peakPerH, offeredPerH: input.demand.offered!.perH, arrivedPerH: 0, deliveredCohort: 0, closedCohort: 0, deliveredCohortPerH: 0, closedCohortPerH: 0, measurementStartS: start, measurementEndS: end, unfinishedCustomerCount: 0, unfinishedServiceCount: 0, oldestUnfinishedAgeS: 0 },
    qualificationDiagnostics: { pendingWaitMaxS: 0, blockedWaitMaxS: 0, unfinished: [] } };
}

const samePoint = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by) < 1e-7;
function complete(t: SimTask, end: number): boolean { return t.startS !== null && Number.isFinite(t.startS) && t.startS >= t.arrivalS && t.doneS !== null && Number.isFinite(t.doneS) && t.doneS >= t.startS && t.doneS <= end; }
/** Strict cohort accounting: required service children must exist, match the physical pod, and finish. */
export function capacityCohort(tasks: readonly SimTask[], start: number, end: number) {
  const children = new Map<number, SimTask[]>();
  for (const t of tasks) if (t.countsTowardDemand === false && t.parentTaskId !== undefined) children.set(t.parentTaskId, [...children.get(t.parentTaskId) ?? [], t]);
  const cohort = tasks.filter(t => t.countsTowardDemand !== false && t.arrivalS >= start && t.arrivalS < end);
  const delivered = cohort.filter(t => complete(t, end));
  const closed = delivered.filter(parent => {
    const service = children.get(parent.id) ?? [];
    if (parent.kind === "internal") return service.length === 0;
    const operation = parent.kind === "inbound" ? "prefetch-pod" : "return-pod";
    const matching = service.filter(t => t.operation === operation && t.kind === parent.kind && !!parent.podId && t.podId === parent.podId && t.arrivalS >= parent.arrivalS);
    if (matching.length !== 1 || service.length !== 1) return false;
    const child = matching[0]!;
    if (!complete(child, end)) return false;
    return parent.kind === "inbound"
      ? child.doneS! <= parent.startS! && child.fromPoint === parent.toPoint && samePoint(child.fromX, child.fromY, parent.toX, parent.toY) && samePoint(child.toX, child.toY, parent.fromX, parent.fromY) && child.toPoint === parent.fromPoint
      : child.arrivalS >= parent.doneS! && child.startS! >= parent.doneS! && child.fromPoint === parent.toPoint && child.toPoint === parent.fromPoint && samePoint(child.fromX, child.fromY, parent.toX, parent.toY) && samePoint(child.toX, child.toY, parent.fromX, parent.fromY);
  });
  return { arrived: cohort.length, delivered: delivered.length, closed: closed.length };
}

export function assessCapacityRun(source: SimInput, state: SimEngineState, assessment: CapacityAssessment, diagnostics: QualificationDiagnostics): CapacityProof {
  const proof = capacityNotEvaluated(source, "Контролируемый прогон не завершён"), expected = deriveCapacityInput(source);
  // The physical executor adds its graph/controller fields; source test identity stays separate.
  for (const key of ["seed", "robots", "charge", "thresholds", "pedestrians", "loadMassKg", "transportWorkflow", "demand"] as const) {
    if (stableJson(state.input[key]) !== stableJson(expected[key])) throw new Error("Исполнитель изменил протокол проверки мощности");
  }
  proof.executionInputKey = simInputIdentity(state.input);
  proof.terminal = assessment.terminal && state.tS >= state.endS && state.precheck === "ok";
  proof.qualificationDiagnostics = diagnostics;
  const cohort = capacityCohort(state.tasks, proof.metrics.measurementStartS, proof.metrics.measurementEndS), hours = CAPACITY_PROTOCOL.peakMin / 60;
  proof.metrics = { ...proof.metrics, arrivedPerH: cohort.arrived / hours, deliveredCohort: cohort.delivered, closedCohort: cohort.closed, deliveredCohortPerH: cohort.delivered / hours, closedCohortPerH: cohort.closed / hours,
    unfinishedCustomerCount: state.tasks.filter(t => t.doneS === null && t.countsTowardDemand !== false).length,
    unfinishedServiceCount: state.tasks.filter(t => t.doneS === null && t.countsTowardDemand === false).length,
    oldestUnfinishedAgeS: Math.max(0, ...diagnostics.unfinished.map(t => t.ageS)) };
  if (!proof.terminal) return proof;
  if (source.transportWorkflow !== "closed-pod-1" || source.demand.peakPerH <= 0) { proof.reason = "Нет применимой closed-pod нагрузки"; return proof; }
  const reasons = safetyReasons(assessment);
  if (proof.metrics.arrivedPerH < proof.metrics.requiredPerH) { proof.reason = "Недостаточная фактическая подача контролируемого теста"; return proof; }
  if (proof.metrics.deliveredCohortPerH < proof.metrics.requiredPerH || proof.metrics.closedCohortPerH < proof.metrics.requiredPerH) reasons.push("Завершённых доставок и полностью закрытых клиентских циклов недостаточно");
  proof.status = reasons.length ? "FAIL" : "PASS";
  proof.reason = reasons.length ? reasons.join("; ") : "Целевая мощность достигнута доставками и закрытыми циклами объявленной когорты; номинальный статус не изменён";
  return proof;
}
