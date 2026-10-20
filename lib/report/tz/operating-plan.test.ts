import { describe, expect, it } from "vitest";
import { cleaningContext, cleaningSpecs, TEST_CLEANER, TEST_CLEANING_PROFILE } from "../../tz/econ/cleaning-fixtures";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectReport } from "../../../components/report/tz/project-report";
import { buildProjectModel, storedPartOf } from "../../tz/model";
import { paramSpecsFor } from "../../data/organizer/params";
import { defaultPilotPlan } from "../../tz/pilot-budget";
import type { PilotAcceptanceThresholds, PilotObservation } from "../../tz/types";
function thresholds(): PilotAcceptanceThresholds {
  return { schemaVersion: "pilot-acceptance-1", scope: "Участок А", metric: "accepted-area-m2-day", source: "Критерии теста", date: "2026-10-01", minAcceptedPerUnit: 1000, minPlanCompletionPct: 100, maxManualReworkPct: 5, maxDowntimePct: 10, maxIncidents: 0, maxInterventionsPerShift: 1, minCustomerScore: 4, minDurationDays: 2 };
}
function observation(): PilotObservation {
  return { schemaVersion: "pilot-observation-1", scope: "Участок А", metric: "accepted-area-m2-day", productSlug: TEST_CLEANER.slug, fleet: 2, periodStart: "2026-10-05", periodEnd: "2026-10-06", observedDays: 2, dayBasis: "working", acceptedQuantity: 2000, plannedQuantity: 2000, manualReworkQuantity: 100, scheduledHours: 16, downtimeHours: 1.6, incidents: 0, interventions: 2, shifts: 2, customerScore: 4, source: "Журнал теста", date: "2026-10-07" };
}
import { operatingPlanReportRows } from "./operating-plan";
import { projectCsv } from "./csv";
import { buildProjectXlsx } from "./xlsx";
import ExcelJS from "exceljs";

function example() {
  const ctx = cleaningContext(), specs = cleaningSpecs();
  ctx.params.cleaningAreaM2 = 800;
  specs[1]!.cleaningPlan = { schemaVersion: "cleaning-zones-1", source: "Тестовый план объекта", disjointAreaReason: "Разные помещения", robots: [{ id: "r1", productSlug: TEST_CLEANER.slug }], existingMachines: [],
    zones: [{ id: "z1", name: "Помещение А", floor: 2, areaM2: 800, cleaningsPerDay: 1, windowStartH: 0, windowH: 2, baselineLabourHoursPerDay: 4, retainedLabourHoursPerDay: 2, manualThroughputM2PerH: 100, existingMachineIds: [], assignments: [{ robotId: "r1", profile: { ...TEST_CLEANING_PROFILE, windowH: 2, workBeforeChargeH: 8, chargeH: 1 }, transferMin: 0, transferLabourMin: 0 }] }] };
  const model = buildProjectModel({ facility: "warehouse", params: ctx.params, products: Object.values(ctx.products), paramDefs: paramSpecsFor("warehouse"), norms: ctx.norms, scenarios: specs });
  const pilot = defaultPilotPlan(model, "c1");
  pilot.fleet = 2; pilot.durationDays = 2; pilot.acceptanceThresholds = thresholds(); pilot.actualResult = observation();
  model.scenarios[1]!.pilotPlan = pilot;
  return model;
}

describe("saved operating plan exports", () => {
  it("uses saved model identity, never the observation's self-declared identity", () => {
    const model = example(), before = structuredClone(model);
    expect(operatingPlanReportRows(model).find(row => row.label === "Фактическая приёмка пилота")?.value).toBe("PASS");
    model.scenarios[1]!.pilotPlan!.actualResult!.productSlug = "unrelated-model";
    expect(operatingPlanReportRows(model).find(row => row.label === "Фактическая приёмка пилота")?.value).toBe("INCOMPLETE");
    expect(before.scenarios[1]!.pilotPlan!.actualResult!.productSlug).toBe(TEST_CLEANER.slug);
    model.scenarios[1]!.pilotPlan!.productSlug = "unrelated-model";
    expect(operatingPlanReportRows(model).find(row => row.label === "Фактическая приёмка пилота")?.value).toBe("INCOMPLETE");
  });
  it("validates area and staffing with the same saved context as the engine", () => {
    const model = example();
    expect(operatingPlanReportRows(model).some(row => row.label === "Зона Помещение А, этаж 2")).toBe(true);
    model.paramsUsed.cleaningAreaM2 = 900;
    expect(operatingPlanReportRows(model).some(row => row.label === "План зон не оценён" && String(row.value).includes("площадью"))).toBe(true);
  });
  it("does not reevaluate a retired archive using today's model rules", () => {
    const model = example(); model.modelVersion = "retired-model";
    const rows = operatingPlanReportRows(model);
    expect(rows.some(row => row.label === "Архивный план работы")).toBe(true);
    expect(rows.some(row => row.label === "Фактическая приёмка пилота" || row.label === "План уборки по зонам")).toBe(false);
  });
  it("includes the same saved facts and zone rows in the printable report", () => {
    const model = example();
    const html = renderToStaticMarkup(createElement(ProjectReport, {
      project: { id: "operating-report-test", name: "Зоны", objectName: null, facility: "warehouse", paramsSource: { kind: "demo" } },
      results: { ...storedPartOf(model), calculatedAt: "2026-10-20T12:00:00Z", sim: {} }, defs: paramSpecsFor("warehouse"), changes: [], scenarioKey: "c1",
    }));
    expect(html).toContain("План работы и фактическая приёмка");
    expect(html).toContain("Зона Помещение А, этаж 2");
    expect(html).toContain("Фактическая приёмка пилота");
  });
  it("exports zonal and actual acceptance evidence into both CSV and Excel", async () => {
    const model = example(), before = structuredClone(model);
    expect(projectCsv(model, { projectName: "План зон" })).toContain("Фактическая приёмка пилота");
    const bytes = await buildProjectXlsx({ projectName: "План зон", results: model, defs: paramSpecsFor("warehouse") });
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(bytes as never);
    const values: unknown[] = []; wb.eachSheet(ws => ws.eachRow(row => row.eachCell(cell => values.push(cell.value))));
    expect(values).toContain("Фактическая приёмка пилота"); expect(values).toContain("Зона Помещение А, этаж 2");
    expect(model).toEqual(before);
  });
});
