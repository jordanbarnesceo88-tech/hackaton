import { buildProjectModel } from "../tz/model";
import { processesForFacility } from "../tz/processes";
import { selectProducts } from "../tz/selection";
import { defaultScenarios } from "./defaults";
import type { LiveInputs } from "./recalc";

/** Exact catalogue choice; the normal selection rules remain authoritative. No product substitution. */
export function buildProductDemoPreview(live: LiveInputs, facility: string, slug: string) {
  const product = live.products.find(candidate => candidate.slug === slug);
  if (!product) return { ok: false as const, reason: "Выбранный продукт не участвует в действующем подборе этого типа объекта." };
  const process = processesForFacility(facility).find(candidate => candidate.calcSupported && product.processes.includes(candidate.slug) && product.facilityTypes.includes(facility));
  if (!process) return { ok: false as const, reason: "Для выбранного продукта и типа объекта нет процесса с поддерживаемым расчётом экономики." };
  const params = Object.fromEntries(live.paramDefs.filter(def => def.facility === facility).map(def => [def.key, def.base]));
  const input = { ...live, facility, params };
  const selection = selectProducts({ facility, params, process, products: [product], norms: live.norms });
  const chosen = selection.find(row => row.status === "recommended" || row.status === "candidate");
  if (!chosen) return { ok: false as const, reason: selection.flatMap(row => [...row.reasons, ...row.missing.map(item => item.howToFix)]).join(" ") || "Выбранный продукт не прошёл подбор по базовым условиям демо. Проверьте применимость в карточке продукта." };
  // A one-product pool makes purchase and RaaS refer to this same product even if its RaaS rate is absent.
  const scenarios = defaultScenarios(selection, facility, [product]);
  const started = performance.now();
  const model = buildProjectModel({ ...input, scenarios });
  return { ok: true as const, product, params, model, ms: performance.now() - started };
}
