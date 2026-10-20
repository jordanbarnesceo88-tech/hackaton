import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ImplementationGuidePanel } from "../../../components/implementation/guide-panel";
import { validateProductSeeds } from "../../api/import";
import { productForCalcFromSeed } from "../../catalog/product-for-calc";
import { CATALOG } from "../../data/organizer/catalog";
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
  it("carries team terms and the customer guide through print, CSV and XLSX without upgrading them to SLA", async () => {
    const { results, product } = savedGuidance();
    product.implementation = buildImplementationSnapshot("cleaner", "Pudu");
    const snapshot = structuredClone(product.implementation);
    const notes = snapshot.providers.find(provider => provider.id === "alfa-service")!.teamNotes!;
    const rows = implementationReportRows(results);
    for (const note of notes) expect(rows.some(row => row.label === "Сведения команды, не договорный SLA" && row.text === note)).toBe(true);
    const printed = renderToStaticMarkup(createElement(ImplementationGuidePanel, { snapshot, expanded: true }));
    expect(printed).toContain("Работа заказчика");
    expect(printed).toContain(snapshot.guide!.customer[0]);
    expect(printed).toContain("не восстановления робота");
    expect(projectCsv(results, { projectName: "Клининг" })).toContain(notes[0]);
    const bytes = await buildProjectXlsx({ results, projectName: "Клининг", defs: fixtureDefs() });
    const workbook = new ExcelJS.Workbook();
    const buffer = new ArrayBuffer(bytes.byteLength); new Uint8Array(buffer).set(bytes);
    await workbook.xlsx.load(buffer);
    expect(JSON.stringify(workbook.getWorksheet("Внедрение")!.getSheetValues())).toContain(notes[0]);
    expect(product.implementation).toEqual(snapshot);
  });
  it("keeps an imported unknown-brand generic model free of inferred OEM materials in snapshots, print and exports", async () => {
    const original = CATALOG.find(seed => seed.slug === "yandex-robot-inventarizator")!;
    const checked = validateProductSeeds([{ ...structuredClone(original), slug: "unknown-brand-inventory", manufacturer: null,
      name: "Робот-инвентаризатор", organizerCatalogId: null, organizerRows: [] }]);
    expect(checked.ok).toBe(true);
    if (!checked.ok) throw new Error("Expected a valid unknown-brand import");
    const product = productForCalcFromSeed(checked.seeds[0]!);
    expect(product.manufacturer).toBeNull();
    expect(product.implementation!.resources).toEqual([]);
    const results = fixtureResults();
    results.scenarios = [{ key: "unknown-brand", name: "Неустановленный производитель", kind: "purchase",
      items: [{ productSlug: product.slug, process: product.processes[0]! }] }];
    results.productSnapshots = { [product.slug]: product };
    const recorded = structuredClone(results);
    const rows = implementationReportRows(results);
    expect(rows.some(row => row.label === "Материалы производителя" && row.text.includes("не сохранены"))).toBe(true);
    expect(rows.some(row => row.source.includes("yandex.ru"))).toBe(false);
    const printed = renderToStaticMarkup(createElement(ImplementationGuidePanel, { snapshot: product.implementation!, expanded: true }));
    expect(printed).not.toContain("https://robotics.yandex.ru/cases/market-inv");
    expect(printed).not.toContain("Яндекс Роботикс: инвентаризация");
    expect(projectCsv(results, { projectName: "Неизвестный OEM" })).not.toContain("Яндекс Роботикс");
    const bytes = await buildProjectXlsx({ results, projectName: "Неизвестный OEM", defs: fixtureDefs() });
    const workbook = new ExcelJS.Workbook();
    const buffer = new ArrayBuffer(bytes.byteLength); new Uint8Array(buffer).set(bytes);
    await workbook.xlsx.load(buffer);
    expect(JSON.stringify(workbook.getWorksheet("Внедрение")!.getSheetValues())).not.toContain("Яндекс Роботикс");
    expect(results).toEqual(recorded);
  });

  it("does not silently erase an already recorded OEM attribution when reading an unknown-brand archive", () => {
    const { results, product } = savedGuidance();
    product.manufacturer = null;
    const before = structuredClone(results);
    expect(JSON.stringify(implementationReportRows(results))).toContain("ronavi-robotics.ru/catalogue/h1500");
    expect(projectCsv(results, { projectName: "Историческая атрибуция" })).toContain("ronavi-robotics.ru/catalogue/h1500");
    expect(results).toEqual(before);
  });

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
