import { buildProjectModel } from "../tz/model";
import { simInputIdentity } from "../sim/identity";
import { SPATIAL_MODEL_VERSION } from "../sim/spatial-bridge";
import { businessExampleInputs, type BusinessExampleId } from "./business-examples";
import { resultsFromInputs, resultsFromInputsAsync, type LiveInputs } from "./recalc";

/** Examples use the same canonical server checks and financial model as a saved project. */
export function buildBusinessExample(live: LiveInputs, id: BusinessExampleId) {
  const { data, scenarios } = prepareBusinessExample(live, id);
  const t0 = performance.now();
  const computed = resultsFromInputs(live, { facility: "warehouse", params: data.params, scenarios });
  return { ...data, ...computed, ms: performance.now() - t0 };
}

export async function buildBusinessExampleAsync(live: LiveInputs, id: BusinessExampleId) {
  const { data, scenarios } = prepareBusinessExample(live, id);
  const t0 = performance.now();
  const computed = await resultsFromInputsAsync(live, { facility: "warehouse", params: data.params, scenarios });
  return { ...data, ...computed, ms: performance.now() - t0 };
}

function prepareBusinessExample(live: LiveInputs, id: BusinessExampleId) {
  const defaults = Object.fromEntries(live.paramDefs.filter(d => d.facility === "warehouse").map(d => [d.key, d.base]));
  const data = businessExampleInputs(id, defaults, live.products);
  const first = buildProjectModel({ ...live, facility: "warehouse", params: data.params, scenarios: data.scenarios });
  const scenarios = first.scenarios.map(spec => {
    const input = first.simInputs[spec.key]?.calculated;
    if (!input) return spec;
    return { ...spec, spatialEvidence: {
      input, sourceInputKey: simInputIdentity(input), executionInputKey: "example-awaits-server-check", simModelVersion: SPATIAL_MODEL_VERSION,
      assessment: { status: "NOT_EVALUATED" as const, headline: "Пример ожидает серверной проверки", terminal: true as const },
      summary: { fleet: input.robots.count, requiredPerH: input.demand.peakPerH, achievedPerH: 0, queueEnd: 0, waitP95Min: 0 },
    } };
  });
  return { data, scenarios };
}
