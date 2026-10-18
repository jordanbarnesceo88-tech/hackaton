import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { businessExampleInputs } from "../lib/projects/business-examples";
import { baseValuesFor } from "../lib/data/organizer/params";
import { CATALOG } from "../lib/data/organizer/catalog";
import { productForCalcFromSeed } from "../lib/catalog/product-for-calc";
import { PILOT_WORKS, PILOT_READINESS } from "../lib/tz/pilot-budget";
import { decodeText, parseCsv } from "../lib/files/csv";

async function step(page: Page, n: number) {
  await page.getByRole("navigation", { name: "Шаги расчёта" }).getByRole("link", { name: new RegExp(`^${n} `) }).click();
  await expect(page.getByRole("heading", { level: 2, name: new RegExp(`^Шаг ${n} из`) })).toBeVisible();
}

test("pilot inputs survive real CALCULATE, SAVE, reopening, report, XLSX and CSV", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(15_000);
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  let projectId: string | undefined;
  const jobIds: string[] = [];
  const notes = `e2e-pilot-${Date.now()}: остановить пилот при двух вмешательствах за смену`;
  const works = Object.entries(PILOT_WORKS).map(([key, label], index) => ({ key, label, valueRub: (index + 1) * 11000, source: `Оценка интегратора E2E ${key}, версия 1` }));
  const expectedPlan = {
    schemaVersion: "pilot-plan-1", fleet: 2, chargers: 1, durationDays: 7, dayBasis: "calendar", acquisition: "purchase",
    equipmentUnitRubOverride: 1234567, chargerBudgetRubOverride: 45678, chargerBudgetSource: "КП E2E зарядки 45678",
    contingencyPct: 12, targetThroughputPerH: 17, maxP95WaitMin: 3, maxInterventionsPerShift: 2,
    costs: Object.fromEntries(works.map(work => [work.key, { valueRub: work.valueRub, source: work.source }])),
    readiness: ["sitePlan", "baseline"], notes,
  };
  try {
    await page.setExtraHTTPHeaders({ "x-forwarded-for": `e2e-pilot-${crypto.randomUUID()}` });
    await page.goto("/login");
    await page.locator("#email").fill("demo@demo.local");
    await page.locator("#password").fill(process.env.DEMO_USER_PASSWORD ?? "demo-user-2026");
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await expect(page).toHaveURL(/\/projects$/);
    const input = businessExampleInputs("steady-flow", baseValuesFor("warehouse"), CATALOG.map(productForCalcFromSeed));
    const created = await page.request.post("/api/v1/calculation-jobs", {
      data: { operation: "CREATE", name: `e2e-pilot-${Date.now()}`, facility: "warehouse", params: input.params, scenarios: input.scenarios },
      headers: { "Idempotency-Key": crypto.randomUUID() },
    });
    expect(created.status(), await created.text()).toBe(202);
    const createId = (await created.json()).job.id as string;
    jobIds.push(createId);
    await expect.poll(async () => (await (await page.request.get(`/api/v1/calculation-jobs/${createId}`)).json()).job.status, { timeout: 90_000 }).toBe("SUCCEEDED");
    projectId = (await (await page.request.get(`/api/v1/calculation-jobs/${createId}/result`)).json()).job.projectId;
    const before = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { revision: true, params: true, results: true } });
    await page.goto(`/projects/${projectId}?edit=1#economics`);
    await step(page, 5);
    await page.locator("#economics").getByRole("tab", { name: "Покупка — Ronavi H1500", exact: true }).click();
    await step(page, 8);
    const pilot = page.locator('[data-pilot-scenario="purchase"]');
    await expect(pilot).toBeVisible();
    await pilot.getByText("Настроить состав, смету и критерии пилота", { exact: true }).click();
    for (const [label, value] of [
      ["Роботов в пилоте", "2"], ["Зарядок в пилоте", "1"], ["Длительность пилота, дней", "7"],
      ["Своя оценка цены за робота, ₽", "1234567"], ["Своя оценка бюджета зарядок пилота, ₽", "45678"],
      ["Резерв сметы, %", "12"], ["Цель потока участка пилота, операций/ч", "17"],
      ["Допуск p95 ожидания, мин", "3"], ["Допуск вмешательств за смену", "2"],
    ]) await pilot.getByLabel(label!, { exact: true }).fill(value!);
    await pilot.getByLabel(/^Считаем дни/).selectOption("calendar");
    await pilot.getByLabel("Источник своей оценки зарядок", { exact: true }).fill(expectedPlan.chargerBudgetSource);
    for (const work of works) {
      await pilot.getByLabel(`${work.label}, ₽`, { exact: true }).fill(String(work.valueRub));
      await pilot.getByLabel(new RegExp(`^Источник — ${work.label}`)).fill(work.source);
    }
    for (const label of Object.values(PILOT_READINESS)) await pilot.getByLabel(label, { exact: true }).uncheck();
    for (const key of ["sitePlan", "baseline"] as const) await pilot.getByLabel(PILOT_READINESS[key], { exact: true }).check();
    await pilot.getByLabel(/Остаточная стоимость собственных активов/).fill("0");
    await pilot.getByLabel(/^Примечание к плану/).fill(notes);
    const accepted = page.waitForResponse(response => response.url().endsWith("/api/v1/calculation-jobs") && response.request().method() === "POST");
    await pilot.getByRole("button", { name: "Применить план и пересчитать сценарий", exact: true }).click();
    const receipt = await accepted;
    expect(receipt.status(), await receipt.text()).toBe(202);
    const submitted = receipt.request().postDataJSON();
    expect(submitted.operation).toBe("CALCULATE");
    expect(submitted.scenarios.find((scenario: { key: string }) => scenario.key === "purchase").pilotPlan).toEqual(expectedPlan);
    const calculateId = (await receipt.json()).job.id as string;
    jobIds.push(calculateId);
    await expect(page.locator("[data-server-calculation]")).toHaveAttribute("data-server-calculation", "ready", { timeout: 90_000 });
    const calculated = await (await page.request.get(`/api/v1/calculation-jobs/${calculateId}/result`)).json();
    expect(calculated.results.scenarios.find((scenario: { key: string }) => scenario.key === "purchase").pilotPlan).toEqual(expectedPlan);
    expect(await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { revision: true, params: true, results: true } })).toEqual(before);
    await expect(pilot.locator("[data-pilot-budget]")).toHaveAttribute("data-pilot-budget", "complete");
    const saveAccepted = page.waitForResponse(response => response.url().endsWith("/api/v1/calculation-jobs") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Сохранить проект", exact: true }).click();
    const save = await saveAccepted;
    expect(save.status(), await save.text()).toBe(202);
    expect(save.request().postDataJSON().operation).toBe("SAVE");
    jobIds.push((await save.json()).job.id);
    await expect(page.getByText(/^Проект сохранён/)).toBeVisible({ timeout: 90_000 });
    const saved = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { revision: true, results: true } });
    expect(saved.revision).toBe(before.revision + 1);
    expect((saved.results as unknown as { scenarios: { key: string; pilotPlan?: unknown }[] }).scenarios.find(scenario => scenario.key === "purchase")?.pilotPlan).toEqual(expectedPlan);
    await page.goto(`/projects/${projectId}#economics`);
    await expect(page.locator("[data-project-archive=true]")).toBeVisible();
    await step(page, 5);
    await page.locator("#economics").getByRole("tab", { name: "Покупка — Ronavi H1500", exact: true }).click();
    await step(page, 8);
    await expect(pilot).toContainText(notes);
    for (const work of works) await expect(pilot).toContainText(work.source);
    await expect(pilot).toContainText("17 операций/ч");
    await expect(pilot).toContainText("p95 ожидания до назначения ≤ 3 мин.");
    await expect(pilot).toContainText("Ручных вмешательств за смену ≤ 2");
    const report = page.locator("#report");
    const [xlsx] = await Promise.all([page.waitForEvent("download"), report.getByRole("link", { name: "Excel", exact: true }).click()]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile((await xlsx.path())!);
    const sheet = wb.getWorksheet("Пилоты и бюджет");
    expect(sheet).toBeDefined();
    const workbookRows: unknown[][] = [];
    sheet!.eachRow(row => workbookRows.push([row.getCell(1).value, row.getCell(2).value, row.getCell(3).value, row.getCell(4).value, row.getCell(5).value]));
    for (const work of works) expect(workbookRows.find(row => row[1] === work.label)).toEqual(["Покупка — Ronavi H1500", work.label, work.valueRub, expect.any(String), expect.stringContaining(work.source)]);
    expect(workbookRows.find(row => row[1] === "Покупка оборудования пилота")?.[2]).toBe(2 * 1234567);
    expect(workbookRows.find(row => row[1] === "Зарядные станции пилота")).toEqual(["Покупка — Ronavi H1500", "Зарядные станции пилота", 45678, expect.any(String), expect.stringContaining(expectedPlan.chargerBudgetSource)]);
    const subtotal = 2 * 1234567 + 45678 + works.reduce((sum, work) => sum + work.valueRub, 0);
    expect(workbookRows.find(row => row[1] === "Известная часть сметы пилота")?.[2]).toBe(subtotal);
    expect(workbookRows.find(row => row[1] === "Полный бюджет пилота")?.[2]).toBeCloseTo(subtotal * 1.12, 2);
    expect(JSON.stringify(workbookRows)).toContain(notes);
    expect(JSON.stringify(workbookRows)).toContain("p95 ожидания до назначения ≤ 3 мин.");
    const [csv] = await Promise.all([page.waitForEvent("download"), report.getByRole("link", { name: "CSV", exact: true }).click()]);
    const csvRows = parseCsv(decodeText(await readFile((await csv.path())!)));
    for (const work of works) {
      const row = csvRows.find(row => row[0] === "Покупка — Ronavi H1500" && row[1] === work.label);
      expect(row).toBeDefined();
      expect(Number(row![2])).toBe(work.valueRub);
      expect(row![4]).toContain(work.source);
    }
    expect(Number(csvRows.find(row => row[0] === "Покупка — Ronavi H1500" && row[1] === "Покупка оборудования пилота")?.[2])).toBe(2 * 1234567);
    expect(csvRows.find(row => row[0] === "Покупка — Ronavi H1500" && row[1] === "Зарядные станции пилота")?.[4]).toContain(expectedPlan.chargerBudgetSource);
    expect(JSON.stringify(csvRows)).toContain(notes);
    expect(JSON.stringify(csvRows)).toContain("Ручных вмешательств за смену ≤ 2");
    await report.getByRole("link", { name: "Отчёт (PDF)", exact: true }).click();
    await expect(page).toHaveURL(url => url.pathname === `/projects/${projectId}/report` && url.searchParams.get("scenario") === "purchase");
    const printedPilot = page.locator("#pilot");
    for (const work of works) await expect(printedPilot).toContainText(work.source);
    await expect(printedPilot).toContainText(notes);
    await expect(printedPilot).toContainText("17 операций/ч");
    await expect(printedPilot).toContainText("p95 ожидания до назначения ≤ 3 мин.");
    await testInfo.attach("pilot-server-persistence", { body: JSON.stringify({ projectId, jobIds, revision: saved.revision, expectedPlan, workbookRows }), contentType: "application/json" });
  } finally {
    if (projectId) await db.project.deleteMany({ where: { id: projectId, name: { startsWith: "e2e-pilot-" } } });
    const jobs = await db.calculationJob.findMany({ where: { id: { in: jobIds }, status: { in: ["SUCCEEDED", "FAILED", "CANCELLED"] } }, select: { runId: true } });
    await db.calculationRun.deleteMany({ where: { id: { in: jobs.map(job => job.runId) } } });
    await db.$disconnect();
  }
});
