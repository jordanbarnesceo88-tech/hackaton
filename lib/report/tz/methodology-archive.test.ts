import ExcelJS from "exceljs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProjectReport } from "../../../components/report/tz/project-report";
import { FORMULAS } from "../../tz/econ/formulas";
import { MODEL_LIMITATIONS } from "../../tz/econ/limitations";
import { fixtureContext, fixtureSpecs, FIXTURE_PRODUCTS } from "../../tz/econ/fixtures";
import { buildProjectModel, storedPartOf } from "../../tz/model";
import { captureMethodologySnapshot } from "../../tz/methodology";
import { SIM_MODEL_VERSION, TZ_MODEL_VERSION } from "../../tz/version";
import { projectSnapshotModel } from "../../projects/archive";
import { fixtureDefs, fixtureResults } from "./test-fixtures";
import { formulaRows, modelLimitations, MISSING_METHODOLOGY_SNAPSHOT } from "./tables";
import { buildProjectXlsx } from "./xlsx";

const project = { id: "archive", name: "Архив", objectName: "Участок", facility: "warehouse", paramsSource: { kind: "demo" as const } };

describe("methodology appendix belongs to the saved calculation", () => {
  it("captures definitions and limitations as detached values and retains them in storedPartOf", () => {
    const model = buildProjectModel({ facility: "warehouse", params: fixtureContext().params, paramDefs: fixtureDefs(), products: FIXTURE_PRODUCTS, norms: fixtureContext().norms, scenarios: fixtureSpecs() });
    const saved = storedPartOf(model);
    expect(saved.methodologySnapshot).toEqual(captureMethodologySnapshot());
    expect(saved.methodologySnapshot).toMatchObject({ schemaVersion: "methodology-snapshot-1", modelVersion: TZ_MODEL_VERSION, simModelVersion: SIM_MODEL_VERSION });
    expect(saved.methodologySnapshot!.limitations).not.toBe(MODEL_LIMITATIONS);
    const rows = formulaRows({ ...saved, calculatedAt: "2026-10-18T00:00:00Z", sim: {} });
    rows[0]!.expression = "consumer edit";
    expect(saved.methodologySnapshot!.formulas[0]!.expression).not.toBe("consumer edit");
  });

  it("exports the recorded old method even if current registry text changes; old numbers remain values", async () => {
    const archived = fixtureResults();
    archived.modelVersion = "tz-historical-recorded";
    archived.methodologySnapshot!.modelVersion = archived.modelVersion;
    archived.methodologySnapshot!.formulas = [{ key: "saved-formula", title: "Сохранённая формула", expression: "ARCHIVE_ONLY_FORMULA", units: "₽", source: "Сохранённый источник" }];
    archived.methodologySnapshot!.limitations = ["ARCHIVE_ONLY_LIMITATION"];
    const recorded = JSON.stringify(archived);
    const formula = FORMULAS.roiNet as { expression: string };
    const originalExpression = formula.expression, originalLimit = MODEL_LIMITATIONS[0]!;
    try {
      formula.expression = "LIVE_ONLY_FORMULA_DO_NOT_EXPORT";
      (MODEL_LIMITATIONS as string[])[0] = "LIVE_ONLY_LIMITATION_DO_NOT_EXPORT";
      const html = renderToStaticMarkup(createElement(ProjectReport, { project, results: archived, defs: fixtureDefs(), changes: [] }));
      expect(html).toContain("ARCHIVE_ONLY_FORMULA"); expect(html).toContain("ARCHIVE_ONLY_LIMITATION");
      expect(html).toContain("Формулы модели tz-historical-recorded");
      expect(html).not.toContain("LIVE_ONLY_");
      const bytes = await buildProjectXlsx({ projectName: "Архив", results: archived, defs: fixtureDefs() });
      const wb = new ExcelJS.Workbook(), buffer = new ArrayBuffer(bytes.byteLength); new Uint8Array(buffer).set(bytes); await wb.xlsx.load(buffer);
      const text = JSON.stringify(wb.getWorksheet("О расчёте")!.getSheetValues());
      expect(text).toContain("ARCHIVE_ONLY_FORMULA"); expect(text).toContain("ARCHIVE_ONLY_LIMITATION");
      expect(text).not.toContain("LIVE_ONLY_"); expect(text).not.toContain("записаны живыми формулами");
      expect(text).toContain("без живых формул Excel");
      wb.eachSheet(sheet => sheet.eachRow(row => row.eachCell(cell => expect(cell.formula).toBeUndefined())));
      expect(projectSnapshotModel(archived).methodologySnapshot).toEqual(archived.methodologySnapshot);
      expect(JSON.stringify(archived)).toBe(recorded);
    } finally {
      formula.expression = originalExpression;
      (MODEL_LIMITATIONS as string[])[0] = originalLimit;
    }
  });

  it("does not substitute live methodology into an older snapshot that lacks definitions", async () => {
    const archived = fixtureResults(); archived.modelVersion = "tz-without-methodology"; delete archived.methodologySnapshot;
    expect(formulaRows(archived)).toEqual([]);
    expect(modelLimitations(archived)).toEqual([MISSING_METHODOLOGY_SNAPSHOT]);
    const html = renderToStaticMarkup(createElement(ProjectReport, { project, results: archived, defs: fixtureDefs(), changes: [] }));
    expect(html).toContain("Снимок определений формул не сохранён");
    const formulaSection = html.split('id="formulas"')[1]!.split('</section>')[0]!;
    expect(formulaSection).not.toContain(FORMULAS.roiNet.expression);
    expect(formulaSection).toContain("Формулы модели tz-without-methodology");
    const bytes = await buildProjectXlsx({ projectName: "Без методики", results: archived, defs: fixtureDefs() });
    const wb = new ExcelJS.Workbook(), buffer = new ArrayBuffer(bytes.byteLength); new Uint8Array(buffer).set(bytes); await wb.xlsx.load(buffer);
    const about = JSON.stringify(wb.getWorksheet("О расчёте")!.getSheetValues());
    expect(about).toContain("Снимок определений формул не сохранён");
    expect(about).not.toContain(FORMULAS.roiNet.expression);
    expect(about).toContain(MISSING_METHODOLOGY_SNAPSHOT);
    expect(projectSnapshotModel(archived)).not.toHaveProperty("methodologySnapshot");
  });
});
