import { calculateProjectPreview, calculateProjectPreviewAsync } from "../../experiments/warehouse-3d/project-input";
import { checkExecution, type CooperativeOptions } from "./cooperative";
import type { ProjectModel } from "../tz/model";
import type { ScenarioSpec, SpatialEvidence } from "../tz/types";
import { simInputIdentity } from "./identity";
import { createSpatialProjectSnapshot, SPATIAL_MODEL_VERSION } from "./spatial-bridge";
import type { SimInput } from "./types";

/** Shared project budget, not a separate allowance for every client-supplied proof. */
export const PROJECT_SPATIAL_BUDGET_MS = 15_000;

function notEvaluated(previous: SpatialEvidence, expected: SimInput | null | undefined, reason: string): SpatialEvidence {
  // When the adapter cannot build an input, retain the old input solely as an explicitly unverified audit record.
  const input = structuredClone(expected ?? previous.input);
  return {
    sourceInputKey: simInputIdentity(input), executionInputKey: "server-not-evaluated", simModelVersion: SPATIAL_MODEL_VERSION,
    input, assessment: { status: "NOT_EVALUATED", terminal: true, headline: `Сервер не выполнил проверку 3D: ${reason}. Показатели выполнения не оценены` },
    summary: { fleet: input.robots.count, requiredPerH: input.demand.peakPerH, achievedPerH: 0, queueEnd: 0, waitP95Min: 0 },
  };
}

/** Client statuses are never receipts: replay only the input built by the server's financial model. */
export function recheckProjectSpatialEvidence(
  model: ProjectModel,
  { now, budgetMs = PROJECT_SPATIAL_BUDGET_MS }: { now: () => number; budgetMs?: number },
): ScenarioSpec[] {
  const deadline = now() + (Number.isFinite(budgetMs) ? Math.max(0, budgetMs) : 0);
  const cache = new Map<string, SpatialEvidence>();
  return model.scenarios.map(spec => {
    if (!spec.spatialEvidence) return spec;
    const expected = model.simInputs[spec.key]?.calculated;
    const failed = (reason: string) => ({ ...spec, spatialEvidence: notEvaluated(spec.spatialEvidence!, expected, reason) });
    if (!expected) return failed("нет поддерживаемого входа текущего сценария");
    const key = simInputIdentity(expected), cached = cache.get(key);
    if (cached) return { ...spec, spatialEvidence: structuredClone(cached) };
    if (now() >= deadline) return failed("исчерпан общий бюджет пространственных проверок проекта");
    try {
      // This entry point enforces <=60 robots, <=50,000 m², <=8 h and <=20,000 expected tasks before replay.
      const result = calculateProjectPreview(createSpatialProjectSnapshot({ requestId: "server-recheck", scenarioKey: spec.key,
        scenarioName: spec.name, variantId: "calculated", input: expected }));
      if (now() >= deadline) return failed("пространственный прогон превысил общий бюджет проекта");
      const summary = result.summary;
      const evidence: SpatialEvidence = {
        sourceInputKey: key, executionInputKey: simInputIdentity(result.input), simModelVersion: SPATIAL_MODEL_VERSION,
        input: structuredClone(expected),
        assessment: { status: result.assessment.status as SpatialEvidence["assessment"]["status"], headline: result.assessment.headline, terminal: true },
        summary: { fleet: summary.fleet, requiredPerH: summary.requiredPerH, achievedPerH: summary.achievedPerH, queueEnd: summary.queueEnd, waitP95Min: summary.waitP95Min },
      };
      if (!result.assessment.terminal || result.assessment.status === "RUNNING") return failed("прогон не завершён");
      cache.set(key, evidence);
      return { ...spec, spatialEvidence: structuredClone(evidence) };
    } catch (error) {
      return failed(error instanceof Error ? error.message.slice(0, 1000) : "пространственный прогон недоступен");
    }
  });
}

export async function recheckProjectSpatialEvidenceAsync(
  model: ProjectModel, options: CooperativeOptions & { now: () => number; budgetMs?: number },
): Promise<ScenarioSpec[]> {
  const now = options.now;
  const deadline = Math.min(options.deadline ?? Infinity, now() + (options.budgetMs ?? PROJECT_SPATIAL_BUDGET_MS));
  const cache = new Map<string, SpatialEvidence>();
  const out: ScenarioSpec[] = [];
  for (const spec of model.scenarios) {
    checkExecution(options);
    if (!spec.spatialEvidence) { out.push(spec); continue; }
    const expected = model.simInputs[spec.key]?.calculated;
    const failed = (reason: string) => ({ ...spec, spatialEvidence: notEvaluated(spec.spatialEvidence!, expected, reason) });
    if (!expected) { out.push(failed("нет поддерживаемого входа текущего сценария")); continue; }
    const key = simInputIdentity(expected), cached = cache.get(key);
    if (cached) { out.push({ ...spec, spatialEvidence: structuredClone(cached) }); continue; }
    if (now() >= deadline) { out.push(failed("исчерпан общий бюджет пространственных проверок проекта")); continue; }
    try {
      const result = await calculateProjectPreviewAsync(createSpatialProjectSnapshot({ requestId: "server-recheck", scenarioKey: spec.key,
        scenarioName: spec.name, variantId: "calculated", input: expected }), { ...options, now, deadline });
      if (!result.assessment.terminal || result.assessment.status === "RUNNING") { out.push(failed("прогон не завершён")); continue; }
      const evidence: SpatialEvidence = {
        sourceInputKey: key, executionInputKey: simInputIdentity(result.input), simModelVersion: SPATIAL_MODEL_VERSION,
        input: structuredClone(expected),
        assessment: { status: result.assessment.status as SpatialEvidence["assessment"]["status"], headline: result.assessment.headline, terminal: true },
        summary: { fleet: result.summary.fleet, requiredPerH: result.summary.requiredPerH, achievedPerH: result.summary.achievedPerH,
          queueEnd: result.summary.queueEnd, waitP95Min: result.summary.waitP95Min },
      };
      cache.set(key, evidence);
      out.push({ ...spec, spatialEvidence: structuredClone(evidence) });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      checkExecution(options);
      out.push(failed(error instanceof Error ? error.message.slice(0, 1000) : "пространственный прогон недоступен"));
    }
  }
  return out;
}
