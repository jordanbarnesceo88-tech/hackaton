import type { Db } from "../catalog/queries";
import { spatialEvidenceMatchesInput } from "../sim/spatial-evidence";
import type { ProjectResults, ScenarioSpec } from "../tz/types";
import { SIM_MODEL_VERSION, stableJson, TZ_MODEL_VERSION } from "../tz/version";
import { projectSnapshotModel } from "./archive";
import { buildBusinessExamplePreview } from "./business-example-model";
import { businessExample, type BusinessExampleId } from "./business-examples";
import { asProjectResults } from "./queries";
import { liveDataVersionFrom, type LiveInputs } from "./recalc";

export const BUSINESS_EXAMPLE_OWNER = "demo@demo.local";

/** Only these public, seeded projects may be read without an authenticated owner. */
export function businessExampleProjectId(id: BusinessExampleId): string {
  if (!businessExample(id)) throw new Error("Неизвестный учебный пример");
  return `demo-example-${id}`;
}

function submittedScenarios(scenarios: readonly ScenarioSpec[]) {
  return scenarios.map(({ spatialEvidence, ...input }) => { void spatialEvidence; return input; });
}

/** Compatibility check for seeded snapshots; the public demo independently calculates its current inputs. */
export function compatibleBusinessExampleSnapshot(live: LiveInputs, id: BusinessExampleId, saved: ProjectResults): boolean {
  try {
    if (saved.facility !== "warehouse" || saved.modelVersion !== TZ_MODEL_VERSION || saved.simModelVersion !== SIM_MODEL_VERSION ||
      !saved.runtime?.simInputs || !saved.sim || !Number.isFinite(Date.parse(saved.calculatedAt))) return false;
    const preview = buildBusinessExamplePreview(live, id);
    if (saved.dataVersion !== liveDataVersionFrom(live, saved) ||
      stableJson(saved.paramsUsed) !== stableJson(preview.model.paramsUsed) ||
      stableJson(submittedScenarios(saved.scenarios)) !== stableJson(submittedScenarios(preview.model.scenarios))) return false;
    for (const spec of preview.model.scenarios) {
      const expected = preview.model.simInputs[spec.key]?.calculated;
      if (!expected) continue;
      const evidence = saved.scenarios.find(s => s.key === spec.key)?.spatialEvidence;
      if (!spatialEvidenceMatchesInput(evidence, expected) || evidence.assessment.status === "NOT_EVALUATED" ||
        !saved.sim[spec.key] || stableJson(saved.runtime.simInputs[spec.key]?.calculated) !== stableJson(expected)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function readBusinessExampleSnapshot(db: Db, live: LiveInputs, id: BusinessExampleId) {
  const project = await db.project.findFirst({
    where: { id: businessExampleProjectId(id), isDemo: true, facilityTypeSlug: "warehouse", user: { email: BUSINESS_EXAMPLE_OWNER } },
    select: { results: true },
  });
  const results = asProjectResults(project?.results);
  return results && compatibleBusinessExampleSnapshot(live, id, results)
    ? { results, model: projectSnapshotModel(results) }
    : null;
}
