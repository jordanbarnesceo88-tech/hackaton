import { calculateProjectPreview, calculateProjectPreviewAsync, calculateProjectCapacityPreview, calculateProjectCapacityPreviewAsync } from "../../experiments/warehouse-3d/project-input";
import { checkExecution, type CooperativeOptions } from "./cooperative";
import { capacityNotEvaluated, nominalCapacityEligibility } from "./capacity-protocol";
import type { ProjectModel } from "../tz/model";
import type { ScenarioSpec, SpatialEvidence } from "../tz/types";
import { simInputIdentity } from "./identity";
import { createSpatialProjectSnapshot, SPATIAL_MODEL_VERSION } from "./spatial-bridge";
import type { SimInput } from "./types";
import type { SimRunSummary } from "./metrics";

type SpatialReplayOptions = {
  now: () => number;
  budgetMs?: number;
  onSummary?: (scenarioKey: string, summary: SimRunSummary) => void;
};
type ReplayReceipt = { evidence: SpatialEvidence; summary: SimRunSummary };

function capacityRequested(evidence: SpatialEvidence): boolean {
  return evidence.capacityRequested === true || evidence.capacityProof !== undefined;
}

function cacheIdentity(inputKey: string, requested: boolean): string {
  return `${inputKey}\ncapacity:${requested ? "requested" : "absent"}`;
}

function snapshot(spec: ScenarioSpec, input: SimInput) {
  return createSpatialProjectSnapshot({ requestId: "server-recheck", scenarioKey: spec.key,
    scenarioName: spec.name, variantId: "calculated", input });
}

function evidenceFromResult(result: ReturnType<typeof calculateProjectPreview>, input: SimInput): SpatialEvidence {
  return {
    sourceInputKey: simInputIdentity(input), executionInputKey: simInputIdentity(result.input), simModelVersion: SPATIAL_MODEL_VERSION,
    input: structuredClone(input),
    assessment: { status: result.assessment.status as SpatialEvidence["assessment"]["status"], headline: result.assessment.headline, terminal: true },
    summary: { fleet: result.summary.fleet, requiredPerH: result.summary.requiredPerH, achievedPerH: result.summary.achievedPerH,
      queueEnd: result.summary.queueEnd, waitP95Min: result.summary.waitP95Min },
  };
}

function unverifiedCapacity(input: SimInput, reason: string): Pick<SpatialEvidence, "capacityRequested" | "capacityProof"> {
  return { capacityRequested: true, capacityProof: capacityNotEvaluated(input, reason) };
}

function replaySummary(result: ReturnType<typeof calculateProjectPreview>, sourceInputKey: string, durationMs: number): SimRunSummary {
  return { ...result.summary, inputKey: sourceInputKey, simModelVersion: SPATIAL_MODEL_VERSION, durationMs,
    verdict: result.assessment.status === "OK" ? "CONFIRMED" : result.assessment.status === "NOT_EVALUATED" ? "NOT_EVALUATED" : "NOT_CONFIRMED",
    ...(result.assessment.status === "NOT_EVALUATED" ? { assessmentReason: result.summary.assessmentReason ?? result.assessment.headline } : {}),
    minStableFleet: null, fleetByNorm: null, verdictByNorm: null };
}

/** Shared by every nominal and controlled replay, clipped to the project's remaining deadline. */
export const PROJECT_SPATIAL_BUDGET_MS = 45_000;

function allowance(budgetMs: number | undefined): number {
  return budgetMs === undefined ? PROJECT_SPATIAL_BUDGET_MS : Number.isFinite(budgetMs) ? Math.min(PROJECT_SPATIAL_BUDGET_MS, Math.max(0, budgetMs)) : 0;
}

function notEvaluated(previous: SpatialEvidence, expected: SimInput | null | undefined, reason: string): SpatialEvidence {
  // Retain an unsupported old input only as an explicitly unverified audit record.
  const input = structuredClone(expected ?? previous.input);
  return {
    sourceInputKey: simInputIdentity(input), executionInputKey: "server-not-evaluated", simModelVersion: SPATIAL_MODEL_VERSION,
    input, assessment: { status: "NOT_EVALUATED", terminal: true, headline: `Сервер не выполнил проверку 3D: ${reason}. Показатели выполнения не оценены` },
    summary: { fleet: input.robots.count, requiredPerH: input.demand.peakPerH, achievedPerH: 0, queueEnd: 0, waitP95Min: 0 },
    ...(capacityRequested(previous) ? { ...unverifiedCapacity(input, `Номинальная проверка не выполнена: ${reason}`),
      capacityNominalReview: { eligible: false, reasons: [`Номинальная проверка не выполнена: ${reason}`] } } : {}),
  };
}

/** Submitted statuses/inputs never qualify a candidate: both replays use server-derived inputs. */
export function recheckProjectSpatialEvidence(
  model: ProjectModel,
  { now, budgetMs, onSummary }: SpatialReplayOptions,
): ScenarioSpec[] {
  const deadline = now() + allowance(budgetMs);
  const cache = new Map<string, ReplayReceipt>();
  return model.scenarios.map(spec => {
    if (!spec.spatialEvidence) return spec;
    const expected = model.simInputs[spec.key]?.calculated;
    const failed = (reason: string) => ({ ...spec, spatialEvidence: notEvaluated(spec.spatialEvidence!, expected, reason) });
    if (!expected) return failed("нет поддерживаемого входа текущего сценария");
    const key = simInputIdentity(expected), requested = capacityRequested(spec.spatialEvidence);
    const cacheKey = cacheIdentity(key, requested), cached = cache.get(cacheKey);
    if (cached) {
      onSummary?.(spec.key, { ...structuredClone(cached.summary), scenarioKey: spec.key });
      return { ...spec, spatialEvidence: structuredClone(cached.evidence) };
    }
    if (now() >= deadline) return failed("исчерпан общий бюджет пространственных проверок проекта");
    try {
      const started = now();
      const result = calculateProjectPreview(snapshot(spec, expected), { now, deadline });
      if (now() >= deadline) return failed("пространственный прогон превысил общий бюджет проекта");
      if (!result.assessment.terminal || result.assessment.status === "RUNNING") return failed("прогон не завершён");
      const evidence = evidenceFromResult(result, expected);
      const measured = replaySummary(result, key, Math.max(0, now() - started));
      if (requested) {
        evidence.capacityRequested = true;
        const eligibility = nominalCapacityEligibility(result.assessment, expected, result.qualificationDiagnostics);
        evidence.capacityNominalReview = { ...eligibility,
          ...(result.qualificationDiagnostics === undefined ? {} : { diagnostics: structuredClone(result.qualificationDiagnostics) }) };
        if (!eligibility.eligible) Object.assign(evidence, unverifiedCapacity(expected, eligibility.reasons.join("; ")));
        else {
          try {
            evidence.capacityProof = calculateProjectCapacityPreview(snapshot(spec, expected), { now, deadline });
            if (now() >= deadline) Object.assign(evidence, unverifiedCapacity(expected, "Исчерпан общий бюджет пространственных проверок проекта"));
          } catch (error) {
            Object.assign(evidence, unverifiedCapacity(expected, error instanceof Error ? error.message.slice(0, 1000) : "Контролируемый прогон недоступен"));
          }
        }
      }
      cache.set(cacheKey, { evidence, summary: measured });
      onSummary?.(spec.key, structuredClone(measured));
      return { ...spec, spatialEvidence: structuredClone(evidence) };
    } catch (error) {
      return failed(error instanceof Error ? error.message.slice(0, 1000) : "пространственный прогон недоступен");
    }
  });
}

export async function recheckProjectSpatialEvidenceAsync(
  model: ProjectModel, options: CooperativeOptions & SpatialReplayOptions,
): Promise<ScenarioSpec[]> {
  const now = options.now;
  const deadline = Math.min(options.deadline ?? Infinity, now() + allowance(options.budgetMs));
  const cache = new Map<string, ReplayReceipt>();
  const out: ScenarioSpec[] = [];
  for (const spec of model.scenarios) {
    checkExecution(options);
    if (!spec.spatialEvidence) { out.push(spec); continue; }
    const expected = model.simInputs[spec.key]?.calculated;
    const failed = (reason: string) => ({ ...spec, spatialEvidence: notEvaluated(spec.spatialEvidence!, expected, reason) });
    if (!expected) { out.push(failed("нет поддерживаемого входа текущего сценария")); continue; }
    const key = simInputIdentity(expected), requested = capacityRequested(spec.spatialEvidence);
    const cacheKey = cacheIdentity(key, requested), cached = cache.get(cacheKey);
    if (cached) {
      options.onSummary?.(spec.key, { ...structuredClone(cached.summary), scenarioKey: spec.key });
      out.push({ ...spec, spatialEvidence: structuredClone(cached.evidence) }); continue;
    }
    if (now() >= deadline) { out.push(failed("исчерпан общий бюджет пространственных проверок проекта")); continue; }
    try {
      const started = now();
      const result = await calculateProjectPreviewAsync(snapshot(spec, expected), { ...options, now, deadline });
      if (now() >= deadline) { out.push(failed("пространственный прогон превысил общий бюджет проекта")); continue; }
      if (!result.assessment.terminal || result.assessment.status === "RUNNING") { out.push(failed("прогон не завершён")); continue; }
      const evidence = evidenceFromResult(result, expected);
      const measured = replaySummary(result, key, Math.max(0, now() - started));
      if (requested) {
        evidence.capacityRequested = true;
        const eligibility = nominalCapacityEligibility(result.assessment, expected, result.qualificationDiagnostics);
        evidence.capacityNominalReview = { ...eligibility,
          ...(result.qualificationDiagnostics === undefined ? {} : { diagnostics: structuredClone(result.qualificationDiagnostics) }) };
        if (!eligibility.eligible) Object.assign(evidence, unverifiedCapacity(expected, eligibility.reasons.join("; ")));
        else {
          try {
            evidence.capacityProof = await calculateProjectCapacityPreviewAsync(snapshot(spec, expected), { ...options, now, deadline });
            if (now() >= deadline) Object.assign(evidence, unverifiedCapacity(expected, "Исчерпан общий бюджет пространственных проверок проекта"));
          } catch (error) {
            if (error instanceof Error && error.name === "AbortError") throw error;
            checkExecution(options);
            Object.assign(evidence, unverifiedCapacity(expected, error instanceof Error ? error.message.slice(0, 1000) : "Контролируемый прогон недоступен"));
          }
        }
      }
      cache.set(cacheKey, { evidence, summary: measured });
      options.onSummary?.(spec.key, structuredClone(measured));
      out.push({ ...spec, spatialEvidence: structuredClone(evidence) });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      checkExecution(options);
      out.push(failed(error instanceof Error ? error.message.slice(0, 1000) : "пространственный прогон недоступен"));
    }
  }
  return out;
}
