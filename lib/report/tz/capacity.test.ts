import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { CapacityCheck } from "../../../components/project/capacity-check";
import { capacityNotEvaluated } from "../../sim/capacity-protocol";
import { capacityDisplayRows } from "../../sim/capacity-presentation";
import { warehouseBaseInput } from "../../sim/fixtures";
import { simInputIdentity } from "../../sim/identity";
import { SPATIAL_MODEL_VERSION } from "../../sim/spatial-version";
import type { SpatialEvidence } from "../../tz/types";
import { capacityReportRows } from "./capacity";
import { projectCsv } from "./csv";
import { fixtureDefs, fixtureResults } from "./test-fixtures";
import { buildProjectXlsx } from "./xlsx";

function receipt() {
  const input = warehouseBaseInput(6);
  input.transportWorkflow = "closed-pod-1";
  input.demand.peakPerH = 10;
  const proof = capacityNotEvaluated(input, "Тестовый сохранённый результат");
  Object.assign(proof, { terminal: true, status: "PASS", executionInputKey: "saved-execution-identity" });
  Object.assign(proof.metrics, { arrivedPerH: 11, deliveredCohort: 21, closedCohort: 20, deliveredCohortPerH: 10.5, closedCohortPerH: 10 });
  const evidence: SpatialEvidence = {
    input, sourceInputKey: simInputIdentity(input), executionInputKey: "saved-nominal-execution", simModelVersion: SPATIAL_MODEL_VERSION,
    assessment: { terminal: true, status: "PARTIAL", headline: "Номинальный выпуск ниже цели" },
    summary: { fleet: 6, requiredPerH: 10, achievedPerH: 9, queueEnd: 1, waitP95Min: 1 }, capacityProof: proof,
    capacityNominalReview: { eligible: true, reasons: [], diagnostics: { pendingWaitMaxS: 0, blockedWaitMaxS: 0, unfinished: [] } },
  };
  return { input, proof, evidence };
}

describe("separate capacity observation in UI and saved exports", () => {
  it("shows a current controlled PASS without changing the nominal PARTIAL", () => {
    const { input, evidence } = receipt(), before = structuredClone(evidence);
    const html = renderToStaticMarkup(createElement(CapacityCheck, { evidence, expectedInput: input, fresh: true }));
    expect(html).toContain("Цель достигнута в условиях теста");
    expect(html).toContain("Номинальный прогон и его статус сохраняются отдельно");
    expect(html).toContain("проектный запас теста");
    expect(html).toContain("выполнен частично");
    expect(html).toContain("Полные клиентские циклы");
    expect(html).toContain("Для приёмки учитывается подача носителя, для отгрузки — возврат; внутренние перемещения закрываются доставкой.");
    expect(html).toContain("Код номинального результата: PARTIAL");
    expect(evidence).toEqual(before);
    const changed = structuredClone(input); changed.robots.count++;
    const stale = renderToStaticMarkup(createElement(CapacityCheck, { evidence, expectedInput: changed, fresh: false }));
    expect(stale).toContain("Сохранённый тест не подтверждает текущие условия");
    expect(stale).not.toContain("Цель достигнута в условиях теста");
  });

  it("never presents unobserved counters as measured zero on timeout", () => {
    const { input, evidence } = receipt();
    evidence.capacityProof = capacityNotEvaluated(input, "Исчерпан общий бюджет");
    const html = renderToStaticMarkup(createElement(CapacityCheck, { evidence, expectedInput: input, fresh: true }));
    expect(html).toContain("Контролируемая проверка мощности не выполнена");
    expect(html).toContain("Исчерпан общий бюджет");
    expect(capacityDisplayRows(evidence.capacityProof).find(row => row.label === "Закрыто полных циклов поступлений окна")?.value).toBe("Не оценено");
  });

  it("keeps a passing stress test unqualified when the nominal review is absent or unhealthy", () => {
    const { input, evidence } = receipt();
    for (const review of [undefined, { eligible: false, reasons: ["Требуется разбор очереди"], diagnostics: { pendingWaitMaxS: 900, blockedWaitMaxS: 0, unfinished: [] } }]) {
      evidence.capacityNominalReview = review;
      const html = renderToStaticMarkup(createElement(CapacityCheck, { evidence, expectedInput: input, fresh: true }));
      expect(html).toContain("Тест достиг целевой мощности; номинальная работа требует разбора");
      expect(html).not.toContain("Цель достигнута в условиях теста");
      expect(evidence.assessment.status).toBe("PARTIAL");
    }
  });

  it("shows both archived observations without requalifying them under current rules", () => {
    const { evidence } = receipt();
    const before = structuredClone(evidence);
    const html = renderToStaticMarkup(createElement(CapacityCheck, { evidence, fresh: false, archived: true }));
    expect(html).toContain("Сохранённый тест: цель достигнута в условиях теста");
    expect(html).toContain("PARTIAL"); expect(html).toContain("9,00 из 10,00");
    expect(html).not.toContain("Цель достигнута в условиях теста");
    expect(html).not.toContain("<button");
    expect(evidence).toEqual(before);
  });

  it("distinguishes saved inputs with the same fleet and seed without printing full canonical keys", () => {
    const { proof } = receipt(), changed = structuredClone(proof);
    changed.input.layout.activeAreaM2++;
    changed.testInputKey = simInputIdentity(changed.input);
    const label = "Короткая метка тестового входа";
    expect(capacityDisplayRows(proof).find(row => row.label === label)?.value)
      .not.toBe(capacityDisplayRows(changed).find(row => row.label === label)?.value);
    expect(capacityDisplayRows(proof).find(row => row.label === "Привязка наблюдения")?.value).toContain("не короткие метки");
  });

  it("exports both frozen results and does not backfill a legacy archive", async () => {
    const results = fixtureResults(), { evidence } = receipt();
    const spec = results.scenarios.find(scenario => scenario.kind === "purchase")!;
    expect(capacityReportRows(results)).toEqual([]);
    spec.spatialEvidence = evidence;
    const before = structuredClone(results), rows = capacityReportRows(results);
    expect(rows.find(row => row.label === "Номинальный прогон — сохранённый статус")?.value).toBe("PARTIAL");
    expect(rows.find(row => row.label === "Сохранённый статус теста")?.value).toBe("PASS");
    const csv = projectCsv(results, { projectName: "Отдельный тест" });
    expect(csv).toContain("Выпуск по полным циклам когорты");
    expect(csv).toContain("periodic-110-15-120-cohort-closed-1");
    const bytes = await buildProjectXlsx({ results, projectName: "Отдельный тест", defs: fixtureDefs() });
    const workbook = new ExcelJS.Workbook();
    const buffer = new ArrayBuffer(bytes.byteLength); new Uint8Array(buffer).set(bytes);
    await workbook.xlsx.load(buffer);
    const values: unknown[] = [];
    workbook.getWorksheet("Имитация")!.eachRow(row => row.eachCell(cell => values.push(cell.value)));
    expect(values).toContain("PARTIAL"); expect(values).toContain("PASS");
    expect(values).toContain("Выпуск по полным циклам когорты");
    expect(results).toEqual(before);
    delete spec.spatialEvidence.capacityProof;
    expect(capacityReportRows(results)).toEqual([]);
  });
});
