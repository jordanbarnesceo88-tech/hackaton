import ExcelJS from "exceljs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProjectReport } from "../../../components/report/tz/project-report";
import { computeScenarios } from "../../tz/econ";
import { fixtureContext } from "../../tz/econ/fixtures";
import { defaultPilotPlan } from "../../tz/pilot-budget";
import type { ScenarioOk } from "../../tz/types";
import { DeploymentLogistics } from "../../../components/project/deployment-logistics";
import { projectCsv } from "./csv";
import { fixtureDefs, fixtureResults } from "./test-fixtures";
import { buildProjectXlsx } from "./xlsx";
import { scenarioTableRows } from "./rows";

function sample() {
  const results = fixtureResults();
  results.scenarios.find(s => s.key === "p1")!.logistics = { mode: "separate", costRub: 234_567, source: "КП LOG-42: перевозка всего парка с НДС и страховкой" };
  results.results = computeScenarios(fixtureContext(20), results.scenarios);
  return results;
}

describe("delivery is traceable in the full financial exports", () => {
  it("retains explicit source and one-off CAPEX in JSON, CSV and printable report without copying pilot logistics", () => {
    const results = sample();
    const csv = projectCsv(results, { projectName: "Поставка" });
    const html = renderToStaticMarkup(createElement(ProjectReport, { project: { id: "test", name: "Поставка", objectName: "Объект", facility: "warehouse", paramsSource: { kind: "demo" } }, results, defs: fixtureDefs(), changes: [] }));
    for (const output of [csv, html, JSON.stringify(results)]) {
      expect(output).toContain("LOG-42");
      expect(output).toContain("Доставка полного внедрения");
    }
    expect(csv).toContain("234567");
    // Pilot intake stays unknown even when the full deployment has a delivery quote.
    expect(defaultPilotPlan(results, "p1").costs.logistics.valueRub).toBeNull();
  });

  it("exports the separate CAPEX row and identical cashflow/ROI totals through XLSX", async () => {
    const results = sample();
    const bytes = await buildProjectXlsx({ projectName: "Поставка", results, defs: fixtureDefs() });
    const wb = new ExcelJS.Workbook(), buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes); await wb.xlsx.load(buffer);
    const sheet = wb.getWorksheet("Статьи CAPEX") ?? wb.worksheets.find(s => s.name.includes("CAPEX"));
    expect(sheet).toBeDefined();
    const deliveryRows: ExcelJS.Row[] = [];
    sheet!.eachRow(row => { if (JSON.stringify(row.values).includes("Доставка полного внедрения")) deliveryRows.push(row); });
    expect(deliveryRows).toHaveLength(1);
    expect(JSON.stringify(deliveryRows[0]!.values)).toContain("234567");
    expect(JSON.stringify(deliveryRows[0]!.values)).toContain("LOG-42");
    const purchase = results.results.find(r => r.key === "p1") as ScenarioOk;
    const cells: ExcelJS.Cell[] = [];
    wb.getWorksheet("Денежный поток")!.eachRow(row => row.eachCell(cell => cells.push(cell)));
    expect(cells.some(cell => cell.formula?.includes("+NPV(") && cell.result === purchase.npvRub)).toBe(true);
    expect(cells.some(cell => cell.formula?.endsWith("-100,\"—\")") && cell.result === purchase.roiNetPct)).toBe(true);
  });

  it("distinguishes unassessed and included delivery in editable/read-only UI and preserves old archive composition", () => {
    const unknown = renderToStaticMarkup(createElement(DeploymentLogistics, { readOnly: true }));
    expect(unknown).toContain("не оценена"); expect(unknown).not.toContain("<form");
    const included = renderToStaticMarkup(createElement(DeploymentLogistics, { value: { mode: "included", source: "Договор №7, включено в цену" }, onChange: () => {} }));
    expect(included).toContain("Договор №7"); expect(included).toContain("Уточнить условия доставки");
    const archived = fixtureResults(); archived.modelVersion = "tz-retired";
    for (const result of archived.results) result.risks = result.risks.filter(r => !r.code.startsWith("LOGISTICS_"));
    expect(scenarioTableRows(archived).find(row => row.rowKey === "composition")!.cells.join(" ")).not.toContain("Доставка полного внедрения");
  });
});
