import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import { computeEconomics } from "../lib/economics/calculate";
import { toSolutionCapacity } from "../lib/economics/normalize";
import { ANALYSIS_INPUT_MAX_BYTES, validateAssumptions, validateParams } from "../lib/analyses/validate";

test("legacy HTTP save discards forged results and oversized commands without changing an existing analysis", async ({ page }) => {
  test.setTimeout(90_000);
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const email = `e2e+legacy-integrity-${Date.now()}@example.com`;
  let userId: string | undefined;
  try {
    await page.goto("/signup");
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill("password123");
    await page.getByRole("button", { name: "Зарегистрироваться", exact: true }).click();
    await expect(page).toHaveURL(/\/projects/);
    const owner = await db.user.findUniqueOrThrow({ where: { email } });
    userId = owner.id;
    await page.goto("/compare/warehouse?industry=retail&facility=warehouse&area=10000&ops=5000&staff=40" +
      "&task_asrs=4&task_amr=4&task_class-amr-transport=4&task_class-palletizer=4&task_class-cleaning=4");
    await page.getByRole("link", { name: /Рассчитать/ }).first().click();
    await expect(page).toHaveURL(/\/calculate\//);
    const name = page.locator("#analysis-name");
    const save = page.getByRole("button", { name: "Сохранить расчёт", exact: true });
    await name.fill("legacy integrity baseline");
    await save.click();
    await expect(page.getByText("Сохранено", { exact: true })).toBeVisible();
    const baseline = await db.savedAnalysis.findFirstOrThrow({ where: { userId, name: "legacy integrity baseline" } });

    let mutation: "forged" | "oversized" = "forged";
    let intercepted = 0;
    let unsupportedTransport: string | undefined;
    await page.route("**/calculate/**", async route => {
      const request = route.request();
      if (request.method() !== "POST" || !request.headers()["next-action"]) return route.continue();
      let args: unknown;
      try { args = JSON.parse(request.postData() ?? ""); }
      catch { unsupportedTransport = request.headers()["content-type"] ?? "unknown"; return route.continue(); }
      if (!Array.isArray(args) || !args[0] || typeof args[0] !== "object" || !("solutionId" in args[0])) {
        unsupportedTransport = "non-scalar React action arguments";
        return route.continue();
      }
      const input = args[0] as Record<string, unknown>;
      // Intercept the real UI-generated action ID/arguments. Keep the actual server
      // response and database writes; no Action response or economics is fabricated.
      expect(input).not.toHaveProperty("results");
      input.results = mutation === "forged"
        ? { economical: true, npvUsd: 999999999, capexUsd: 0, secretPadding: "forged client field" }
        : { padding: "я".repeat(ANALYSIS_INPUT_MAX_BYTES / 2) };
      input.userId = "forged-owner";
      intercepted++;
      await route.continue({ postData: JSON.stringify(args) });
    });

    await name.fill("legacy integrity forged");
    await save.click();
    await expect.poll(() => intercepted > 0 || Boolean(unsupportedTransport)).toBe(true);
    await expect(save).toBeEnabled();
    expect(unsupportedTransport, "The security gate must mutate the actual Action request; update the test if its transport changes").toBeUndefined();
    expect(intercepted).toBe(1);
    await expect.poll(() => db.savedAnalysis.count({ where: { userId, name: "legacy integrity forged" } })).toBe(1);
    const saved = await db.savedAnalysis.findFirstOrThrow({ where: { userId, name: "legacy integrity forged" } });
    const solution = await db.solution.findUniqueOrThrow({ where: { id: saved.solutionId }, include: { solutionCategory: true } });
    const params = validateParams(saved.params), assumptions = validateAssumptions(saved.assumptions);
    if (!params || !assumptions) throw new Error("The saved command lost validated inputs");
    const canonical = computeEconomics(toSolutionCapacity({ ...solution,
      workloadStream: solution.solutionCategory.workloadStream,
      categorySlug: solution.solutionCategory.slug,
      workerOutputPerYear: solution.solutionCategory.workerOutputPerYear }), params, assumptions);
    expect(saved.userId).toBe(owner.id);
    expect(saved.params).toEqual(baseline.params);
    expect(saved.assumptions).toEqual(baseline.assumptions);
    expect(saved.results).toEqual(canonical);
    expect(saved.results).not.toHaveProperty("secretPadding");
    expect(saved.results).not.toMatchObject({ npvUsd: 999999999, capexUsd: 0 });
    expect(await db.savedAnalysis.findUniqueOrThrow({ where: { id: baseline.id } })).toEqual(baseline);

    mutation = "oversized";
    const count = await db.savedAnalysis.count({ where: { userId } });
    await name.fill("legacy integrity oversized");
    await save.click();
    await expect(page.getByText("Ошибка сохранения", { exact: true })).toBeVisible();
    expect(intercepted).toBe(2);
    expect(await db.savedAnalysis.count({ where: { userId } })).toBe(count);
    expect(await db.savedAnalysis.findUniqueOrThrow({ where: { id: baseline.id } })).toEqual(baseline);
  } finally {
    // The exact throwaway owner is the only deletion target; analyses cascade with it.
    if (userId) await db.user.deleteMany({ where: { id: userId, email } });
    await db.$disconnect();
  }
});
