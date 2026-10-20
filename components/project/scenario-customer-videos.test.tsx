import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { buildProjectModel } from "@/lib/tz/model";
import { paramSpecsFor } from "@/lib/data/organizer/params";
import { cleaningContext, cleaningSpecs, TEST_CLEANER } from "@/lib/tz/econ/cleaning-fixtures";
import { ScenarioCustomerVideos } from "./scenario-customer-videos";

const ctx = cleaningContext();
const model = buildProjectModel({ facility: "warehouse", params: ctx.params, norms: ctx.norms,
  products: [{ ...TEST_CLEANER, slug: "pudu-cc1" }], paramDefs: paramSpecsFor("warehouse"),
  scenarios: cleaningSpecs().map(scenario => ({ ...scenario, items: scenario.items.map(item => ({ ...item, productSlug: "pudu-cc1" })) })) });

it("shows only the calculated scenario's exact model videos after a successful calculation", () => {
  expect(model.results.find(result => result.key === "c1")?.status).toBe("ok");
  const html = renderToStaticMarkup(createElement(ScenarioCustomerVideos, { model, scenarioKey: "c1", id: "result-videos" }));
  expect(html).toContain("Wunderpark");
  expect(html).toContain("Видео по моделям сценария");
  expect(html).not.toContain("Ronavi");
});

it("shows no generic fallback for stale, baseline, absent, refused or unmatched results", () => {
  const render = (props: Partial<Parameters<typeof ScenarioCustomerVideos>[0]> = {}) => renderToStaticMarkup(createElement(ScenarioCustomerVideos, { model, scenarioKey: "c1", id: "result-videos", ...props }));
  expect(render({ stale: true })).toBe("");
  expect(render({ scenarioKey: "asis" })).toBe("");
  expect(render({ scenarioKey: "unknown" })).toBe("");
  expect(render({ scenarioKey: null })).toBe("");
  const refused = { ...model, results: model.results.map(result => ({ ...result, status: "refused" as const, refusal: { reason: "invalid_inputs" as const, message: "Недостаточно данных", fields: [] } })) };
  expect(render({ model: refused })).toBe("");
  const unmatched = { ...model, results: model.results.map(result => ({ ...result, items: result.items.map(item => ({ ...item, productSlug: "unmatched-model" })) })) };
  expect(render({ model: unmatched })).toBe("");
});
