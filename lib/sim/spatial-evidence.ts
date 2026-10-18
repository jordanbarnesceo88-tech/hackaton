import type { SpatialEvidence } from "../tz/types";
import { legacySimInputIdentityVersion, simInputIdentity } from "./identity";
import { SPATIAL_MODEL_VERSION } from "./spatial-bridge";
import { SIM_MODEL_VERSION, type SimInput } from "./types";
import { deriveCapacityInput, type CapacityProof, type QualificationDiagnostics } from "./capacity-protocol";

const CAPACITY_METRICS = ["requiredPerH", "offeredPerH", "arrivedPerH", "deliveredCohort", "closedCohort", "deliveredCohortPerH", "closedCohortPerH", "measurementStartS", "measurementEndS", "unfinishedCustomerCount", "unfinishedServiceCount", "oldestUnfinishedAgeS"] as const;

function object(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some(key => !allowed.includes(key))) throw new Error("Неверные поля контролируемой проверки мощности");
  return value as Record<string, unknown>;
}

function boundedText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function nonnegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1e9;
}

function parseQualificationDiagnostics(value: unknown): QualificationDiagnostics {
  const diagnostics = object(value, ["pendingWaitMaxS", "blockedWaitMaxS", "unfinished"]);
  if (!nonnegative(diagnostics.pendingWaitMaxS) || !nonnegative(diagnostics.blockedWaitMaxS) || !Array.isArray(diagnostics.unfinished) || diagnostics.unfinished.length > 60_000) throw new Error("Неверная диагностика незавершённых заданий");
  const taskIds = new Set<number>();
  for (const value of diagnostics.unfinished) {
    const item = object(value, ["taskId", "kind", "operation", "parentTaskId", "podId", "ageS", "pendingWaitS", "blockedWaitS", "robotId", "reason"]);
    if (!Number.isSafeInteger(item.taskId) || taskIds.has(Number(item.taskId)) || !["inbound", "outbound", "internal"].includes(String(item.kind)) ||
        !["transport", "prefetch-pod", "return-pod"].includes(String(item.operation)) ||
        ![item.ageS, item.pendingWaitS, item.blockedWaitS].every(nonnegative) ||
        Number(item.pendingWaitS) > Number(item.ageS) || Number(item.blockedWaitS) > Number(item.ageS) ||
        (item.parentTaskId !== undefined && !Number.isSafeInteger(item.parentTaskId)) ||
        (item.robotId !== undefined && (!Number.isSafeInteger(item.robotId) || Number(item.robotId) < 0)) ||
        (item.podId !== undefined && !boundedText(item.podId, 500)) ||
        (item.reason !== undefined && !boundedText(item.reason, 1000))) throw new Error("Неверная строка диагностики незавершённого задания");
    taskIds.add(Number(item.taskId));
  }
  if (Number(diagnostics.pendingWaitMaxS) < Math.max(0, ...diagnostics.unfinished.map(item => Number((item as Record<string, unknown>).pendingWaitS))) ||
      Number(diagnostics.blockedWaitMaxS) < Math.max(0, ...diagnostics.unfinished.map(item => Number((item as Record<string, unknown>).blockedWaitS)))) throw new Error("Сводка ожиданий меньше сохранённых незавершённых заданий");
  return structuredClone(diagnostics) as QualificationDiagnostics;
}

export function parseCapacityNominalReview(value: unknown, source?: SimInput): NonNullable<SpatialEvidence["capacityNominalReview"]> {
  const review = object(value, ["eligible", "reasons", "diagnostics"]);
  if (typeof review.eligible !== "boolean" || !Array.isArray(review.reasons) || review.reasons.length > 100 ||
      !review.reasons.every(reason => boundedText(reason, 4000)) || review.eligible !== (review.reasons.length === 0) ||
      (review.eligible && review.diagnostics === undefined)) throw new Error("Неверное обоснование допуска к проверке мощности");
  const diagnostics = review.diagnostics === undefined ? undefined : parseQualificationDiagnostics(review.diagnostics);
  if (review.eligible && diagnostics && source &&
      Math.max(diagnostics.pendingWaitMaxS, diagnostics.blockedWaitMaxS) > source.thresholds.p95WaitMaxMin * 60) throw new Error("Допуск мощности противоречит сохранённым ожиданиям номинального прогона");
  return structuredClone({ eligible: review.eligible, reasons: review.reasons,
    ...(diagnostics === undefined ? {} : { diagnostics }) }) as NonNullable<SpatialEvidence["capacityNominalReview"]>;
}

/** Validate the exact declared protocol, not arbitrary executable settings from the browser. */
export function parseCapacityProof(value: unknown, source: SimInput, options: { allowLegacyIdentity?: boolean } = {}): CapacityProof {
  const proof = object(value, ["schemaVersion", "protocolId", "sourceInputKey", "testInputKey", "executionInputKey", "input", "simModelVersion", "terminal", "status", "reason", "metrics", "qualificationDiagnostics"]);
  if (proof.schemaVersion !== "capacity-proof-1" || proof.protocolId !== "periodic-110-15-120-cohort-closed-1" ||
      !["PASS", "FAIL", "NOT_EVALUATED"].includes(String(proof.status)) || typeof proof.terminal !== "boolean" ||
      (proof.status !== "NOT_EVALUATED" && proof.terminal !== true)) throw new Error("Неверный протокол или незавершённый вердикт мощности");
  for (const key of ["sourceInputKey", "testInputKey", "executionInputKey", "simModelVersion"] as const) {
    if (key === "executionInputKey" && proof.status === "NOT_EVALUATED" && proof.terminal === false && proof[key] === "") continue;
    if (!boundedText(proof[key], key === "simModelVersion" ? 200 : 1_900_000)) throw new Error("Неверный идентификатор проверки мощности");
  }
  if (proof.reason !== undefined && !boundedText(proof.reason, 4000)) throw new Error("Неверная причина результата проверки мощности");
  const derived = deriveCapacityInput(source), testKey = simInputIdentity(derived);
  const sourceVersion = proof.sourceInputKey === simInputIdentity(source) ? SIM_MODEL_VERSION : options.allowLegacyIdentity ? legacySimInputIdentityVersion(proof.sourceInputKey, source) : null;
  const testVersion = proof.testInputKey === testKey ? SIM_MODEL_VERSION : options.allowLegacyIdentity ? legacySimInputIdentityVersion(proof.testInputKey, derived) : null;
  if (!sourceVersion || sourceVersion !== testVersion ||
      !proof.input || simInputIdentity(proof.input as SimInput) !== testKey) throw new Error("Проверка мощности изменила исходный вход или параметры протокола");
  const metrics = object(proof.metrics, CAPACITY_METRICS);
  for (const key of CAPACITY_METRICS) if (!nonnegative(metrics[key])) throw new Error("Показатели мощности должны быть конечными неотрицательными числами");
  for (const key of ["deliveredCohort", "closedCohort", "unfinishedCustomerCount", "unfinishedServiceCount"] as const) {
    if (!Number.isSafeInteger(metrics[key]) || Number(metrics[key]) > 60_000) throw new Error("Неверное число заданий проверки мощности");
  }
  if (metrics.requiredPerH !== source.demand.peakPerH || metrics.offeredPerH !== derived.demand.offered?.perH ||
      metrics.measurementStartS !== derived.demand.warmupMin * 60 ||
      metrics.measurementEndS !== (derived.demand.warmupMin + derived.demand.peakMin) * 60 ||
      Number(metrics.closedCohort) > Number(metrics.deliveredCohort) ||
      metrics.deliveredCohortPerH !== Number(metrics.deliveredCohort) / (derived.demand.peakMin / 60) ||
      metrics.closedCohortPerH !== Number(metrics.closedCohort) / (derived.demand.peakMin / 60)) throw new Error("Показатели мощности не соответствуют протоколу и закрытым циклам");
  const arrivedCount = Number(metrics.arrivedPerH) * (derived.demand.peakMin / 60);
  if (!Number.isSafeInteger(arrivedCount) || arrivedCount > 60_000 || Number(metrics.deliveredCohort) > arrivedCount) {
    throw new Error("Число доставок превышает фактическую когорту поступлений или счётчик поступлений некорректен");
  }
  if (proof.status === "PASS" && (source.transportWorkflow !== "closed-pod-1" || source.demand.peakPerH <= 0 ||
      Number(metrics.arrivedPerH) < source.demand.peakPerH || Number(metrics.deliveredCohortPerH) < source.demand.peakPerH ||
      Number(metrics.closedCohortPerH) < source.demand.peakPerH)) throw new Error("PASS требует достаточной подачи, доставок и закрытых циклов");
  const qualificationDiagnostics = parseQualificationDiagnostics(proof.qualificationDiagnostics);
  return structuredClone({ ...proof, input: derived, qualificationDiagnostics }) as CapacityProof;
}

/** Freshness only; server replay establishes trust, and nominal qualification stays separate. */
export function capacityProofMatchesInput(proof: CapacityProof | null | undefined, expected: SimInput | null | undefined): proof is CapacityProof {
  if (!proof || !expected || proof.simModelVersion !== SPATIAL_MODEL_VERSION || !proof.terminal) return false;
  try {
    parseCapacityProof(proof, expected);
    return true;
  } catch {
    return false;
  }
}

/** A capacity candidate needs both current observations and the saved nominal health review. */
export function capacityEvidenceQualifies(evidence: SpatialEvidence | null | undefined, expected: SimInput | null | undefined): boolean {
  if (!spatialEvidenceMatchesInput(evidence, expected) || !["OK", "PARTIAL"].includes(evidence.assessment.status) || evidence.capacityProof?.status !== "PASS" ||
      !capacityProofMatchesInput(evidence.capacityProof, expected) || evidence.capacityNominalReview?.eligible !== true) return false;
  try {
    parseCapacityNominalReview(evidence.capacityNominalReview, expected ?? undefined);
    return true;
  } catch {
    return false;
  }
}

/** A saved observation is current only for the same source input and supported engine. */
export function spatialEvidenceMatchesInput(
  evidence: SpatialEvidence | null | undefined,
  expected: SimInput | null | undefined,
): evidence is SpatialEvidence {
  if (!evidence || !expected) return false;
  try {
    return evidence.simModelVersion === SPATIAL_MODEL_VERSION && evidence.assessment.terminal === true &&
      ["OK", "PARTIAL", "FAIL", "NOT_EVALUATED"].includes(evidence.assessment.status) &&
      evidence.sourceInputKey === simInputIdentity(expected) &&
      evidence.sourceInputKey === simInputIdentity(evidence.input) &&
      evidence.summary.fleet === expected.robots.count &&
      evidence.summary.requiredPerH === expected.demand.peakPerH;
  } catch {
    return false;
  }
}
