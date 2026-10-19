// External draft. Coordinator copies this exact file to e2e/ AFTER the production build.
import { test, expect, type Page, type Locator } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { businessExampleInputs } from "../lib/projects/business-examples";
import { baseValuesFor } from "../lib/data/organizer/params";
import { CATALOG } from "../lib/data/organizer/catalog";
import { productForCalcFromSeed } from "../lib/catalog/product-for-calc";
import { PILOT_WORKS } from "../lib/tz/pilot-budget";
import type { PilotPlanInput } from "../lib/tz/types";

async function step(page: Page, number: number) {
  await page.getByRole("navigation", { name: "Шаги расчёта" }).getByRole("link", { name: new RegExp(`^${number} `) }).click();
  await expect(page.getByRole("heading", { level: 2, name: new RegExp(`^Шаг ${number} из`) })).toBeVisible();
}
async function focus(page: Page, key: "purchase" | "raas") {
  await step(page, 5);
  await page.getByRole("tablist", { name: "Сценарий для экономики", exact: true }).getByRole("tab", { name: key === "purchase" ? /^Покупка/ : /^Услуга \(RaaS\)/ }).click();
  await step(page, 8);
  const pilot = page.locator(`[data-pilot-scenario="${key}"]`);
  await expect(pilot).toBeVisible();
  return pilot;
}
async function openEditor(pilot: Locator) {
  const summary = pilot.getByText("Настроить состав, смету и критерии пилота", { exact: true });
  const open = await summary.evaluate(element => element.parentElement?.hasAttribute("open"));
  if (!open) await summary.click();
  await expect(pilot.getByLabel("Длительность пилота, дней", { exact: true })).toBeVisible();
}
async function setDraft(pilot: Locator, duration: string, notes: string, amount: string) {
  await openEditor(pilot);
  await pilot.getByLabel("Длительность пилота, дней", { exact: true }).fill(duration);
  await pilot.getByLabel(/^Примечание к плану/).fill(notes);
  await pilot.getByLabel("Развёртывание и настройка, ₽", { exact: true }).fill(amount);
  await pilot.getByLabel(/^Источник — Развёртывание и настройка/).fill(`E2E assumption ${notes}`);
}
async function expectDraft(pilot: Locator, duration: string, notes: string, amount: string) {
  await openEditor(pilot);
  await expect(pilot.getByLabel("Длительность пилота, дней", { exact: true })).toHaveValue(duration);
  await expect(pilot.getByLabel(/^Примечание к плану/)).toHaveValue(notes);
  await expect(pilot.getByLabel("Развёртывание и настройка, ₽", { exact: true })).toHaveValue(amount);
  await expect(pilot.getByRole("button", { name: "Сбросить черновик к плану сценария", exact: true })).toBeVisible();
}
const guestResponse = (response: { url(): string; request(): { method(): string } }) => new URL(response.url()).pathname === "/api/v1/demo-calculation" && response.request().method() === "POST";

test("pilot draft · real guest recalculation and focus preserve unapplied duration notes and costs", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  const errors: string[] = [], requests: unknown[] = [], receipts: unknown[] = [];
  const marker = `stage7-draft-${crypto.randomUUID()}`;
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (new URL(request.url()).pathname === "/api/v1/demo-calculation" && request.method() === "POST") requests.push(request.postDataJSON()); });
  const firstResponse = page.waitForResponse(guestResponse, { timeout: 120_000 });
  await page.goto("/demo?example=steady-flow");
  const first = await firstResponse;
  expect(first.status(), await first.text()).toBe(200); receipts.push(await first.json());
  await expect(page.locator("[data-guest-calculation]")).toHaveAttribute("data-guest-calculation", "ready", { timeout: 120_000 });
  const purchase = await focus(page, "purchase");
  await setDraft(purchase, "17", `${marker}-purchase`, "12345");
  const raas = await focus(page, "raas");
  await setDraft(raas, "19", `${marker}-raas`, "23456");
  await expectDraft(await focus(page, "purchase"), "17", `${marker}-purchase`, "12345");
  await testInfo.attach("purchase-unapplied-before-recalc", { body: await purchase.screenshot(), contentType: "image/png" });
  await step(page, 2);
  const salary = page.locator("#p-forkliftSalaryRubMonth");
  await salary.fill("121111"); await salary.blur();
  const responsePromise = page.waitForResponse(guestResponse, { timeout: 120_000 });
  await page.getByRole("button", { name: "Пересчитать", exact: true }).click();
  const response = await responsePromise;
  expect(response.status(), await response.text()).toBe(200);
  const submitted = response.request().postDataJSON(), calculated = await response.json();
  receipts.push(calculated);
  expect(submitted.params.forkliftSalaryRubMonth).toBe(121111);
  expect(calculated.results.paramsUsed.forkliftSalaryRubMonth).toBe(121111);
  // No Apply occurred. Local estimates must not enter either actual request or published guest result.
  expect(JSON.stringify(submitted)).not.toContain(marker);
  expect(JSON.stringify(calculated)).not.toContain(marker);
  await expect(page.locator("[data-guest-calculation]")).toHaveAttribute("data-guest-calculation", "ready", { timeout: 120_000 });
  await expectDraft(await focus(page, "purchase"), "17", `${marker}-purchase`, "12345");
  await expectDraft(await focus(page, "raas"), "19", `${marker}-raas`, "23456");
  await expectDraft(await focus(page, "purchase"), "17", `${marker}-purchase`, "12345");
  await testInfo.attach("purchase-unapplied-after-real-recalc", { body: await purchase.screenshot(), contentType: "image/png" });
  expect(requests).toHaveLength(2);
  expect(errors).toEqual([]);
  await testInfo.attach("actual-guest-draft-receipts", { body: JSON.stringify({ marker, requests, receipts, errors, mockedResponses: false }), contentType: "application/json" });
});

test("pilot draft · owned archive isolates saved plan and explicit Apply SAVE still publishes", async ({ page }, testInfo) => {
  test.setTimeout(420_000);
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const marker = `stage7-pilot-${crypto.randomUUID()}`, name = `e2e-${marker}`, jobs: string[] = [], errors: string[] = [], receipts: unknown[] = [];
  let projectId: string | undefined, ownerId: string | undefined;
  page.on("pageerror", error => errors.push(error.message));
  const savedPlan: PilotPlanInput = {
    schemaVersion: "pilot-plan-1", fleet: 1, chargers: 1, durationDays: 10, dayBasis: "calendar", acquisition: "purchase",
    equipmentUnitRubOverride: null, contingencyPct: 10, targetThroughputPerH: null, maxP95WaitMin: 5, maxInterventionsPerShift: 2,
    costs: Object.fromEntries(Object.keys(PILOT_WORKS).map(key => [key, { valueRub: null, source: "E2E fixture: estimate not supplied" }])) as PilotPlanInput["costs"],
    readiness: [], notes: `${marker}-saved10`,
  };
  const resultOf = async (id: string) => {
    await expect.poll(async () => (await (await page.request.get(`/api/v1/calculation-jobs/${id}`)).json()).job.status, { timeout: 120_000 }).toBe("SUCCEEDED");
    const response = await page.request.get(`/api/v1/calculation-jobs/${id}/result`);
    expect(response.status()).toBe(200); const result = await response.json(); receipts.push(result); return result;
  };
  try {
    await page.goto("/login"); await page.locator("#email").fill("demo@demo.local");
    expect(process.env.DEMO_USER_PASSWORD, "Verified main fixture password must be supplied in memory by runner").toBeTruthy();
    await page.locator("#password").fill(process.env.DEMO_USER_PASSWORD!);
    await page.getByRole("button", { name: "Войти", exact: true }).click(); await expect(page).toHaveURL(/\/projects$/);
    const input = businessExampleInputs("steady-flow", baseValuesFor("warehouse"), CATALOG.map(productForCalcFromSeed));
    input.scenarios = input.scenarios.map(scenario => scenario.key === "purchase" ? { ...scenario, pilotPlan: savedPlan, terminalResidualRub: 0 } : scenario);
    const create = await page.request.post("/api/v1/calculation-jobs", { data: { operation: "CREATE", name, facility: "warehouse", params: input.params, scenarios: input.scenarios }, headers: { "Idempotency-Key": crypto.randomUUID() } });
    expect(create.status(), await create.text()).toBe(202); jobs.push((await create.json()).job.id);
    const created = await resultOf(jobs[0]!); projectId = created.job.projectId;
    expect(created.job.publicationState).toBe("PUBLISHED");
    const before = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { userId: true, name: true, revision: true, params: true, results: true } });
    ownerId = before.userId; expect(before.name).toBe(name);
    expect((before.results as unknown as { scenarios: { key: string; pilotPlan?: PilotPlanInput }[] }).scenarios.find(scenario => scenario.key === "purchase")?.pilotPlan).toEqual(savedPlan);
    const posts: unknown[] = [];
    page.on("request", request => { if (new URL(request.url()).pathname === "/api/v1/calculation-jobs" && request.method() === "POST") posts.push(request.postDataJSON()); });
    await page.goto(`/projects/${projectId}?edit=1`);
    const pilot = await focus(page, "purchase");
    await setDraft(pilot, "17", `${marker}-draft17`, "12345");
    await expectDraft(await focus(page, "purchase"), "17", `${marker}-draft17`, "12345");
    // This transition deliberately remounts on the effective editing/archive page key. Cross-navigation retention is not promised.
    await page.goto(`/projects/${projectId}`); await expect(page.locator("[data-project-archive=true]")).toBeVisible();
    await focus(page, "raas"); const archived = await focus(page, "purchase");
    await expect(archived).toContainText("10 календарных дней"); await expect(archived).toContainText(savedPlan.notes);
    await expect(archived).not.toContainText(`${marker}-draft17`);
    await expect(archived.getByLabel("Длительность пилота, дней", { exact: true })).toHaveCount(0);
    await expect(archived.getByRole("button", { name: "Сбросить черновик к плану сценария", exact: true })).toHaveCount(0);
    await expect(archived.getByRole("button", { name: "Применить план и пересчитать сценарий", exact: true })).toHaveCount(0);
    expect(posts).toEqual([]);
    const unchanged = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { userId: true, name: true, revision: true, params: true, results: true } });
    expect(unchanged).toEqual(before);
    const retainedCreate = await resultOf(jobs[0]!);
    expect(retainedCreate.results.scenarios.find((scenario: { key: string }) => scenario.key === "purchase").pilotPlan).toEqual(savedPlan);
    const csv = await page.request.get(`/projects/${projectId}/export.csv`); expect(csv.status()).toBe(200);
    const csvText = await csv.text(); expect(csvText).toContain(savedPlan.notes); expect(csvText).not.toContain(`${marker}-draft17`);
    await testInfo.attach("archive-saved10-no-draft", { body: await archived.screenshot(), contentType: "image/png" });
    await page.goto(`/projects/${projectId}?edit=1`); const editing = await focus(page, "purchase"); await openEditor(editing);
    await expect(editing.getByLabel("Длительность пилота, дней", { exact: true })).toHaveValue("10");
    await setDraft(editing, "17", `${marker}-applied17`, "12345");
    const accepted = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/calculation-jobs" && response.request().method() === "POST");
    await editing.getByRole("button", { name: "Применить план и пересчитать сценарий", exact: true }).click();
    const calculate = await accepted; expect(calculate.status(), await calculate.text()).toBe(202);
    expect(calculate.request().postDataJSON().operation).toBe("CALCULATE"); jobs.push((await calculate.json()).job.id);
    const calculated = await resultOf(jobs.at(-1)!);
    const appliedPlan = calculated.results.scenarios.find((scenario: { key: string }) => scenario.key === "purchase").pilotPlan;
    expect(appliedPlan).toMatchObject({ durationDays: 17, notes: `${marker}-applied17`, costs: { setup: { valueRub: 12345 } } });
    await expect(page.locator("[data-server-calculation]")).toHaveAttribute("data-server-calculation", "ready", { timeout: 120_000 });
    await expect(editing.getByRole("button", { name: "Сбросить черновик к плану сценария", exact: true })).toHaveCount(0);
    expect(await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { userId: true, name: true, revision: true, params: true, results: true } })).toEqual(before);
    const saving = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/calculation-jobs" && response.request().method() === "POST");
    await page.getByRole("button", { name: "Сохранить проект", exact: true }).click();
    const save = await saving; expect(save.status(), await save.text()).toBe(202); expect(save.request().postDataJSON().operation).toBe("SAVE"); jobs.push((await save.json()).job.id);
    await resultOf(jobs.at(-1)!); await expect(page.getByText(/^Проект сохранён/)).toBeVisible({ timeout: 120_000 });
    const stored = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { revision: true, results: true } }); expect(stored.revision).toBe(before.revision + 1);
    expect((stored.results as unknown as { scenarios: { key: string; pilotPlan?: PilotPlanInput }[] }).scenarios.find(scenario => scenario.key === "purchase")?.pilotPlan).toEqual(appliedPlan);
    await page.goto(`/projects/${projectId}`); const reopened = await focus(page, "purchase");
    await expect(reopened).toContainText("17 календарных дней"); await expect(reopened).toContainText(`${marker}-applied17`);
    expect(errors).toEqual([]);
    await testInfo.attach("actual-owned-pilot-publication", { body: JSON.stringify({ projectId, jobs, beforeRevision: before.revision, savedRevision: stored.revision, savedPlan, appliedPlan, receipts, errors, mockedResponses: false }), contentType: "application/json" });
  } finally {
    try {
      for (const id of jobs) {
        const response = await page.request.get(`/api/v1/calculation-jobs/${id}`); if (!response.ok()) continue;
        if (["QUEUED", "RUNNING"].includes((await response.json()).job.status)) {
          await page.request.post(`/api/v1/calculation-jobs/${id}/cancel`);
          await expect.poll(async () => (await (await page.request.get(`/api/v1/calculation-jobs/${id}`)).json()).job.status, { timeout: 15_000 }).not.toMatch(/^(QUEUED|RUNNING)$/);
        }
      }
      const terminal = await db.calculationJob.findMany({ where: { id: { in: jobs }, status: { in: ["SUCCEEDED", "FAILED", "CANCELLED"] } }, select: { runId: true } });
      if (projectId && ownerId) await db.project.deleteMany({ where: { id: projectId, userId: ownerId, name } });
      await db.calculationRun.deleteMany({ where: { id: { in: terminal.map(row => row.runId) } } });
    } finally { await db.$disconnect(); }
  }
});
