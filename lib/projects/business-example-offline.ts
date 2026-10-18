import { simInputIdentity } from "../sim/identity";
import { SPATIAL_MODEL_VERSION } from "../sim/spatial-bridge";
import { buildBusinessExamplePreview } from "./business-example-model";
import type { BusinessExampleId } from "./business-examples";
import { resultsFromInputs, type LiveInputs } from "./recalc";

/** Full deterministic calculation for seeding and offline verification; never called by a page. */
export function buildBusinessExampleOffline(live: LiveInputs, id: BusinessExampleId) {
  const preview = buildBusinessExamplePreview(live, id);
  const scenarios = preview.model.scenarios.map(spec => {
    const input = preview.model.simInputs[spec.key]?.calculated;
    if (!input) return spec;
    // This internal request is replaced by the canonical replay before anything is persisted.
    return { ...spec, spatialEvidence: {
      input, sourceInputKey: simInputIdentity(input), executionInputKey: "offline-example-replay-request",
      simModelVersion: SPATIAL_MODEL_VERSION,
      assessment: { status: "NOT_EVALUATED" as const, headline: "Запрос проверки учебного примера", terminal: true as const },
      summary: { fleet: input.robots.count, requiredPerH: input.demand.peakPerH, achievedPerH: 0, queueEnd: 0, waitP95Min: 0 },
    } };
  });
  const started = performance.now();
  const computed = resultsFromInputs(live, { facility: "warehouse", params: preview.params, scenarios });
  return { ...preview, ...computed, ms: performance.now() - started };
}
