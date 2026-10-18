import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildImplementationSnapshot } from "../../implementation/snapshot";
import { projectCsv } from "./csv";
import { implementationReportRows } from "./implementation";
import { fixtureDefs, fixtureResults } from "./test-fixtures";
import { buildProjectXlsx } from "./xlsx";

function savedGuidance() {
  const results = structuredClone(fixtureResults());
  const spec = results.scenarios.find(scenario => scenario.kind === "purchase")!;
  const product = results.productSnapshots[spec.items[0]!.productSlug]!;
  product.implementation = buildImplementationSnapshot("pallet-amr", "Ronavi", undefined, "Ronavi H1500");
  expect(product.implementation.resources?.map(resource => resource.id)).toContain("ronavi-h1500-spec");
  return { results, product };
}

describe("saved implementation guidance in CSV and XLSX", () => {
  it("exports preparation, contacts, unknown SLA and model sources even without a persisted pilot budget", async () => {
    const { results } = savedGuidance();
    expect(results.scenarios.every(scenario => !scenario.pilotPlan)).toBe(true);
    const rows = implementationReportRows(results);
    const text = JSON.stringify(rows);
    expect(text).toContain("Подготовка объекта");
    expect(text).toContain("Шаги заказчика");
    expect(text).toContain("Ronavi Robotics");
    expect(text).toContain("договор на объект не подтверждён");
    expect(text).toContain("Реакция: не опубликована");
    expect(text).toContain("Спецификация производителя");
    expect(text).toContain("https://ronavi-robotics.ru/catalogue/h1500");
    expect(text).toContain("Проезд 750 мм указан для робота");
    const csv = projectCsv(results, { projectName: "Источники внедрения" });
    for (const value of ["Подготовка внедрения и материалы производителей", "Спецификация производителя", "https://ronavi-robotics.ru/catalogue/h1500", "Реакция: не опубликована"]) expect(csv).toContain(value);
    const bytes = await buildProjectXlsx({ results, projectName: "Источники внедрения", defs: fixtureDefs() });
    const workbook = new ExcelJS.Workbook();
    const buffer = new ArrayBuffer(bytes.byteLength); new Uint8Array(buffer).set(bytes);
    await workbook.xlsx.load(buffer);
    const values = workbook.getWorksheet("Внедрение")!.getSheetValues();
    expect(values.slice(2).map(row => (row as unknown[]).slice(1))).toEqual(rows.map(row => [row.productName, row.label, row.text, row.source]));
  });

  it("preserves the recorded material and contact rather than replacing them from the current registry", async () => {
    const { results, product } = savedGuidance();
    product.implementation!.resources![0]!.title = "ARCHIVED_MODEL_MATERIAL";
    product.implementation!.providers[0]!.name = "ARCHIVED_SERVICE_CONTACT";
    const recorded = JSON.stringify(results);
    expect(buildImplementationSnapshot("pallet-amr", "Ronavi", undefined, "Ronavi H1500").resources![0]!.title).not.toBe("ARCHIVED_MODEL_MATERIAL");
    expect(JSON.stringify(implementationReportRows(results))).toContain("ARCHIVED_MODEL_MATERIAL");
    expect(projectCsv(results, { projectName: "Архив" })).toContain("ARCHIVED_SERVICE_CONTACT");
    const bytes = await buildProjectXlsx({ results, projectName: "Архив", defs: fixtureDefs() });
    const workbook = new ExcelJS.Workbook();
    const buffer = new ArrayBuffer(bytes.byteLength); new Uint8Array(buffer).set(bytes);
    await workbook.xlsx.load(buffer);
    expect(JSON.stringify(workbook.getWorksheet("Внедрение")!.getSheetValues())).toContain("ARCHIVED_MODEL_MATERIAL");
    expect(JSON.stringify(results)).toBe(recorded);
  });

  it("does not invent live guidance or manuals for old snapshots", () => {
    const { results, product } = savedGuidance();
    delete product.implementation;
    const rows = implementationReportRows(results).filter(row => row.productName === product.name);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.text).toContain("не сохранены");
    expect(JSON.stringify(rows)).not.toContain("ronavi-robotics.ru");
    product.implementation = buildImplementationSnapshot("pallet-amr", "Ronavi", undefined, "Ronavi H1500");
    delete product.implementation.resources;
    const archived = implementationReportRows(results);
    expect(JSON.stringify(archived)).toContain("Проверенные модельные материалы в снимке не сохранены");
    expect(archived.some(row => row.label === "Спецификация производителя")).toBe(false);
  });
});
