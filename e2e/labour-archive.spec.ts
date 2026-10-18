import { test, expect } from "@playwright/test";
import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { businessExampleInputs } from "../lib/projects/business-examples";
import { baseValuesFor } from "../lib/data/organizer/params";
import { CATALOG } from "../lib/data/organizer/catalog";
import { productForCalcFromSeed } from "../lib/catalog/product-for-calc";
import { parseCsv } from "../lib/files/csv";
import type { ProjectResults, ScenarioOk } from "../lib/tz/types";

test("zero labour share survives actual UI calculation, SAVE, archive and OEM exports", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(15_000);
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const name = `e2e-labour-archive-${Date.now()}`;
  const reason = "E2E: персонал сохраняется, роботам не передаётся труд процесса";
  const label = "Доля труда до исключения нестандартных грузов";
  const modelUrl = "https://ronavi-robotics.ru/catalogue/h1500";
  const sourceDate = "2026-10-18";
  const jobIds: string[] = [];
  const errors: string[] = [];
  let projectId: string | undefined;
  page.on("pageerror", error => errors.push(error.message));

  try {
    await page.setExtraHTTPHeaders({ "x-forwarded-for": `e2e-labour-${crypto.randomUUID()}` });
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
    const before = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { revision: true, results: true } });
    const initial = before.results as unknown as ProjectResults;
    const initialPurchase = initial.results.find(result => result.key === "purchase") as ScenarioOk;
    expect(initialPurchase.status).toBe("ok");
    expect(initialPurchase.items[0]!.releasedFte).toBeGreaterThan(0);

    await page.goto(`/projects/${projectId}?edit=1#economics`);
    await page.getByRole("navigation", { name: "Шаги расчёта" }).getByRole("link", { name: /^5 / }).click();
    await expect(page.getByRole("heading", { level: 2, name: /^Шаг 5 из/ })).toBeVisible();
    const economics = page.locator("#economics");
    await economics.getByRole("tab", { name: "Покупка — Ronavi H1500", exact: true }).click();
    const share = economics.getByLabel(label, { exact: true });
    await expect(share).toBeEditable();
    await share.fill("0");
    await economics.getByLabel(`Причина изменения (необязательно): ${label}`, { exact: true }).fill(reason);
    await share.press("Enter");
    await expect(share).toHaveAttribute("placeholder", "0");
    await expect(economics.getByRole("alert")).toHaveCount(0);

    const calculateAccepted = page.waitForResponse(response => response.url().endsWith("/api/v1/calculation-jobs") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Пересчитать", exact: true }).click();
    const calculation = await calculateAccepted;
    expect(calculation.status(), await calculation.text()).toBe(202);
    const submitted = calculation.request().postDataJSON();
    expect(submitted.operation).toBe("CALCULATE");
    expect(submitted.scenarios.find((scenario: { key: string }) => scenario.key === "purchase").normOverrides.laborShareAutomatable).toBe(0);
    const calculateId = (await calculation.json()).job.id as string;
    jobIds.push(calculateId);
    await expect(page.locator("[data-server-calculation]")).toHaveAttribute("data-server-calculation", "ready", { timeout: 90_000 });
    const calculated = await (await page.request.get(`/api/v1/calculation-jobs/${calculateId}/result`)).json() as { results: ProjectResults };
    const calculatedPurchase = calculated.results.results.find(result => result.key === "purchase") as ScenarioOk;
    expect(calculatedPurchase.status).toBe("ok");
    expect(calculatedPurchase.items[0]!.releasedFte).toBe(0);
    expect(calculatedPurchase.items[0]!.remainingLabourRub).toBe(calculatedPurchase.items[0]!.baselineLabourRub);
    // CALCULATE must leave the previously published project untouched.
    expect(await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { revision: true, results: true } })).toEqual(before);

    await page.getByRole("navigation", { name: "Шаги расчёта" }).getByRole("link", { name: /^8 / }).click();
    await expect(page.getByRole("heading", { level: 2, name: /^Шаг 8 из/ })).toBeVisible();
    const saveAccepted = page.waitForResponse(response => response.url().endsWith("/api/v1/calculation-jobs") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Сохранить проект", exact: true }).click();
    const save = await saveAccepted;
    expect(save.status(), await save.text()).toBe(202);
    expect(save.request().postDataJSON().operation).toBe("SAVE");
    jobIds.push((await save.json()).job.id);
    await expect(page.getByText(/^Проект сохранён/)).toBeVisible({ timeout: 90_000 });
    const persisted = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { revision: true, results: true } });
    expect(persisted.revision).toBe(before.revision + 1);
    const saved = persisted.results as unknown as ProjectResults;
    expect(saved.scenarios.find(scenario => scenario.key === "purchase")!.normOverrides!.laborShareAutomatable).toBe(0);
    const purchase = saved.results.find(result => result.key === "purchase") as ScenarioOk;
    expect(purchase.status).toBe("ok");
    expect(purchase.items).toHaveLength(1);
    expect(purchase.items[0]!.releasedFte).toBe(0);
    expect(purchase.items[0]!.remainingLabourRub).toBe(purchase.items[0]!.baselineLabourRub);
    expect(saved.methodologySnapshot!.normDefinitions!.find(def => def.key === "laborShareAutomatable")).toMatchObject({ min: 0, max: 1, label, origin: "estimate" });
    const product = saved.productSnapshots["ronavi-h1500"]!;
    expect(product.name).toContain("Ronavi H1500");
    const resource = product.implementation!.resources!.find(item => item.id === "ronavi-h1500-spec")!;
    expect(resource).toMatchObject({ kind: "specification", url: modelUrl, checkedAt: sourceDate, models: ["Ronavi H1500"] });
    const changes = await db.changeLog.findMany({ where: { projectId, field: "norm:laborShareAutomatable" } });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ newValue: 0, reason });

    await page.goto(`/projects/${projectId}#economics`);
    await expect(page.locator("[data-project-archive=true]")).toBeVisible();
    await page.getByRole("navigation", { name: "Шаги расчёта" }).getByRole("link", { name: /^5 / }).click();
    await economics.getByRole("tab", { name: "Покупка — Ronavi H1500", exact: true }).click();
    const norms = economics.getByRole("region", { name: "Нормативы и допущения", exact: true });
    const savedOverride = norms.locator("span").filter({ hasText: new RegExp(`^${label}$`) }).locator("..");
    await expect(savedOverride).toHaveCount(1);
    await expect(savedOverride).toContainText("задано вами");
    await expect(savedOverride).toContainText("0 %");
    await expect(norms.getByRole("textbox")).toHaveCount(0);
    const archivedJson = await page.request.get(`/api/v1/projects/${projectId}`);
    expect(archivedJson.status()).toBe(200);
    const reopened = await archivedJson.json() as { revision: number; results: ProjectResults };
    expect(reopened.revision).toBe(persisted.revision);
    expect(reopened.results).toEqual(saved);

    const csv = await page.request.get(`/projects/${projectId}/export.csv`);
    expect(csv.status()).toBe(200);
    const csvRows = parseCsv(await csv.text());
    const sourceRows = csvRows.filter(row => row[0] === product.name && row[1] === "Спецификация производителя");
    expect(sourceRows).toHaveLength(1);
    expect(sourceRows[0]![3]).toContain(modelUrl);
    expect(sourceRows[0]![3]).toContain(sourceDate);

    const xlsx = await page.request.get(`/projects/${projectId}/export.xlsx`);
    expect(xlsx.status()).toBe(200);
    const bytes = await xlsx.body(), buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const implementation = workbook.getWorksheet("Внедрение");
    expect(implementation).toBeDefined();
    const materialRows: unknown[][] = [];
    implementation!.eachRow(row => {
      if (row.getCell(1).value === product.name && row.getCell(2).value === "Спецификация производителя") materialRows.push([row.getCell(1).value, row.getCell(2).value, row.getCell(3).value, row.getCell(4).value]);
    });
    expect(materialRows).toHaveLength(1);
    expect(materialRows[0]![3]).toEqual(expect.stringContaining(modelUrl));
    expect(materialRows[0]![3]).toEqual(expect.stringContaining(sourceDate));

    await page.goto(`/projects/${projectId}/report?scenario=purchase`);
    const overrideLine = page.locator("#norms").getByRole("listitem").filter({ hasText: `Покупка — Ronavi H1500: ${label} =` });
    await expect(overrideLine).toHaveCount(1);
    await expect(overrideLine).toContainText(`${label} = 0 (0 %) доля`);
    await expect(page.locator("#changes")).toContainText(reason);
    const reportResources = page.locator("#pilot").getByRole("region", { name: "Материалы производителей", exact: true });
    await expect(reportResources.getByRole("link", { name: resource.title, exact: false })).toHaveAttribute("href", modelUrl);
    await expect(reportResources).toContainText(sourceDate);
    await expect(reportResources).toContainText("Спецификация производителя");
    expect(errors).toEqual([]);
    await testInfo.attach("labour-archive-persistence", {
      body: JSON.stringify({ projectId, jobIds, revision: persisted.revision, labourShare: 0, releasedFte: purchase.items[0]!.releasedFte, normDefinition: saved.methodologySnapshot!.normDefinitions!.find(def => def.key === "laborShareAutomatable"), resource, csvSourceRow: sourceRows[0], xlsxSourceRow: materialRows[0] }),
      contentType: "application/json",
    });
  } finally {
    if (projectId) await db.project.deleteMany({ where: { id: projectId, name: { startsWith: "e2e-labour-archive-" } } });
    const jobs = await db.calculationJob.findMany({ where: { id: { in: jobIds }, status: { in: ["SUCCEEDED", "FAILED", "CANCELLED"] } }, select: { runId: true } });
    await db.calculationRun.deleteMany({ where: { id: { in: jobs.map(job => job.runId) } } });
    await db.$disconnect();
  }
});

test("a recorded hidden simulation-window override applies in minutes and resets to the frozen base", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(15_000);
  await page.setViewportSize({ width: 1366, height: 900 });
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const name = `e2e-hidden-norm-${Date.now()}`;
  const label = "Длительность пикового окна имитации";
  const applyReason = "E2E: проверить окно 180 минут вместо сохранённых 240";
  const resetReason = "E2E: вернуть исходное окно проекта 120 минут";
  const jobIds: string[] = [];
  const errors: string[] = [];
  let projectId: string | undefined;
  page.on("pageerror", error => errors.push(error.message));

  try {
    await page.setExtraHTTPHeaders({ "x-forwarded-for": `e2e-hidden-norm-${crypto.randomUUID()}` });
    await page.goto("/login");
    await page.locator("#email").fill("demo@demo.local");
    await page.locator("#password").fill(process.env.DEMO_USER_PASSWORD ?? "demo-user-2026");
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await expect(page).toHaveURL(/\/projects$/);
    const input = businessExampleInputs("steady-flow", baseValuesFor("warehouse"), CATALOG.map(productForCalcFromSeed));
    input.scenarios.find(scenario => scenario.key === "purchase")!.normOverrides = { simPeakMin: 240 };
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
    const before = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { revision: true, results: true } });
    const initial = before.results as unknown as ProjectResults;
    expect(initial.normsUsed.simPeakMin).toBe(120);
    expect(initial.runtime!.simInputs.purchase!.calculated!.demand.peakMin).toBe(240);

    await page.goto(`/projects/${projectId}?edit=1#economics`);
    const steps = page.getByRole("navigation", { name: "Шаги расчёта" });
    await steps.getByRole("link", { name: /^5 / }).click();
    const economics = page.locator("#economics");
    await economics.getByRole("tab", { name: "Покупка — Ronavi H1500", exact: true }).click();
    const windowInput = economics.getByLabel(label, { exact: true });
    await expect(windowInput).toBeEditable();
    await expect(windowInput).toHaveAttribute("placeholder", "240");
    const override = windowInput.locator("..").locator("..");
    await expect(override).toContainText("240 мин");
    await expect(override).not.toContainText("24000");
    await override.screenshot({ path: testInfo.outputPath("hidden-window-initial-240.png") });
    await windowInput.fill("180");
    await override.getByLabel(`Причина изменения (необязательно): ${label}`, { exact: true }).fill(applyReason);
    const applyAccepted = page.waitForResponse(response => response.url().endsWith("/api/v1/calculation-jobs") && response.request().method() === "POST");
    await override.getByRole("button", { name: "Применить", exact: true }).click();
    const applied = await applyAccepted;
    expect(applied.status(), await applied.text()).toBe(202);
    expect(applied.request().postDataJSON().operation).toBe("CALCULATE");
    expect(applied.request().postDataJSON().scenarios.find((scenario: { key: string }) => scenario.key === "purchase").normOverrides.simPeakMin).toBe(180);
    const applyId = (await applied.json()).job.id as string;
    jobIds.push(applyId);
    await expect(page.locator("[data-server-calculation]")).toHaveAttribute("data-server-calculation", "ready", { timeout: 90_000 });
    const appliedResults = (await (await page.request.get(`/api/v1/calculation-jobs/${applyId}/result`)).json()).results as ProjectResults;
    expect(appliedResults.runtime!.simInputs.purchase!.calculated!.demand.peakMin).toBe(180);
    expect(appliedResults.scenarios.find(scenario => scenario.key === "purchase")!.normOverrides!.simPeakMin).toBe(180);
    await expect(windowInput).toHaveAttribute("placeholder", "180");
    await override.screenshot({ path: testInfo.outputPath("hidden-window-applied-180.png") });
    await steps.getByRole("link", { name: /^8 / }).click();
    const journal = page.getByRole("region", { name: "Журнал корректировок", exact: true });
    const appliedLine = journal.getByRole("row").filter({ hasText: applyReason });
    await expect(appliedLine).toHaveCount(1);
    await expect(appliedLine).toContainText(label);
    await expect(appliedLine.getByRole("cell").nth(6)).toHaveText("180");
    expect(await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { revision: true, results: true } })).toEqual(before);

    await steps.getByRole("link", { name: /^5 / }).click();
    await override.getByLabel(`Причина изменения (необязательно): ${label}`, { exact: true }).fill(resetReason);
    const resetAccepted = page.waitForResponse(response => response.url().endsWith("/api/v1/calculation-jobs") && response.request().method() === "POST");
    await override.getByRole("button", { name: "вернуть расчётное", exact: true }).click();
    const reset = await resetAccepted;
    expect(reset.status(), await reset.text()).toBe(202);
    expect(reset.request().postDataJSON().operation).toBe("CALCULATE");
    expect(reset.request().postDataJSON().scenarios.find((scenario: { key: string }) => scenario.key === "purchase").normOverrides?.simPeakMin).toBeUndefined();
    const resetId = (await reset.json()).job.id as string;
    jobIds.push(resetId);
    await expect(page.locator("[data-server-calculation]")).toHaveAttribute("data-server-calculation", "ready", { timeout: 90_000 });
    const resetResults = (await (await page.request.get(`/api/v1/calculation-jobs/${resetId}/result`)).json()).results as ProjectResults;
    expect(resetResults.runtime!.simInputs.purchase!.calculated!.demand.peakMin).toBe(120);
    await expect(windowInput).toHaveCount(0);
    const editableNorms = economics.getByRole("region", { name: "Нормативы и допущения", exact: true });
    await editableNorms.getByText(/^Все нормативы и допущения/).click();
    const resetRow = editableNorms.getByRole("row").filter({ has: page.getByRole("rowheader", { name: label, exact: true }) });
    await expect(resetRow.getByRole("cell").nth(0)).toHaveText("120");
    await resetRow.screenshot({ path: testInfo.outputPath("hidden-window-reset-120.png") });
    await steps.getByRole("link", { name: /^8 / }).click();
    await expect(journal.getByRole("row").filter({ hasText: resetReason })).toHaveCount(1);
    const saveAccepted = page.waitForResponse(response => response.url().endsWith("/api/v1/calculation-jobs") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Сохранить проект", exact: true }).click();
    const save = await saveAccepted;
    expect(save.status(), await save.text()).toBe(202);
    expect(save.request().postDataJSON()).toMatchObject({ operation: "SAVE", expectedRevision: before.revision });
    jobIds.push((await save.json()).job.id);
    await expect(page.getByText(/^Проект сохранён/)).toBeVisible({ timeout: 90_000 });
    const persisted = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { revision: true, results: true } });
    expect(persisted.revision).toBe(before.revision + 1);
    const saved = persisted.results as unknown as ProjectResults;
    expect(saved.scenarios.find(scenario => scenario.key === "purchase")!.normOverrides?.simPeakMin).toBeUndefined();
    expect(saved.runtime!.simInputs.purchase!.calculated!.demand.peakMin).toBe(120);
    const metadata = saved.methodologySnapshot!.normDefinitions!.find(def => def.key === "simPeakMin")!;
    expect(metadata).toMatchObject({ label, unit: "мин", min: 30, max: 480, origin: "estimate" });
    // The persisted audit records the published 240 → base transition, not unsaved intermediate values.
    const changes = await db.changeLog.findMany({ where: { projectId, field: "norm:simPeakMin" } });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ oldValue: 240, newValue: null, autoValue: 120, unit: "мин", reason: resetReason });

    await page.goto(`/projects/${projectId}#economics`);
    await expect(page.locator("[data-project-archive=true]")).toBeVisible();
    await steps.getByRole("link", { name: /^5 / }).click();
    await economics.getByRole("tab", { name: "Покупка — Ronavi H1500", exact: true }).click();
    const norms = economics.getByRole("region", { name: "Нормативы и допущения", exact: true });
    await expect(norms.getByRole("textbox")).toHaveCount(0);
    await norms.getByText(/^Все нормативы и допущения/).click();
    const frozenRow = norms.getByRole("row").filter({ has: page.getByRole("rowheader", { name: metadata.label, exact: true }) });
    await expect(frozenRow).toHaveCount(1);
    await expect(frozenRow.getByRole("cell").nth(0)).toHaveText("120");
    await expect(frozenRow.getByRole("cell").nth(1)).toHaveText("мин");
    await expect(frozenRow).toContainText(metadata.basis!);
    const archive = await page.request.get(`/api/v1/projects/${projectId}`);
    expect(archive.status()).toBe(200);
    expect((await archive.json()).results).toEqual(saved);
    expect(errors).toEqual([]);
    await testInfo.attach("hidden-norm-apply-reset", { body: JSON.stringify({ projectId, jobIds, revision: persisted.revision, initialMinutes: 240, appliedMinutes: 180, resetMinutes: 120, metadata, changes }), contentType: "application/json" });
  } finally {
    if (projectId) await db.project.deleteMany({ where: { id: projectId, name: { startsWith: "e2e-hidden-norm-" } } });
    const jobs = await db.calculationJob.findMany({ where: { id: { in: jobIds }, status: { in: ["SUCCEEDED", "FAILED", "CANCELLED"] } }, select: { runId: true } });
    await db.calculationRun.deleteMany({ where: { id: { in: jobs.map(job => job.runId) } } });
    await db.$disconnect();
  }
});
