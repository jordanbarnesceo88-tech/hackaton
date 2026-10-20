import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { paramSpecsFor } from "../../lib/data/organizer/params";
import { cleaningContext, cleaningSpecs, TEST_CLEANER } from "../../lib/tz/econ/cleaning-fixtures";
import { buildProjectModel } from "../../lib/tz/model";
import { DecisionSummary } from "./decision-summary";

it("renders cleaning finance as a schedule forecast with its own labour assumptions", () => {
  const ctx = cleaningContext();
  const model = buildProjectModel({ facility: "warehouse", params: ctx.params, norms: ctx.norms,
    products: [TEST_CLEANER], paramDefs: paramSpecsFor("warehouse"), scenarios: cleaningSpecs() });
  const html = renderToStaticMarkup(createElement(DecisionSummary, { model, scenarioKey: "c1", onSimulation() {} }));
  expect(html).toContain("Расчётная уборка / требуется");
  expect(html).toContain("Посмотреть расписание");
  expect(html).toContain("рабочий профиль");
  expect(html).not.toContain("Модель не поддерживается");
  expect(html).not.toContain("Критерии выполнены");
});
