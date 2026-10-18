import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { businessExampleInputs } from "../lib/projects/business-examples";
import { baseValuesFor } from "../lib/data/organizer/params";
import { CATALOG } from "../lib/data/organizer/catalog";
import { productForCalcFromSeed } from "../lib/catalog/product-for-calc";
import { SPATIAL_MODEL_VERSION } from "../lib/sim/spatial-bridge";

test("owner recalculation uses the worker, preserves newer edits and does not publish", async ({ page }) => {
  test.setTimeout(240_000);
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  let projectId: string | undefined;
  let releaseDelivery: (() => void) | undefined;
  const jobIds: string[] = [];
  try {
    await page.setExtraHTTPHeaders({ "x-forwarded-for": `e2e-owner-${crypto.randomUUID()}` });
    await page.goto("/login");
    await page.locator("#email").fill("demo@demo.local");
    await page.locator("#password").fill(process.env.DEMO_USER_PASSWORD ?? "demo-user-2026");
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await expect(page).toHaveURL(/\/projects$/);
    const input = businessExampleInputs("steady-flow", baseValuesFor("warehouse"), CATALOG.map(productForCalcFromSeed));
    const response = await page.request.post("/api/v1/calculation-jobs", {
      data: { operation: "CREATE", name: `e2e-owner-${Date.now()}`, facility: "warehouse", params: input.params, scenarios: input.scenarios },
      headers: { "Idempotency-Key": crypto.randomUUID() },
    });
    expect(response.status(), await response.text()).toBe(202);
    const createId = (await response.json()).job.id as string;
    jobIds.push(createId);
    await expect.poll(async () => (await (await page.request.get(`/api/v1/calculation-jobs/${createId}`)).json()).job.status,
      { timeout: 90_000 }).toBe("SUCCEEDED");
    projectId = (await (await page.request.get(`/api/v1/calculation-jobs/${createId}/result`)).json()).job.projectId;
    const before = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { revision: true, params: true, results: true } });
    await page.goto(`/projects/${projectId}?edit=1#params`);
    const salary = page.locator("#p-forkliftSalaryRubMonth");
    await expect(salary).toBeVisible();
    await salary.fill("121000");

    let fetched!: () => void;
    const fetchedResult = new Promise<void>(resolve => { fetched = resolve; });
    const deliveryGate = new Promise<void>(resolve => { releaseDelivery = resolve; });
    const resultMatcher = /\/api\/v1\/calculation-jobs\/[^/]+\/result$/;
    await page.route(resultMatcher, async route => {
      const actual = await route.fetch();
      expect(actual.status()).toBe(200);
      fetched();
      await deliveryGate;
      await route.fulfill({ response: actual });
    });
    const accepted = page.waitForResponse(r => r.url().endsWith("/api/v1/calculation-jobs") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Пересчитать", exact: true }).click();
    const receipt = await accepted;
    expect(receipt.status()).toBe(202);
    expect(receipt.request().postDataJSON()).toMatchObject({ operation: "CALCULATE", params: { forkliftSalaryRubMonth: 121000 } });
    jobIds.push((await receipt.json()).job.id);
    await fetchedResult;
    await salary.fill("122000");
    releaseDelivery!();
    await expect(page.locator("[data-server-calculation]")).toHaveAttribute("data-server-calculation", "edited");
    await expect(salary).toHaveValue(/^122\s?000$/);
    await page.unroute(resultMatcher);

    const nextAccepted = page.waitForResponse(r => r.url().endsWith("/api/v1/calculation-jobs") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Пересчитать", exact: true }).click();
    const next = await nextAccepted;
    expect(next.status()).toBe(202);
    expect(next.request().postDataJSON()).toMatchObject({ operation: "CALCULATE", params: { forkliftSalaryRubMonth: 122000 } });
    jobIds.push((await next.json()).job.id);
    await expect(page.locator("[data-server-calculation]")).toHaveAttribute("data-server-calculation", "ready", { timeout: 90_000 });
    await expect(salary).toHaveValue(/^122\s?000$/);
    await expect(page.getByRole("link", { name: "Есть несохранённые изменения — сохраните проект (шаг 8)" })).toBeVisible();
    const calculated = await (await page.request.get(`/api/v1/calculation-jobs/${jobIds.at(-1)}/result`)).json();
    expect(calculated.results.scenarios.find((s: { key: string }) => s.key === "purchase").spatialEvidence).toMatchObject({
      simModelVersion: SPATIAL_MODEL_VERSION, assessment: { terminal: true }, summary: { fleet: 5 },
    });
    const after = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { revision: true, params: true, results: true } });
    expect(after).toEqual(before);
  } finally {
    releaseDelivery?.();
    await page.unrouteAll({ behavior: "wait" });
    if (projectId) await db.project.deleteMany({ where: { id: projectId, name: { startsWith: "e2e-owner-" } } });
    // Only the terminal runs created by this test are removed.
    const jobs = await db.calculationJob.findMany({ where: { id: { in: jobIds }, status: { in: ["SUCCEEDED", "FAILED", "CANCELLED"] } }, select: { runId: true } });
    await db.calculationRun.deleteMany({ where: { id: { in: jobs.map(j => j.runId) } } });
    await db.$disconnect();
  }
});
