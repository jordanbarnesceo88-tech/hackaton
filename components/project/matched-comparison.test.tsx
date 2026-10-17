import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { paramSpecsFor } from "@/lib/data/organizer/params";
import { FIXTURE_H1500, WAREHOUSE_BASE_PARAMS } from "@/lib/tz/econ/fixtures";
import { buildMatchedComparison } from "@/lib/tz/matched-comparison";
import { resolveNorms } from "@/lib/tz/norms";
import type { ScenarioSpec } from "@/lib/tz/types";
import { MatchedComparison } from "./matched-comparison";

function comparison(missingPrice = false, missingRate = false) {
  const source: ScenarioSpec = { key: "source", name: "Исходный", kind: "purchase", cashRealizationShare: 0, items: [{ process: "pallet-transport", productSlug: FIXTURE_H1500.slug }] };
  return buildMatchedComparison({ source, input: { facility: "warehouse", params: { ...WAREHOUSE_BASE_PARAMS }, paramDefs: paramSpecsFor("warehouse"), norms: resolveNorms(), products: [{ ...FIXTURE_H1500, ...(missingPrice ? { priceRub: null } : {}), ...(missingRate ? { raasRubMonth: null } : {}) }], scenarios: [source] } });
}
describe("matched comparison presentation", () => {
  it("shows truthful financial assumptions, unverified flow and both exports", () => {
    const html = renderToStaticMarkup(createElement(MatchedComparison, { comparison: comparison(), onAdopt: () => {} }));
    expect(html).toContain("Предварительная экономика");
    expect(html).toContain("Нужна проверка потока");
    expect(html).not.toContain("Подтверждено моделью");
    expect(html).toContain("0 %");expect(html).toContain("горизонт 5 лет");
    expect(html).toContain("Сравнение JSON");expect(html).toContain("Сравнение CSV");
    expect(html).toContain("Остаточная стоимость — 0");
    expect(html).toContain("совместимость грузоносителя");
  });
  it("leaves refused money visibly unknown and disables readonly adoption", () => {
    const html = renderToStaticMarkup(createElement(MatchedComparison, { comparison: comparison(true), onAdopt: () => {}, readOnly: true }));
    expect(html).toContain("Нет цены");expect(html).toContain("Не рассчитан");
    const actions = html.match(/<button[^>]*disabled=""[^>]*>Создать сценарий<\/button>/g) ?? [];
    expect(actions).toHaveLength(2);
    const noRate = renderToStaticMarkup(createElement(MatchedComparison, { comparison: comparison(false, true) }));
    expect(noRate).not.toContain("Подставить оценку");
    expect(noRate.match(/Нет ставки RaaS/g)).toHaveLength(1);
  });
});
