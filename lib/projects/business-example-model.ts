import { buildProjectModel } from "../tz/model";
import { businessExampleInputs, type BusinessExampleId } from "./business-examples";
import type { LiveInputs } from "./recalc";

/** Bootstrap inputs and provisional finances; the current guest endpoint calculates the complete result. */
export function buildBusinessExamplePreview(live: LiveInputs, id: BusinessExampleId) {
  const defaults = Object.fromEntries(live.paramDefs.filter(d => d.facility === "warehouse").map(d => [d.key, d.base]));
  const data = businessExampleInputs(id, defaults, live.products);
  const t0 = performance.now();
  const model = buildProjectModel({ ...live, facility: "warehouse", params: data.params, scenarios: data.scenarios });
  return { ...data, model, ms: performance.now() - t0 };
}
