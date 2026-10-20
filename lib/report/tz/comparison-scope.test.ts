import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { paramSpecsFor } from "../../data/organizer/params";
import { TEST_CLEANER, cleaningContext, cleaningSpecs } from "../../tz/econ/cleaning-fixtures";
import { FIXTURE_PRODUCTS } from "../../tz/econ/fixtures";
import { buildProjectModel, storedPartOf } from "../../tz/model";
import type { ScenarioSpec } from "../../tz/types";
import { comparisonReportRows } from "./tables";
import { buildProjectXlsx } from "./xlsx";

function snapshot() {
  const ctx = cleaningContext(), defs = paramSpecsFor("warehouse");
  const model = buildProjectModel({ facility: "warehouse", params: ctx.params, norms: ctx.norms,
    products: [TEST_CLEANER, ...FIXTURE_PRODUCTS], scenarios: cleaningSpecs(), paramDefs: defs });
  return { defs, results: { ...storedPartOf(model, defs), calculatedAt: "2026-10-20T00:00:00.000Z", sim: {} } };
}

describe("comparison scope in frozen report/XLSX presentation", () => {
  it("exports cleaning comparison rows without unrelated processes and leaves the archived payload intact", async () => {
    const { results, defs } = snapshot(), before = structuredClone(results);
    expect(results.comparison.some(row => row.process !== "cleaning")).toBe(true);
    expect(comparisonReportRows(results).map(row => row.process)).toEqual(["cleaning"]);
    const bytes = await buildProjectXlsx({ projectName: "Уборка", results, defs });
    const book = new ExcelJS.Workbook();
    const buffer = new ArrayBuffer(bytes.byteLength); new Uint8Array(buffer).set(bytes); await book.xlsx.load(buffer);
    const sheet = book.worksheets.find(sheet => sheet.getColumn(1).values.some(value => value === "Сравнение решений по единым характеристикам"))!;
    expect(sheet).toBeDefined();
    const titleRow = sheet.getColumn(1).values.findIndex(value => value === "Сравнение решений по единым характеристикам");
    const processes: unknown[] = [];
    for (let row = titleRow + 2; row <= sheet.rowCount; row++) processes.push(sheet.getCell(row, 1).value);
    expect(processes).toEqual(["Уборка склада"]);
    expect(results).toEqual(before);
  });

  it("keeps every selected process in mixed scenarios rather than only the first or focused one", () => {
    const { results } = snapshot();
    const extra: ScenarioSpec = { key: "mixed-raas", name: "Паллеты", kind: "raas", items: [{ process: "pallet-transport", productSlug: FIXTURE_PRODUCTS[0]!.slug }] };
    results.scenarios.push(extra);
    const rows = comparisonReportRows(results);
    expect(new Set(rows.map(row => row.process))).toEqual(new Set(["cleaning", "pallet-transport"]));
    expect(rows.length).toBe(results.comparison.filter(row => row.process === "cleaning" || row.process === "pallet-transport").length);
  });

  it("retains the original catalogue scope for an archive without any robot scenario", () => {
    const { results } = snapshot();
    results.scenarios = results.scenarios.filter(scenario => scenario.kind === "asis");
    const before = structuredClone(results);
    expect(comparisonReportRows(results).map(row => row.process)).toEqual(results.comparison.map(row => row.process));
    expect(results).toEqual(before);
  });
});
