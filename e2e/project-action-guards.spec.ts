import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";

test("dirty exports and live refresh preserve local input, including edits during a request", async ({ page }) => {
  test.setTimeout(180_000);
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  let projectId: string | undefined;
  try {
    await page.goto("/login");
    await page.locator("#email").fill("demo@demo.local");
    await page.locator("#password").fill(process.env.DEMO_USER_PASSWORD ?? "demo-user-2026");
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await expect(page).toHaveURL(/\/projects$/);
    const created = await page.request.post("/api/v1/projects", {
      data: { name: `e2e-guards-${Date.now()}`, facility: "warehouse" },
    });
    expect(created.status()).toBe(201);
    const project = await created.json();
    projectId = project.id;
    // Только собственная тестовая запись: создаём баннер без изменения общих справочников.
    await db.project.update({ where: { id: projectId }, data: {
      dataVersion: "older-data", results: { ...project.results, dataVersion: "older-data" },
    } });
    // Reopening a saved project defaults to its immutable archive. This test explicitly
    // enters the current-version editor to exercise dirty and in-flight edit protection.
    await page.goto(`/projects/${projectId}?edit=1#params`);
    const refresh = page.getByRole("button", { name: "Пересчитать на актуальных данных", exact: true });
    await expect(refresh).toBeEnabled();
    const salary = page.locator("#p-forkliftSalaryRubMonth");
    const original = await salary.inputValue();
    await salary.fill("121000");
    await expect(refresh).toBeDisabled();
    await expect(page.getByText(/Есть несохранённые изменения\. Сначала сохраните проект/)).toBeVisible();
    await page.getByRole("navigation", { name: "Шаги расчёта" }).getByRole("link", { name: "8 Отчёт", exact: true }).click();
    for (const name of ["Отчёт (PDF)", "Excel", "CSV"]) {
      await expect(page.locator("#report").getByRole("button", { name, exact: true })).toBeDisabled();
      await expect(page.locator("#report").getByRole("link", { name, exact: true })).toHaveCount(0);
    }
    await page.getByRole("navigation", { name: "Шаги расчёта" }).getByRole("link", { name: "2 Параметры", exact: true }).click();
    await salary.fill(original);
    await expect(refresh).toBeEnabled();

    // Откладываем только доставку настоящего результата worker, не подменяя расчёт.
    let releaseResponse!: () => void;
    const responseGate = new Promise<void>((resolve) => { releaseResponse = resolve; });
    let actionSeen!: () => void;
    const actionStarted = new Promise<void>((resolve) => { actionSeen = resolve; });
    await page.route(url => /^\/api\/v1\/calculation-jobs\/[^/]+\/result$/.test(url.pathname), async (route) => {
      const response = await route.fetch();
      actionSeen();
      await responseGate;
      await route.fulfill({ response });
    });
    await refresh.click();
    await actionStarted;
    await salary.fill("122000");
    releaseResponse();
    await expect(page.getByText(/После начала пересчёта ввод на странице изменился/)).toBeVisible({ timeout: 90_000 });
    await expect(salary).toHaveValue("122000");
    await expect(refresh).toBeDisabled();
  } finally {
    if (projectId) await db.project.deleteMany({ where: { id: projectId, name: { startsWith: "e2e-guards-" } } });
    await db.$disconnect();
  }
});
