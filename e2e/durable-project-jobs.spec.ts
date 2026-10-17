import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import { readFile } from "node:fs/promises";

test.use({ viewport: { width: 1366, height: 768 } });

async function login(page: Page) {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `e2e-durable-ui-${Date.now()}-${Math.random().toString(16).slice(2)}` });
  await page.goto("/login");
  await page.locator("#email").fill("demo@demo.local");
  await page.locator("#password").fill(process.env.DEMO_USER_PASSWORD ?? "demo-user-2026");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
}

async function openStep(page: Page, label: string) {
  await page.getByRole("navigation", { name: "Шаги расчёта" }).getByRole("link", { name: label, exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name: new RegExp(`^Шаг ${label.split(" ")[0]} из`) })).toBeVisible();
}

async function enqueue(page: Page, input: unknown) {
  const response = await page.request.post("/api/v1/calculation-jobs", { data: input, headers: { "Idempotency-Key": crypto.randomUUID() } });
  expect(response.status(), await response.text()).toBe(202);
  return (await response.json()).job as { id: string; status: string };
}

async function completed(page: Page, id: string) {
  await expect.poll(async () => (await (await page.request.get(`/api/v1/calculation-jobs/${id}`)).json()).job.status,
    { timeout: 90_000, intervals: [100, 250, 500] }).toBe("SUCCEEDED");
  return (await (await page.request.get(`/api/v1/calculation-jobs/${id}/result`)).json());
}

async function createProject(page: Page) {
  const job = await enqueue(page, { operation: "CREATE", name: `e2e-durable-${Date.now()}`, facility: "warehouse" });
  return (await completed(page, job.id)).job.projectId as string;
}

function dbClient() {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
}

async function cleanup(db: PrismaClient, projectId?: string) {
  if (projectId) await db.project.deleteMany({ where: { id: projectId, name: { startsWith: "e2e-durable-" } } });
  await db.$disconnect();
}

/** Real queue fault injection: hold its claim lock while testing a queued user operation.
 * Inputs, server responses, calculations and final publication are never fabricated. */
async function whileWorkerCannotClaim(db: PrismaClient, run: () => Promise<void>) {
  let release!: () => void;
  let locked!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { locked = resolve; });
  const transaction = db.$transaction(async tx => {
    // Same claim advisory key as lib/calculation-jobs/store.ts; this pauses only new claims.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(1746021302)::text AS locked`;
    locked();
    await gate;
  }, { timeout: 30_000, maxWait: 10_000 });
  await Promise.race([ready, transaction.then(() => { throw new Error("Worker pause ended before its lock was acquired"); })]);
  try { await run(); }
  finally { release(); await transaction; }
}

test("durable CREATE and SAVE preserve newer edits; closing the view keeps the accepted computation", async ({ page }) => {
  test.setTimeout(240_000);
  const db = dbClient();
  let projectId: string | undefined;
  let releasePendingDelivery: (() => void) | undefined;
  try {
    await login(page);
    await page.goto("/projects/new");
    await page.getByLabel("Название проекта").fill(`e2e-durable-${Date.now()}`);
    const accepted = page.waitForResponse(response => response.url().endsWith("/api/v1/calculation-jobs") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Создать проект", exact: true }).click();
    const receipt = await accepted;
    expect(receipt.status()).toBe(202);
    const createId = (await receipt.json()).job.id;
    await expect(page).toHaveURL(url => /^\/projects\/(?!new$)[^/]+$/.test(url.pathname) && url.searchParams.get("edit") === "1", { timeout: 90_000 });
    projectId = new URL(page.url()).pathname.split("/").at(-1);
    expect((await completed(page, createId)).job.projectId).toBe(projectId);

    await openStep(page, "2 Параметры");
    const salary = page.locator("#p-forkliftSalaryRubMonth");
    await salary.fill("121000");
    await openStep(page, "8 Отчёт");
    let deliver!: () => void;
    let fetched!: () => void;
    const deliveryGate = new Promise<void>(resolve => { deliver = resolve; });
    releasePendingDelivery = deliver;
    const resultFetched = new Promise<void>(resolve => { fetched = resolve; });
    const resultMatcher = /\/api\/v1\/calculation-jobs\/[^/]+\/result$/;
    await page.route(resultMatcher, async route => {
      const actual = await route.fetch();
      fetched();
      await deliveryGate;
      await route.fulfill({ response: actual });
    });
    await page.getByRole("button", { name: "Сохранить проект", exact: true }).click();
    await resultFetched;
    await openStep(page, "2 Параметры");
    await salary.fill("122000");
    deliver();
    await openStep(page, "8 Отчёт");
    await expect(page.getByText(/^Проект сохранён/)).toBeVisible({ timeout: 90_000 });
    await page.unroute(resultMatcher);
    await openStep(page, "2 Параметры");
    await expect(salary).toHaveValue(/^122\s?000$/);
    const saved = await (await page.request.get(`/api/v1/projects/${projectId}`)).json();
    expect(saved.params.forkliftSalaryRubMonth).toBe(121000);
    expect(saved.revision).toBe(1);

    await openStep(page, "8 Отчёт");
    // Unmounting the toolbar must stop its watcher, never send a cancellation.
    const cancels: string[] = [];
    page.on("request", request => { if (request.url().endsWith("/cancel")) cancels.push(request.url()); });
    let nextId = "";
    await whileWorkerCannotClaim(db, async () => {
      const nextReceipt = page.waitForResponse(response => response.url().endsWith("/api/v1/calculation-jobs") && response.request().method() === "POST");
      await page.getByRole("button", { name: "Сохранить проект", exact: true }).click();
      nextId = (await (await nextReceipt).json()).job.id;
      expect((await (await page.request.get(`/api/v1/calculation-jobs/${nextId}`)).json()).job.status).toBe("QUEUED");
      await page.goto("/projects");
    });
    const final = await completed(page, nextId);
    expect(final.job.publicationState).toBe("PUBLISHED");
    expect(final.job.publishedRevision).toBe(2);
    expect(final.results.paramsUsed.forkliftSalaryRubMonth).toBe(122000);
    expect(cancels).toEqual([]);
    await page.goto(`/calculation-jobs/${nextId}`);
    await expect(page.getByText(/Расчёт завершён/).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Результат этого запуска", exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("job-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: test.info().outputPath("job-mobile.png"), fullPage: true });
    await page.goto("/calculation-jobs");
    await expect(page.getByRole("heading", { name: "Операции расчёта", exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("history-mobile.png"), fullPage: true });
    await page.goto(`/calculation-jobs/${createId}`);
    await expect(page).toHaveURL(url => url.pathname === `/calculation-jobs/${createId}` && !url.searchParams.has("open"));
    await expect(page.getByRole("heading", { name: "Результат этого запуска", exact: true })).toBeVisible();
    const archiveDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Скачать результат JSON", exact: true }).click();
    const archivePath = test.info().outputPath("original-create-result.json");
    await (await archiveDownload).saveAs(archivePath);
    expect(JSON.parse(await readFile(archivePath, "utf8")).results.paramsUsed.forkliftSalaryRubMonth).toBe(120000);
  } finally { releasePendingDelivery?.(); await cleanup(db, projectId); }
});

test("explicit cancellation of a queued SAVE leaves the published project unchanged", async ({ page }) => {
  test.setTimeout(150_000);
  const db = dbClient();
  let projectId: string | undefined;
  try {
    await login(page);
    projectId = await createProject(page);
    await page.goto(`/projects/${projectId}?edit=1#params`);
    await page.locator("#p-forkliftSalaryRubMonth").fill("124000");
    await openStep(page, "8 Отчёт");
    let jobId = "";
    await whileWorkerCannotClaim(db, async () => {
      const accepted = page.waitForResponse(response => response.url().endsWith("/api/v1/calculation-jobs") && response.request().method() === "POST");
      await page.getByRole("button", { name: "Сохранить проект", exact: true }).click();
      jobId = (await (await accepted).json()).job.id;
      await expect(page.getByText("Ожидает свободного вычислителя", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Отменить расчёт", exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: test.info().outputPath("queued-save-desktop.png") });
      await page.getByRole("button", { name: "Отменить расчёт", exact: true }).click();
      await expect(page.getByText("Расчёт отменён", { exact: true })).toBeVisible();
    });
    const status = (await (await page.request.get(`/api/v1/calculation-jobs/${jobId}`)).json()).job;
    expect(status.status).toBe("CANCELLED");
    const project = await (await page.request.get(`/api/v1/projects/${projectId}`)).json();
    expect(project.revision).toBe(0);
    expect(project.params.forkliftSalaryRubMonth).toBe(120000);
    await openStep(page, "2 Параметры");
    await expect(page.locator("#p-forkliftSalaryRubMonth")).toHaveValue(/^124\s?000$/);
    await page.goto(`/calculation-jobs/${jobId}`);
    const submittedDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Скачать отправленные параметры", exact: true }).click();
    const submittedPath = test.info().outputPath("cancelled-submitted.json");
    await (await submittedDownload).saveAs(submittedPath);
    const submitted = JSON.parse(await readFile(submittedPath, "utf8"));
    expect(submitted.params.forkliftSalaryRubMonth).toBe(124000);
    expect(submitted.expectedRevision).toBe(0);
    expect(submitted.live).toBeUndefined();
    expect(submitted.productSnapshots).toBeUndefined();
    expect((await (await page.request.get(`/api/v1/projects/${projectId}`)).json()).params.forkliftSalaryRubMonth).toBe(120000);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: test.info().outputPath("cancelled-job-mobile.png"), fullPage: true });
  } finally { await cleanup(db, projectId); }
});

test("a late SAVE is retained as STALE and never adopted into the newer project head", async ({ page }) => {
  test.setTimeout(180_000);
  const db = dbClient();
  let projectId: string | undefined;
  try {
    await login(page);
    projectId = await createProject(page);
    const original = await (await page.request.get(`/api/v1/projects/${projectId}`)).json();
    await page.goto(`/projects/${projectId}?edit=1#params`);
    await page.locator("#p-forkliftSalaryRubMonth").fill("121000");
    await openStep(page, "8 Отчёт");
    let earlier = "";
    let later = "";
    await whileWorkerCannotClaim(db, async () => {
      earlier = (await enqueue(page, { operation: "SAVE", projectId, expectedRevision: 0,
        params: { ...original.params, forkliftSalaryRubMonth: 125000 }, scenarios: original.scenarios, changes: [] })).id;
      const accepted = page.waitForResponse(response => response.url().endsWith("/api/v1/calculation-jobs") && response.request().method() === "POST");
      await page.getByRole("button", { name: "Сохранить проект", exact: true }).click();
      later = (await (await accepted).json()).job.id;
      await expect(page.getByText("Ожидает свободного вычислителя", { exact: true })).toBeVisible();
    });
    expect((await completed(page, earlier)).job.publicationState).toBe("PUBLISHED");
    expect((await completed(page, later)).job.publicationState).toBe("STALE");
    await expect(page.getByText(/Расчёт готов и сохранён отдельно: проект изменился/)).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText(/^Проект сохранён/)).toHaveCount(0);
    await page.getByText(/Расчёт готов и сохранён отдельно: проект изменился/).scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath("stale-save-desktop.png") });
    await openStep(page, "2 Параметры");
    await expect(page.locator("#p-forkliftSalaryRubMonth")).toHaveValue(/^121\s?000$/);
    const server = await (await page.request.get(`/api/v1/projects/${projectId}`)).json();
    expect(server.revision).toBe(1);
    expect(server.params.forkliftSalaryRubMonth).toBe(125000);
  } finally { await cleanup(db, projectId); }
});
