import ExcelJS from "exceljs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProjectReport } from "../../../components/report/tz/project-report";
import { normDef } from "../../tz/norms";
import { normLabelsFromSnapshot } from "../../tz/methodology";
import { changeFieldLabel as projectChangeFieldLabel } from "../../projects/changes";
import { changeRows } from "./rows";
import { fixtureDefs, fixtureResults } from "./test-fixtures";
import { normOverrideRows, normsReportRows } from "./tables";
import { buildProjectXlsx } from "./xlsx";

describe("norm definitions belong to the archived calculation", () => {
  it("retains frozen source, label and bounds across table, PDF markup and XLSX", async () => {
    const archived = fixtureResults();
    archived.scenarios[1]!.normOverrides = { laborShareAutomatable: 0.5 };
    const before = normsReportRows(archived), overrides = normOverrideRows(archived);
    const changes = [{ at: "2026-10-18T00:00:00Z", field: "norm:laborShareAutomatable", auto: 0.5, old: 0.5, new: 0.4 }];
    const recorded = JSON.stringify(archived);
    const def = normDef("laborShareAutomatable"), original = { ...def };
    try {
      Object.assign(def, { label: "LIVE_ONLY_LABEL", basis: "LIVE_ONLY_BASIS", sourceRef: "LIVE_ONLY_SOURCE", min: 0.2, max: 0.8 });
      expect(normsReportRows(archived)).toEqual(before);
      expect(normOverrideRows(archived)).toEqual(overrides);
      const labels = normLabelsFromSnapshot(archived);
      expect(changeRows(changes, { normLabels: labels })[0]!.fieldLabel).not.toContain("LIVE_ONLY_");
      expect(projectChangeFieldLabel(changes[0]!.field, {}, {}, labels)).not.toContain("LIVE_ONLY_");
      const html = renderToStaticMarkup(createElement(ProjectReport, {
        project: { id: "norm-archive", name: "Архив", facility: "warehouse", objectName: "Объект", paramsSource: { kind: "demo" } },
        results: archived, defs: fixtureDefs(), changes,
      }));
      expect(html).not.toContain("LIVE_ONLY_");
      const bytes = await buildProjectXlsx({ projectName: "Архив", results: archived, defs: fixtureDefs(), changes });
      const wb = new ExcelJS.Workbook(), buffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(buffer).set(bytes); await wb.xlsx.load(buffer);
      expect(JSON.stringify(wb.getWorksheet("Нормативы и допущения")!.getSheetValues())).not.toContain("LIVE_ONLY_");
      expect(JSON.stringify(wb.getWorksheet("Журнал корректировок")!.getSheetValues())).not.toContain("LIVE_ONLY_");
      expect(JSON.stringify(archived)).toBe(recorded);
    } finally { Object.assign(def, original); delete def.sourceRef; if (original.sourceRef !== undefined) def.sourceRef = original.sourceRef; }
  });

  it("does not invent current defaults or metadata when an older archive lacks definitions", () => {
    const archived = fixtureResults();
    delete archived.methodologySnapshot;
    const used = archived.normsUsed as Record<string, number | undefined>;
    delete used.simStorageVacancyShare;
    const rows = normsReportRows(archived);
    expect(rows.some(r => r.key === "simStorageVacancyShare")).toBe(false);
    const labour = rows.find(r => r.key === "laborShareAutomatable")!;
    expect(labour).toMatchObject({ label: "laborShareAutomatable", value: 0.5, defaultValue: null, min: null, max: null, changed: false });
    expect(labour.basis).toContain("Метаданные норматива не сохранены");
    expect(labour.basis).not.toContain("горизонтальная");
    const labels = normLabelsFromSnapshot(archived);
    const changes = [{ at: "2026-10-18T00:00:00Z", field: "norm:laborShareAutomatable", auto: 0.5, old: 0.5, new: 0.4 }];
    expect(changeRows(changes, { normLabels: labels })[0]!.fieldLabel).toBe("Норматив «laborShareAutomatable»");
    expect(projectChangeFieldLabel(changes[0]!.field, {}, {}, labels)).toBe("Норматив: laborShareAutomatable");
    expect(changeRows([{ ...changes[0]!, fieldLabel: "Сохранённая явная подпись" }], { normLabels: labels })[0]!.fieldLabel).toBe("Сохранённая явная подпись");
  });
});
