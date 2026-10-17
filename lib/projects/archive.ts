import type { ProjectModel } from "../tz/model";
import type { ParamValues, ProjectResults, ScenarioSpec } from "../tz/types";
import { stableJson } from "../tz/version";

/** Read a snapshot without invoking current algorithms, bounds, catalogue or simulation. */
export function projectSnapshotModel(stored: ProjectResults): ProjectModel {
  const { calculatedAt, sim, ...snapshot } = structuredClone(stored);
  void calculatedAt; void sim;
  return { ...snapshot, layout: snapshot.runtime?.layout ?? null,
    simInputs: snapshot.runtime?.simInputs ?? Object.fromEntries(snapshot.scenarios.map(s => [s.key, {
      calculated: null, byNorm: null, assumedUtilPct: null, provenance: null,
      unavailableReason: "В архиве нет сохранённого входа имитации. Для нового прогона явно пересчитайте проект или его копию.",
    }])) };
}

export function projectDraftKey(params: ParamValues, scenarios: readonly ScenarioSpec[]): string {
  return stableJson({ params, scenarios });
}

/** The server receipt must not replace edits made while its request was in flight. */
export function canAdoptSavedSnapshot(
  current: { params: ParamValues; scenarios: readonly ScenarioSpec[] },
  submitted: { params: ParamValues; scenarios: readonly ScenarioSpec[] },
): boolean {
  return projectDraftKey(current.params, current.scenarios) === projectDraftKey(submitted.params, submitted.scenarios);
}
