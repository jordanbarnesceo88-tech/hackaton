import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { SPATIAL_MODEL_VERSION } from "../lib/sim/spatial-bridge";
import { businessExampleInputs } from "../lib/projects/business-examples";
import { baseValuesFor } from "../lib/data/organizer/params";
import { CATALOG } from "../lib/data/organizer/catalog";
import { productForCalcFromSeed } from "../lib/catalog/product-for-calc";
import type { PilotPlanInput } from "../lib/tz/types";

async function step(page: Page, n: number) {
  await page.getByRole("navigation", { name: "Шаги расчёта" }).getByRole("link", { name: new RegExp(`^${n} `) }).click();
}
async function ready(page: Page) {
  await expect(page.locator("[data-server-calculation]")).toHaveAttribute("data-server-calculation", "ready", { timeout: 90_000 });
}
async function cleanupOwnedTestJobs(page: Page, db: PrismaClient, jobIds: string[], name: string) {
  try {
    for (const id of jobIds) {
      const response = await page.request.get(`/api/v1/calculation-jobs/${id}`);
      if (!response.ok()) continue;
      if (["QUEUED", "RUNNING"].includes((await response.json()).job.status)) {
        await page.request.post(`/api/v1/calculation-jobs/${id}/cancel`);
        await expect.poll(async () => (await (await page.request.get(`/api/v1/calculation-jobs/${id}`)).json()).job.status, { timeout: 15_000 }).not.toMatch(/^(QUEUED|RUNNING)$/);
      }
    }
    await db.project.deleteMany({ where: { name } });
    const jobs = await db.calculationJob.findMany({ where: { id: { in: jobIds }, status: { in: ["SUCCEEDED", "FAILED", "CANCELLED"] } }, select: { runId: true } });
    await db.calculationRun.deleteMany({ where: { id: { in: jobs.map(j => j.runId) } } });
  } finally { await db.$disconnect(); }
}
test("guest salary123456, copied scenario and pilot survive same-tab auth and explicit worker CREATE", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  let projectId: string | undefined;
  const jobIds: string[] = [];
  const name = `e2e-guest-handoff-${Date.now()}`;
  const notes = "Пилот из гостевого расчёта 123456: проверить поток и вмешательства";
  try {
    await page.setExtraHTTPHeaders({ "x-forwarded-for": `e2e-handoff-${crypto.randomUUID()}` });
    await page.goto("/demo?example=steady-flow");
    await ready(page);
    await step(page, 5);
    await page.getByRole("tablist", { name: "Сценарий для экономики", exact: true }).getByRole("tab", { name: /^Покупка/ }).click();
    await step(page, 2);
    await page.locator("#p-forkliftSalaryRubMonth").fill("123456");
    await step(page, 6);
    const copyReply = page.waitForResponse(r => r.url().endsWith("/api/v1/demo-calculation") && r.request().method() === "POST", { timeout: 90_000 });
    await page.getByRole("button", { name: "Копировать сценарий", exact: true }).click();
    const copy = await copyReply;
    expect(copy.status(), await copy.text()).toBe(200);
    expect(copy.request().postDataJSON().params.forkliftSalaryRubMonth).toBe(123456);
    expect(copy.request().postDataJSON().scenarios).toHaveLength(4);
    await ready(page);
    await step(page, 8);
    const pilot = page.locator("[data-pilot-scenario]");
    await pilot.getByText("Настроить состав, смету и критерии пилота", { exact: true }).click();
    await pilot.getByLabel(/^Примечание к плану/).fill(notes);
    await pilot.getByLabel("Цель потока участка пилота, операций/ч", { exact: true }).fill("17");
    const pilotReply = page.waitForResponse(r => r.url().endsWith("/api/v1/demo-calculation") && r.request().method() === "POST", { timeout: 90_000 });
    await pilot.getByRole("button", { name: "Применить план и пересчитать сценарий", exact: true }).click();
    const applied = await pilotReply;
    expect(applied.status(), await applied.text()).toBe(200);
    const guestInput = applied.request().postDataJSON();
    const plannedScenario = guestInput.scenarios.find((s: { pilotPlan?: { notes?: string } }) => s.pilotPlan?.notes === notes);
    expect(plannedScenario).toBeDefined();
    await ready(page);
    await page.getByRole("button", { name: "Войти, чтобы сохранить проект", exact: true }).click();
    await expect(page).toHaveURL(/\/login\?guestDraft=[a-f0-9-]+$/);
    const nonce = new URL(page.url()).searchParams.get("guestDraft")!;
    await expect(page.locator('input[name="guestDraft"]')).toHaveValue(nonce);
    await page.getByRole("banner").getByRole("link", { name: "Регистрация", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/signup\\?guestDraft=${nonce}$`));
    await expect(page.locator('input[name="guestDraft"]')).toHaveValue(nonce);
    await page.getByRole("banner").getByRole("link", { name: "Войти", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/login\\?guestDraft=${nonce}$`));
    await page.getByRole("main").getByRole("link", { name: "Регистрация", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/signup\\?guestDraft=${nonce}$`));
    await page.getByRole("main").getByRole("link", { name: "Войти", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/login\\?guestDraft=${nonce}$`));
    await expect(page.getByRole("heading", { level: 1, name: "Вход", exact: true })).toBeVisible();
    await page.locator("#email").fill("demo@demo.local");
    await page.locator("#password").fill("wrong-password-handoff");
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/login\\?guestDraft=${nonce}&error=1$`), { timeout: 15_000 });
    await page.locator("#email").fill("demo@demo.local");
    await page.locator("#password").fill(process.env.DEMO_USER_PASSWORD ?? "demo-user-2026");
    const createRequests: unknown[] = [];
    page.on("request", r => { if (r.url().endsWith("/api/v1/calculation-jobs") && r.method() === "POST") createRequests.push(r.postDataJSON()); });
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/new\\?guestDraft=${nonce}$`));
    const handoff = page.getByRole("region", { name: "Гостевой черновик" });
    await expect(handoff).toContainText("4 сценария");
    expect(createRequests).toHaveLength(0); // Login and opening the form never auto-save.
    // A copied nonce in another tab cannot select a draft or silently create a demo project.
    const other = await page.context().newPage();
    await other.goto(page.url());
    await expect(other.getByRole("alert").filter({ hasText: "Черновик недоступен" })).toBeVisible();
    await expect(other.getByRole("button", { name: "Создать проект", exact: true })).toBeDisabled();
    await other.close();
    await page.getByLabel("Название проекта", { exact: true }).fill(name);
    const accepted = page.waitForResponse(r => r.url().endsWith("/api/v1/calculation-jobs") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Создать проект", exact: true }).click();
    const receipt = await accepted;
    expect(receipt.status(), await receipt.text()).toBe(202);
    const jobId = (await receipt.json()).job.id;
    jobIds.push(jobId);
    const submitted = receipt.request().postDataJSON();
    expect(submitted).toMatchObject({ operation: "CREATE", name, facility: "warehouse", params: { forkliftSalaryRubMonth: 123456 } });
    expect(submitted.scenarios).toHaveLength(4);
    const expectedScenario = { ...plannedScenario };
    delete expectedScenario.spatialEvidence;
    expect(submitted.scenarios.find((s: { key: string }) => s.key === plannedScenario.key)).toEqual(expectedScenario);
    for (const scenario of submitted.scenarios) expect(scenario.spatialEvidence).toBeUndefined();
    expect(submitted.results).toBeUndefined();
    await expect.poll(async () => (await (await page.request.get(`/api/v1/calculation-jobs/${jobId}`)).json()).job.status, { timeout: 90_000 }).toBe("SUCCEEDED");
    const fresh = await (await page.request.get(`/api/v1/calculation-jobs/${jobId}/result`)).json();
    projectId = fresh.job.projectId;
    expect(fresh.job.publicationState).toBe("PUBLISHED");
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}\\?edit=1$`), { timeout: 30_000 });
    expect(await page.evaluate(key => sessionStorage.getItem(key), "alfa:guest-draft:" + nonce)).toBeNull();
    expect(fresh.results.paramsUsed.forkliftSalaryRubMonth).toBe(123456);
    const serverScenario = fresh.results.scenarios.find((s: { key: string }) => s.key === plannedScenario.key);
    expect(serverScenario.pilotPlan.notes).toBe(notes);
    expect(serverScenario.pilotPlan.targetThroughputPerH).toBe(17);
    expect(serverScenario.spatialEvidence?.simModelVersion).toBe(SPATIAL_MODEL_VERSION);
    const stored = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { name: true, params: true, results: true } });
    expect(stored.name).toBe(name);
    expect((stored.params as Record<string, unknown>).forkliftSalaryRubMonth).toBe(123456);
    await page.goto(`/projects/${projectId}?edit=1#params`);
    await expect.poll(async () => Number((await page.locator("#p-forkliftSalaryRubMonth").inputValue()).replace(/\s/g, ""))).toBe(123456);
    await testInfo.attach("guest-input-handoff", { body: JSON.stringify({ nonce, projectId, jobId, submitted, actualVersion: serverScenario.spatialEvidence?.simModelVersion }), contentType: "application/json" });
  } finally {
    await cleanupOwnedTestJobs(page, db, jobIds, name);
  }
});

test("queued guest CREATE survives closing/refreshing, actual cancellation and explicit retry", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const jobIds: string[] = [];
  const name = `e2e-guest-handoff-recovery-${Date.now()}`;
  let release!: () => void;
  let claimLock: Promise<unknown> | undefined;
  try {
    await page.setExtraHTTPHeaders({ "x-forwarded-for": `e2e-handoff-recovery-${crypto.randomUUID()}` });
    await page.goto("/login");
    await page.locator("#email").fill("demo@demo.local");
    await page.locator("#password").fill(process.env.DEMO_USER_PASSWORD ?? "demo-user-2026");
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await expect(page).toHaveURL(/\/projects$/);
    const nonce = crypto.randomUUID();
    const tab = "alfa-guest-tab:" + crypto.randomUUID();
    const inputs = businessExampleInputs("steady-flow", baseValuesFor("warehouse"), CATALOG.map(productForCalcFromSeed));
    inputs.params.forkliftSalaryRubMonth = 123456;
    // Input-only fixture isolates recovery; the preceding test covers actual guest edits/auth.
    await page.evaluate(({ nonce, tab, inputs }) => {
      window.name = tab;
      sessionStorage.setItem("alfa:guest-draft:" + nonce, JSON.stringify({ version: 1, tab, createdAt: Date.now(), facility: "warehouse", ...inputs }));
    }, { nonce, tab, inputs });
    const draftUrl = `/projects/new?guestDraft=${nonce}`;
    await page.goto(draftUrl);
    await page.getByLabel("Название проекта", { exact: true }).fill(name);
    let locked!: () => void;
    const lockReady = new Promise<void>(resolve => { locked = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    // Same existing isolated-E2E advisory lock as durable-project-jobs: only prevents claims.
    claimLock = db.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(1746021302)::text AS locked`;
      locked();
      await gate;
    }, { timeout: 45_000, maxWait: 10_000 });
    await Promise.race([lockReady, claimLock.then(() => { throw new Error("Worker lock ended early"); })]);
    const creates: string[] = [];
    page.on("response", async r => {
      if (r.url().endsWith("/api/v1/calculation-jobs") && r.request().method() === "POST" && r.status() === 202) creates.push((await r.json()).job.id);
    });
    const accepted = page.waitForResponse(r => r.url().endsWith("/api/v1/calculation-jobs") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Создать проект", exact: true }).click();
    const receipt = await accepted;
    expect(receipt.status()).toBe(202);
    const queued = (await receipt.json()).job;
    jobIds.push(queued.id);
    expect(queued.status).toBe("QUEUED");
    await expect(page).toHaveURL(new RegExp(`/calculation-jobs/${queued.id}\\?open=1&guestDraft=${nonce}$`));
    await page.reload();
    await expect(page.getByRole("link", { name: "Вернуться к гостевому черновику", exact: true })).toHaveAttribute("href", draftUrl);
    const before = await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)!), "alfa:guest-draft:" + nonce);
    expect(before.params.forkliftSalaryRubMonth).toBe(123456);
    expect(before.create.jobId).toBe(queued.id);
    await page.goto("/projects"); // Closing the operation view must not consume local inputs.
    await page.goto(draftUrl);
    await expect(page.getByLabel("Название проекта", { exact: true })).toHaveValue(name);
    await page.getByRole("button", { name: "Открыть принятый расчёт", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/calculation-jobs/${queued.id}\\?`));
    expect(creates).toEqual([queued.id]);
    await page.getByRole("button", { name: "Отменить расчёт", exact: true }).click();
    await expect.poll(async () => (await (await page.request.get(`/api/v1/calculation-jobs/${queued.id}`)).json()).job.status).toBe("CANCELLED");
    await page.goto("/projects");
    await page.goto(draftUrl);
    await expect(page.getByRole("button", { name: "Повторить создание проекта", exact: true })).toBeEnabled();
    expect(await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)!).params.forkliftSalaryRubMonth, "alfa:guest-draft:" + nonce)).toBe(123456);
    release();
    await claimLock;
    claimLock = undefined;
    const retried = page.waitForResponse(r => r.url().endsWith("/api/v1/calculation-jobs") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Повторить создание проекта", exact: true }).click();
    const retryReceipt = await retried;
    expect(retryReceipt.status()).toBe(202);
    const retryId = (await retryReceipt.json()).job.id;
    jobIds.push(retryId);
    expect(retryId).not.toBe(queued.id);
    expect(retryReceipt.request().postDataJSON().params.forkliftSalaryRubMonth).toBe(123456);
    await expect(page).toHaveURL(url => url.pathname.startsWith("/projects/") && url.pathname !== "/projects/new", { timeout: 90_000 });
    expect(await page.evaluate(key => sessionStorage.getItem(key), "alfa:guest-draft:" + nonce)).toBeNull();
    await testInfo.attach("actual-cancel-and-recovery", { body: JSON.stringify({ jobIds, project: page.url(), creates }), contentType: "application/json" });
  } finally {
    release?.();
    try { if (claimLock) await claimLock; }
    finally { await cleanupOwnedTestJobs(page, db, jobIds, name); }
  }
});

test("actual signup keeps the same-tab input draft and waits for explicit project creation", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const email = `e2e+guest-handoff-${Date.now()}-${crypto.randomUUID()}@example.test`;
  const nonce = crypto.randomUUID();
  const tab = "alfa-guest-tab:" + crypto.randomUUID();
  const inputs = businessExampleInputs("steady-flow", baseValuesFor("warehouse"), CATALOG.map(productForCalcFromSeed));
  inputs.params.forkliftSalaryRubMonth = 123456;
  const purchase = inputs.scenarios.find(s => s.key === "purchase")!;
  purchase.name = "Гостевой сценарий регистрации 123456";
  const pilot: PilotPlanInput = { schemaVersion: "pilot-plan-1", fleet: 2, chargers: 1, durationDays: 7, dayBasis: "calendar", acquisition: "purchase",
    costs: { setup: { valueRub: null, source: "" }, integration: { valueRub: null, source: "" }, training: { valueRub: null, source: "" }, logistics: { valueRub: null, source: "" }, sitePreparation: { valueRub: null, source: "" }, evaluation: { valueRub: null, source: "" } },
    equipmentUnitRubOverride: null, contingencyPct: 10, targetThroughputPerH: 17, maxP95WaitMin: 3, maxInterventionsPerShift: 1, readiness: ["baseline"], notes: "Пилот из регистрации123456" };
  purchase.pilotPlan = pilot;
  try {
    await page.setExtraHTTPHeaders({ "x-forwarded-for": `e2e-guest-signup-${crypto.randomUUID()}` });
    await page.goto("/signup");
    await page.evaluate(({ nonce, tab, inputs }) => {
      window.name = tab;
      sessionStorage.setItem("alfa:guest-draft:" + nonce, JSON.stringify({ version: 1, tab, createdAt: Date.now(), facility: "warehouse", params: inputs.params, scenarios: inputs.scenarios }));
    }, { nonce, tab, inputs });
    await page.goto(`/signup?guestDraft=${nonce}`);
    await expect(page.locator('input[name="guestDraft"]')).toHaveValue(nonce);
    await page.getByLabel("Имя (необязательно)", { exact: true }).fill("Гость E2E123456");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Пароль", { exact: true }).fill(`Guest-handoff-${crypto.randomUUID()}`);
    const createRequests: string[] = [];
    page.on("request", r => { if (r.url().endsWith("/api/v1/calculation-jobs") && r.method() === "POST") createRequests.push(r.url()); });
    await page.getByRole("button", { name: "Зарегистрироваться", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/new\\?guestDraft=${nonce}$`), { timeout: 30_000 });
    const handoff = page.getByRole("region", { name: "Гостевой черновик" });
    await expect(handoff).toContainText(purchase.name);
    await expect(handoff).toContainText("с планом пилота");
    const retained = await page.evaluate(key => {
      const record = JSON.parse(sessionStorage.getItem(key)!);
      return { facility: record.facility, params: record.params, scenarios: record.scenarios };
    }, "alfa:guest-draft:" + nonce);
    expect(retained).toEqual({ facility: "warehouse", params: inputs.params, scenarios: inputs.scenarios });
    expect(createRequests).toEqual([]);
    await expect(page.getByRole("button", { name: "Создать проект", exact: true })).toBeEnabled();
    const user = await db.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
    expect(await db.project.count({ where: { userId: user.id } })).toBe(0);
    await testInfo.attach("actual-signup-draft-handoff", { body: JSON.stringify({ nonce, accountCreated: true, draftRetained: true, salary: retained.params.forkliftSalaryRubMonth, scenario: purchase.name, pilotNotes: pilot.notes, autoCreateRequests: createRequests.length }), contentType: "application/json" });
  } finally {
    await db.user.deleteMany({ where: { email } });
    await db.$disconnect();
  }
});
