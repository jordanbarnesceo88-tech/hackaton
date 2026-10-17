import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { paramSpecsFor } from "../../data/organizer/params";
import { buildProjectModel } from "../../tz/model";
import { FIXTURE_PRODUCTS, WAREHOUSE_BASE_PARAMS, fixtureSpecs } from "../../tz/econ/fixtures";
import { resolveNorms } from "../../tz/norms";
import { projectCsv } from "./csv";
import { buildProjectXlsx } from "./xlsx";

describe("incremental staffing and package export", () => {
  it("preserves cash, scope and reasons in CSV/Excel, including live CF totals", async () => {
    const scenarios = fixtureSpecs();
    scenarios[1]!.operationsStaffing = { mode: "integrator", billing: "separate", annualFeeRub: 900_000, reason: "Смета диспетчеризации всей площадки — оценка" };
    scenarios[1]!.items[0]!.costPackage = { softwareIncludedInIntegration: true, repairsIncludedInService: true, includedChargers: 0, reason: "Состав предложения: ПО и ремонт включены — допущение" };
    const model = buildProjectModel({ facility: "warehouse", params: WAREHOUSE_BASE_PARAMS, paramDefs: paramSpecsFor("warehouse"), products: FIXTURE_PRODUCTS, norms: resolveNorms(), scenarios });
    const purchase = model.results.find(result => result.key === "p1");
    if (purchase?.status !== "ok") throw new Error("Expected financial scenario");
    const csv = projectCsv(model, { projectName: "Границы платежей" });
    expect(csv).toContain("900000"); expect(csv).toContain("Смета диспетчеризации всей площадки"); expect(csv).toContain("ПО и ремонт включены");
    expect(csv).toContain("за площадку один раз в год");
    const bytes = await buildProjectXlsx({ projectName: "Границы платежей", results: model, defs: paramSpecsFor("warehouse") });
    const wb = new ExcelJS.Workbook(); const buffer = new ArrayBuffer(bytes.byteLength); new Uint8Array(buffer).set(bytes); await wb.xlsx.load(buffer);
    const values: ExcelJS.CellValue[] = [];
    wb.eachSheet(sheet => sheet.eachRow(row => row.eachCell(cell => values.push(cell.value))));
    expect(values).toContain(900_000);
    expect(values.some(value => typeof value === "string" && value.includes("Смета диспетчеризации всей площадки"))).toBe(true);
    const lines = wb.getWorksheet("CAPEX и OPEX") ?? wb.worksheets.find(sheet => sheet.name.includes("CAPEX"));
    expect(lines).toBeDefined();
    const npv = values.find(value => value && typeof value === "object" && "formula" in value && value.formula?.includes("NPV(")) as ExcelJS.CellFormulaValue;
    expect(npv.result).toBe(purchase.npvRub);
    expect(JSON.parse(JSON.stringify(model)).scenarios[1].operationsStaffing).toEqual(scenarios[1]!.operationsStaffing);
  });
});
