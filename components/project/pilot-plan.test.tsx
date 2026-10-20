import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { paramSpecsFor } from "@/lib/data/organizer/params";
import { buildProjectModel } from "@/lib/tz/model";
import { FIXTURE_PRODUCTS, WAREHOUSE_BASE_PARAMS, fixtureSpecs } from "@/lib/tz/econ/fixtures";
import { resolveNorms } from "@/lib/tz/norms";
import { catalogProduct } from "@/lib/data/organizer/catalog";
import { productForCalcFromSeed } from "@/lib/catalog/product-for-calc";
import { defaultPilotPlan } from "@/lib/tz/pilot-budget";
import { PilotPlan } from "./pilot-plan";

const model = () => buildProjectModel({ facility: "warehouse", params: { ...WAREHOUSE_BASE_PARAMS }, paramDefs: paramSpecsFor("warehouse"), products: FIXTURE_PRODUCTS, norms: resolveNorms(), scenarios: fixtureSpecs() });

describe("pilot plan presentation", () => {
  it("offers a separate first-month quote for a RaaS pilot and prints its one-off premium", () => {
    const m = model();
    const plan = defaultPilotPlan(m, "r1");
    plan.equipmentUnitRubOverride = 300000;
    plan.raasFirstMonthRubOverride = 400000;
    const html = renderToStaticMarkup(createElement(PilotPlan, {
      model: m, scenarioKey: "r1", draft: { plan, residual: 0 }, onChange: () => {},
    }));
    expect(html).toContain("Полная ставка первого месяца пилота за робота");
    expect(html).toContain('value="400000"');
    expect(html).toContain("Доплата первого месяца RaaS на пилот");
    expect(html).toContain("другого предложения");
  });
  it("shows known country and dated source without calling it unknown, but keeps local service separate", () => {
    const m = model(), seed = catalogProduct("ronavi-h1500")!;
    m.productSnapshots[seed.slug] = productForCalcFromSeed(seed);
    const html = renderToStaticMarkup(createElement(PilotPlan, { model: m, scenarioKey: "p1", readOnly: true }));
    expect(html).toContain("Страна происхождения по каталожному источнику: Россия");
    expect(html).toContain("https://ronavi-robotics.ru/catalogue/h1500");
    expect(html).toContain("дата источника 2026-09-23");
    expect(html).toContain("Местный сервис, срок поставки, запчасти и логистика должны быть согласованы для объекта");
    expect(html).not.toContain("Страна производства, местный сервис");
    m.productSnapshots[seed.slug]!.sources = m.productSnapshots[seed.slug]!.sources.filter(source => source.key !== "countryOfOrigin");
    expect(renderToStaticMarkup(createElement(PilotPlan, { model: m, scenarioKey: "p1", readOnly: true }))).toContain("не указана; уточнить у поставщика");
  });
  it("keeps unknown work costs visible in the read-only report and hides editing controls", () => {
    const html = renderToStaticMarkup(createElement(PilotPlan, { model: model(), scenarioKey: "p1", readOnly: true }));
    expect(html).toContain("Полный бюджет пилота"); expect(html).toContain("Не определён");
    expect(html).toContain("План ещё не задан"); expect(html).toContain("Доставка и обратная логистика");
    expect(html).toContain("Выполнение нагрузки полного парка не доказано");
    expect(html).not.toContain("<input"); expect(html).not.toContain("<form");
    expect(html).toContain("Остаточная стоимость исключена из денежного потока и NPV.");
    expect(html).not.toContain("Входит в последний денежный поток и NPV выбранного горизонта.");
  });
  it("renders persisted separate scope, calendar period and net residual horizon truthfully", () => {
    const m = model(), spec = m.scenarios.find(s => s.key === "p1")!;
    spec.pilotPlan = { ...defaultPilotPlan(m, "p1"), fleet: 1, durationDays: 30, dayBasis: "calendar", targetThroughputPerH: 7 };
    spec.terminalResidualRub = 100_000;
    const html = renderToStaticMarkup(createElement(PilotPlan, { model: m, scenarioKey: "p1", readOnly: true }));
    expect(html).toContain("1 робот"); expect(html).toContain("календарных"); expect(html).toContain("7 операций/ч");
    expect(html).toContain("Остаточная стоимость сценария после 5 лет"); expect(html).not.toContain("План ещё не задан");
  });
  it("does not invent a pilot for the baseline scenario", () => {
    const html = renderToStaticMarkup(createElement(PilotPlan, { model: model(), scenarioKey: "asis", readOnly: true }));
    expect(html).toContain("рассчитанного сценария"); expect(html).not.toContain("data-pilot-budget");
  });
});
