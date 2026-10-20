import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { paramSpecsFor } from "../../data/organizer/params";
import { buildProjectModel } from "../../tz/model";
import { FIXTURE_PRODUCTS, WAREHOUSE_BASE_PARAMS, fixtureSpecs } from "../../tz/econ/fixtures";
import { resolveNorms } from "../../tz/norms";
import { defaultPilotPlan, PILOT_WORKS } from "../../tz/pilot-budget";
import { pilotReportRows } from "./rows";
import { projectCsv } from "./csv";
import { buildProjectXlsx } from "./xlsx";

function setup() {
  const input = { facility: "warehouse", params: { ...WAREHOUSE_BASE_PARAMS }, paramDefs: paramSpecsFor("warehouse"), products: FIXTURE_PRODUCTS, norms: resolveNorms(), scenarios: fixtureSpecs() };
  const first = buildProjectModel(input), plan = defaultPilotPlan(first, "p1");
  for (const key of Object.keys(PILOT_WORKS) as (keyof typeof PILOT_WORKS)[]) plan.costs[key] = { valueRub: 1000, source: "Оценка команды для участка пилота" };
  plan.fleet = 1; plan.targetThroughputPerH = 8; plan.readiness = ["power", "safety"];
  input.scenarios[1]!.pilotPlan = plan; input.scenarios[1]!.terminalResidualRub = 500_000; input.scenarios[1]!.terminalResidualSource = "Тестовая оценка чистой стоимости реализации на конец горизонта";
  return buildProjectModel(input);
}

describe("pilot and residual exports", () => {
  it("keeps scope, budget sources, readiness and terminal assumptions in JSON and CSV", () => {
    const m = setup(), copy = JSON.parse(JSON.stringify(m));
    expect(copy.scenarios.find((s: { key: string }) => s.key === "p1").pilotPlan.fleet).toBe(1);
    const rows = pilotReportRows(m);
    expect(rows.some(row => row.label === "Полный бюджет пилота" && row.valueRub !== null)).toBe(true);
    expect(rows.some(row => row.text.includes("Готово:") && row.text.includes("питание"))).toBe(true);
    expect(rows.some(row => row.source.includes("Оценка команды"))).toBe(true);
    const csv = projectCsv(m, { projectName: "Пилот" });
    expect(csv).toContain("Планы пилотов и оценочные бюджеты");
    expect(csv).toContain("полный сценарий");
    expect(csv).toContain("Чистая остаточная стоимость");
    expect(csv).toContain("500000");
  });
  it("does not export missing pilot costs as zero or assert a complete total", () => {
    const m = setup(), spec = m.scenarios.find(s => s.key === "p1")!;
    spec.pilotPlan!.costs.logistics.valueRub = null;
    const total = pilotReportRows(m).find(row => row.label === "Полный бюджет пилота");
    expect(total?.valueRub).toBeNull(); expect(total?.text).toBe("Не определён");
  });
  it("keeps residual in live Excel formulas, not just cached totals, and adds the same pilot budget sheet", async () => {
    const m = setup(), bytes = await buildProjectXlsx({ projectName: "Пилот", results: m, defs: paramSpecsFor("warehouse") });
    const wb = new ExcelJS.Workbook(), buffer = new ArrayBuffer(bytes.byteLength); new Uint8Array(buffer).set(bytes); await wb.xlsx.load(buffer);
    expect(wb.getWorksheet("Пилоты и бюджет")).toBeDefined();
    const sheet = wb.getWorksheet("Денежный поток")!;
    let residualHeader = 0;
    for (let row = 1; row <= sheet.rowCount; row++) if (sheet.getCell(row, 10).value === "Чистая остаточная стоимость, ₽") { residualHeader = row; break; }
    expect(residualHeader).toBeGreaterThan(0);
    const last = residualHeader + 6;
    expect(sheet.getCell(last, 10).value).toBe(500_000);
    expect(sheet.getCell(last, 7).formula).toBe(`F${last}-E${last}+J${last}`);
    const tcoCell = [...Array(sheet.rowCount)].map((_,i) => sheet.getCell(i+1,2)).find(cell => cell.formula?.includes("-SUM(J"));
    expect(tcoCell?.formula).toContain("-SUM(J");
    const purchase = m.results.find(result => result.key === "p1");
    if (purchase?.status !== "ok") throw new Error("Expected a financial result");
    expect(tcoCell?.result).toBe(purchase.tcoRub);
  });
  it("exports an unsupported archive as frozen recorded numbers without live formulas", async () => {
    const archived = setup(); archived.modelVersion = "retired-financial-model";
    const purchase = archived.results.find(result => result.key === "p1");
    if (purchase?.status !== "ok") throw new Error("Expected a financial result");
    purchase.npvRub = 123_456_789;
    const bytes = await buildProjectXlsx({ projectName: "Архив", results: archived, defs: paramSpecsFor("warehouse") });
    const wb = new ExcelJS.Workbook(), buffer = new ArrayBuffer(bytes.byteLength); new Uint8Array(buffer).set(bytes); await wb.xlsx.load(buffer);
    const values: ExcelJS.CellValue[] = [];
    wb.eachSheet(ws => ws.eachRow(row => row.eachCell(cell => values.push(cell.value))));
    expect(values.some(value => value && typeof value === "object" && ("formula" in value || "sharedFormula" in value))).toBe(false);
    expect(values).toContain(123_456_789);
    expect(wb.calcProperties.fullCalcOnLoad).not.toBe(true);
  });
});
