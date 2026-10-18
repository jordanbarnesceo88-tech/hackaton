import { test, expect } from "@playwright/test";
import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { businessExampleInputs } from "../lib/projects/business-examples";
import { baseValuesFor } from "../lib/data/organizer/params";
import { CATALOG } from "../lib/data/organizer/catalog";
import { productForCalcFromSeed } from "../lib/catalog/product-for-calc";
import { parseCsv, parseRuNumber } from "../lib/files/csv";
import { simInputIdentity } from "../lib/sim/identity";
import { fnv1a32 } from "../lib/tz/version";
import type { ProjectResults, ScenarioOk } from "../lib/tz/types";

function financialValues(results: ProjectResults) {
  return results.results.map(result => {
    expect(result.status).toBe("ok");
    const r = result as ScenarioOk;
    return {
      key: r.key, items: r.items, capexRub: r.capexRub, capexLines: r.capexLines,
      opexYearRub: r.opexYearRub, opexLines: r.opexLines,
      processLabourYearRub: r.processLabourYearRub, effectYearRub: r.effectYearRub,
      paybackYears: r.paybackYears, roiTzPct: r.roiTzPct, roiNetPct: r.roiNetPct,
      npvRub: r.npvRub, discountedPaybackYears: r.discountedPaybackYears,
      tcoRub: r.tcoRub, tcoYears: r.tcoYears, cashflows: r.cashflows,
    };
  });
}

test("owned capacity check preserves nominal finances and freezes both observations in archive and exports", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(15_000);
  await page.setViewportSize({ width: 1366, height: 900 });
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const name = `e2e-capacity-${Date.now()}`;
  const scenarioName = "Покупка — Ronavi H1500";
  const jobIds: string[] = [];
  const errors: string[] = [];
  let projectId: string | undefined;
  page.on("pageerror", error => errors.push(error.message));

  try {
    await page.setExtraHTTPHeaders({ "x-forwarded-for": `e2e-capacity-${crypto.randomUUID()}` });
    await page.goto("/login");
    await page.locator("#email").fill("demo@demo.local");
    await page.locator("#password").fill(process.env.DEMO_USER_PASSWORD ?? "demo-user-2026");
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await expect(page).toHaveURL(/\/projects$/);

    const input = businessExampleInputs("steady-flow", baseValuesFor("warehouse"), CATALOG.map(productForCalcFromSeed));
    const create = await page.request.post("/api/v1/calculation-jobs", {
      data: { operation: "CREATE", name, facility: "warehouse", params: input.params, scenarios: input.scenarios },
      headers: { "Idempotency-Key": crypto.randomUUID() },
    });
    expect(create.status(), await create.text()).toBe(202);
    const createId = (await create.json()).job.id as string;
    jobIds.push(createId);
    await expect.poll(async () => (await (await page.request.get(`/api/v1/calculation-jobs/${createId}`)).json()).job.status, { timeout: 90_000 }).toBe("SUCCEEDED");
    projectId = (await (await page.request.get(`/api/v1/calculation-jobs/${createId}/result`)).json()).job.projectId;
    expect(projectId).toBeTruthy();
    const before = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { revision: true, params: true, results: true } });
    const initial = before.results as unknown as ProjectResults;
    const nominal = initial.scenarios.find(scenario => scenario.key === "purchase")!.spatialEvidence!;
    expect(nominal.assessment).toMatchObject({ status: "PARTIAL", terminal: true });
    expect(nominal.summary).toMatchObject({ fleet: 6, achievedPerH: 51.5, queueEnd: 1 });
    expect(nominal.input.layout.chargers).toBe(2);
    expect(nominal.input.demand.peakPerH).toBeCloseTo(51.81818181818181, 10);
    expect(nominal.capacityProof).toBeUndefined();

    await page.goto(`/projects/${projectId}?edit=1#report`);
    await page.getByRole("navigation", { name: "Шаги расчёта" }).getByRole("link", { name: /^5 / }).click();
    await page.locator("#economics").getByRole("tab", { name: scenarioName, exact: true }).click();
    await page.getByRole("navigation", { name: "Шаги расчёта" }).getByRole("link", { name: /^8 / }).click();
    await expect(page.getByRole("heading", { level: 2, name: /^Шаг 8 из/ })).toBeVisible();
    const capacity = page.getByRole("region", { name: "Контролируемая проверка мощности", exact: true });
    await expect(capacity).toHaveAttribute("data-capacity-status", "NOT_REQUESTED");
    const accepted = page.waitForResponse(response => response.url().endsWith("/api/v1/calculation-jobs") && response.request().method() === "POST");
    await capacity.getByRole("button", { name: "Проверить целевую мощность на сервере", exact: true }).click();
    const calculation = await accepted;
    expect(calculation.status(), await calculation.text()).toBe(202);
    const submitted = calculation.request().postDataJSON();
    expect(submitted.operation).toBe("CALCULATE");
    expect(submitted.params).toEqual(initial.paramsUsed);
    expect(submitted.scenarios.find((scenario: { key: string }) => scenario.key === "purchase").spatialEvidence.capacityRequested).toBe(true);
    const calculateId = (await calculation.json()).job.id as string;
    jobIds.push(calculateId);
    await expect(page.locator("[data-server-calculation]")).toHaveAttribute("data-server-calculation", "ready", { timeout: 90_000 });
    const calculated = (await (await page.request.get(`/api/v1/calculation-jobs/${calculateId}/result`)).json()).results as ProjectResults;
    const checked = calculated.scenarios.find(scenario => scenario.key === "purchase")!.spatialEvidence!;
    const proof = checked.capacityProof!;
    expect(checked.assessment).toEqual(nominal.assessment);
    expect(checked.summary).toEqual(nominal.summary);
    expect(checked.input).toEqual(nominal.input);
    expect(checked.sourceInputKey).toBe(nominal.sourceInputKey);
    expect(checked.executionInputKey).toBe(nominal.executionInputKey);
    expect(checked.capacityNominalReview).toMatchObject({ eligible: true, reasons: [], diagnostics: { unfinished: expect.any(Array) } });
    expect(proof).toMatchObject({
      schemaVersion: "capacity-proof-1", protocolId: "periodic-110-15-120-cohort-closed-1", terminal: true, status: "PASS",
      metrics: { deliveredCohort: 110, closedCohort: 109, deliveredCohortPerH: 55, closedCohortPerH: 54.5, measurementStartS: 900, measurementEndS: 8100 },
    });
    expect(proof.metrics.requiredPerH).toBe(nominal.input.demand.peakPerH);
    expect(proof.metrics.offeredPerH).toBeCloseTo(proof.metrics.requiredPerH * 1.1, 10);
    expect(proof.sourceInputKey).toBe(simInputIdentity(nominal.input));
    expect(proof.testInputKey).toBe(simInputIdentity(proof.input));
    expect(proof.executionInputKey).not.toBe("");
    expect(proof.simModelVersion).toBe(nominal.simModelVersion);
    expect(proof.input.demand).toEqual({ ...nominal.input.demand, warmupMin: 15, peakMin: 120, offered: { protocol: "periodic-capacity-1", perH: proof.metrics.offeredPerH } });
    const samePhysicalInput = structuredClone(proof.input);
    samePhysicalInput.demand = structuredClone(nominal.input.demand);
    expect(samePhysicalInput).toEqual(nominal.input);
    expect(calculated.paramsUsed).toEqual(initial.paramsUsed);
    expect(calculated.normsUsed).toEqual(initial.normsUsed);
    expect(calculated.productSnapshots).toEqual(initial.productSnapshots);
    expect(financialValues(calculated)).toEqual(financialValues(initial));
    for (const scenario of initial.scenarios) {
      const result = structuredClone(calculated.scenarios.find(item => item.key === scenario.key)!);
      const source = structuredClone(scenario);
      delete result.spatialEvidence;
      delete source.spatialEvidence;
      expect(result).toEqual(source);
    }
    expect(calculated.scenarios.find(scenario => scenario.key === "raas")!.spatialEvidence!.capacityProof).toBeUndefined();
    expect(await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { revision: true, params: true, results: true } })).toEqual(before);
    await expect(capacity).toHaveAttribute("data-capacity-status", "PASS");
    await expect(capacity).toContainText("Целевая мощность подтверждена контролируемым модельным тестом");
    await expect(capacity).toContainText("55,00 / 51,82");
    await expect(capacity).toContainText("54,50 / 51,82");

    const saveAccepted = page.waitForResponse(response => response.url().endsWith("/api/v1/calculation-jobs") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Сохранить проект", exact: true }).click();
    const save = await saveAccepted;
    expect(save.status(), await save.text()).toBe(202);
    expect(save.request().postDataJSON()).toMatchObject({ operation: "SAVE", projectId, expectedRevision: before.revision });
    jobIds.push((await save.json()).job.id);
    await expect(page.getByText(/^Проект сохранён/)).toBeVisible({ timeout: 90_000 });
    const persisted = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { revision: true, params: true, results: true } });
    expect(persisted.revision).toBe(before.revision + 1);
    expect(persisted.params).toEqual(before.params);
    const saved = persisted.results as unknown as ProjectResults;
    const savedEvidence = saved.scenarios.find(scenario => scenario.key === "purchase")!.spatialEvidence!;
    expect(savedEvidence).toEqual(checked);
    expect(financialValues(saved)).toEqual(financialValues(initial));

    await page.goto(`/projects/${projectId}#report`);
    await expect(page.locator("[data-project-archive=true]")).toBeVisible();
    await page.getByRole("navigation", { name: "Шаги расчёта" }).getByRole("link", { name: /^5 / }).click();
    await page.locator("#economics").getByRole("tab", { name: scenarioName, exact: true }).click();
    await page.getByRole("navigation", { name: "Шаги расчёта" }).getByRole("link", { name: /^8 / }).click();
    await expect(capacity).toHaveAttribute("data-capacity-status", "PASS");
    await expect(capacity).toContainText("54,50 / 51,82");
    await expect(capacity).toContainText("Сохранённый тест: критерии выполнены");
    await expect(capacity).toContainText("Номинальный прогон: PARTIAL.");
    await expect(capacity.getByRole("button")).toHaveCount(0);
    await page.waitForFunction(() => !document.documentElement.hasAttribute("data-step-dir"));
    await capacity.screenshot({ path: testInfo.outputPath("capacity-readonly-1366.png"), animations: "disabled" });
    await page.setViewportSize({ width: 390, height: 844 });
    await capacity.screenshot({ path: testInfo.outputPath("capacity-readonly-390.png"), animations: "disabled" });
    await page.setViewportSize({ width: 1366, height: 900 });
    const archive = await page.request.get(`/api/v1/projects/${projectId}`);
    expect(archive.status()).toBe(200);
    expect((await archive.json()).results).toEqual(saved);

    const expectedRows: [string, string | number][] = [
      ["Номинальный прогон — сохранённый статус", "PARTIAL"],
      ["Номинальный прогон — доставлено", 51.5],
      ["Допуск по номинальной работе", "Номинальные проверки безопасности, очереди и ожидания пройдены"],
      ["Номинальный прогон: наибольшее текущее ожидание начала работы", savedEvidence.capacityNominalReview!.diagnostics!.pendingWaitMaxS],
      ["Номинальный прогон: наибольшее непрерывное защитное ожидание", savedEvidence.capacityNominalReview!.diagnostics!.blockedWaitMaxS],
      ["Сохранённый статус теста", "PASS"],
      ["Протокол", proof.protocolId],
      ["Пространственная модель теста", proof.simModelVersion],
      ["Короткая метка исходного входа", `fnv1a32-${fnv1a32(proof.sourceInputKey)}`],
      ["Короткая метка тестового входа", `fnv1a32-${fnv1a32(proof.testInputKey)}`],
      ["Короткая метка исполнительного входа", `fnv1a32-${fnv1a32(proof.executionInputKey)}`],
      ["Требуемая мощность исходного сценария", proof.metrics.requiredPerH],
      ["Доставлено из поступлений окна", 110],
      ["Закрыто полных циклов поступлений окна", 109],
      ["Выпуск по доставкам когорты", 55],
      ["Выпуск по полным циклам когорты", 54.5],
      ["Парк / зарядки / seed теста", `6 / 2 / ${nominal.input.seed}`],
    ];
    const csv = await page.request.get(`/projects/${projectId}/export.csv`);
    expect(csv.status()).toBe(200);
    const csvRows = parseCsv(await csv.text());
    const xlsx = await page.request.get(`/projects/${projectId}/export.xlsx`);
    expect(xlsx.status()).toBe(200);
    const bytes = await xlsx.body(), buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const simulation = workbook.getWorksheet("Имитация");
    expect(simulation).toBeDefined();
    const xlsxRows: unknown[][] = [];
    simulation!.eachRow(row => xlsxRows.push([row.getCell(1).value, row.getCell(2).value, row.getCell(3).value, row.getCell(4).value]));
    for (const [label, value] of expectedRows) {
      const csvMatches = csvRows.filter(row => row[0] === scenarioName && row[1] === label);
      expect(csvMatches, label).toHaveLength(1);
      expect(typeof value === "number" ? parseRuNumber(csvMatches[0]![2] ?? "") : csvMatches[0]![2], label).toBe(value);
      const xlsxMatches = xlsxRows.filter(row => row[0] === scenarioName && row[1] === label);
      expect(xlsxMatches, label).toHaveLength(1);
      expect(xlsxMatches[0]![2], label).toBe(value);
    }

    await page.goto(`/projects/${projectId}/report?scenario=purchase`);
    const report = page.getByRole("region", { name: "Сохранённые проверки целевой мощности", exact: true });
    await expect(report).toBeVisible();
    for (const [label, value] of expectedRows) {
      const row = report.getByRole("row").filter({ has: page.getByRole("rowheader", { name: label, exact: true }) });
      await expect(row, label).toHaveCount(1);
      const text = typeof value === "number" ? new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value) : value;
      await expect(row.getByRole("cell").nth(1), label).toHaveText(text);
    }
    expect(await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { revision: true, params: true, results: true } })).toEqual(persisted);
    expect(errors).toEqual([]);
    await testInfo.attach("capacity-owned-archive", { body: JSON.stringify({ projectId, jobIds, revision: persisted.revision, nominal: savedEvidence.summary, nominalStatus: savedEvidence.assessment.status, review: savedEvidence.capacityNominalReview, capacityProof: proof, exportRows: expectedRows }), contentType: "application/json" });
  } finally {
    if (projectId) await db.project.deleteMany({ where: { id: projectId, name: { startsWith: "e2e-capacity-" } } });
    const jobs = await db.calculationJob.findMany({ where: { id: { in: jobIds }, status: { in: ["SUCCEEDED", "FAILED", "CANCELLED"] } }, select: { runId: true } });
    await db.calculationRun.deleteMany({ where: { id: { in: jobs.map(job => job.runId) } } });
    await db.$disconnect();
  }
});
