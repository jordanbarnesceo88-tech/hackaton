import { expect, type Page } from "@playwright/test";
import { PrismaClient, type Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import { DEFAULT_ASSUMPTIONS } from "../lib/economics/assumptions";
import { computeEconomics } from "../lib/economics/calculate";
import { toSolutionCapacity } from "../lib/economics/normalize";
import { REGION_PRESETS, regionLaborCostUsd } from "../lib/economics/regions";
import { validateAssumptions, validateParams } from "../lib/analyses/validate";

/** Navigation-only checks never mock a calculation as ready. */
export async function navigationOnly(page: Page) {
  await page.route("**/api/v1/demo-calculation", route => route.fulfill({
    status: 503, json: { error: "Navigation-only fixture: calculation is not exercised" },
  }));
}

export async function openStep(page: Page, n: number) {
  await page.getByRole("navigation", { name: "Шаги расчёта" }).getByRole("link", { name: new RegExp(`^${n} `) }).click();
  await expect(page.getByRole("heading", { level: 2, name: new RegExp(`^Шаг ${n} из 8`) })).toBeVisible();
}

/** Only an exact throwaway owner is written. Financial figures use the real catalogue and v1 engine. */
export async function createOwnedArchive(page: Page) {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const email = `e2e+archive-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  let userId: string | undefined;
  const cleanup = async () => {
    try { if (userId) await db.user.deleteMany({ where: { id: userId, email } }); }
    finally { await db.$disconnect(); }
  };
  try {
    await page.goto("/signup");
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill("password123");
    await page.getByRole("button", { name: "Зарегистрироваться", exact: true }).click();
    await expect(page).toHaveURL(/\/projects(?:\?|$)/);
    const owner = await db.user.findUniqueOrThrow({ where: { email } });
    userId = owner.id;
    const solutions = await db.solution.findMany({
      where: { solutionCategory: { facilityTypes: { some: { facilityType: { slug: "warehouse" } } } } },
      include: { solutionCategory: true }, orderBy: { id: "asc" },
    });
    const assumptions = { ...DEFAULT_ASSUMPTIONS, usdToRub: 110 };
    const region = REGION_PRESETS.find(r => r.id === "moscow")!;
    assumptions.laborCostPerHourUsd = regionLaborCostUsd(region, assumptions.usdToRub);
    assumptions.energyCostFactor = region.energyCostFactor;
    const candidates = solutions.map(solution => {
      const params = { areaM2: 10000, opsPerDay: 5000, staffCount: 40, quantityOverride: 6,
        taskStaffing: { [solution.solutionCategory.slug]: 40 } };
      return { solution, params, result: computeEconomics(toSolutionCapacity({ ...solution,
        workloadStream: solution.solutionCategory.workloadStream, categorySlug: solution.solutionCategory.slug,
        workerOutputPerYear: solution.solutionCategory.workerOutputPerYear }), params, assumptions) };
    });
    const chosen = candidates.find(c => c.result.economical);
    if (!chosen || !chosen.result.economical) throw new Error("The real catalogue has no cash-flow-positive archive fixture; do not invent financial figures");
    const params = chosen.params;
    if (!validateParams(params) || !validateAssumptions(assumptions)) throw new Error("Archive fixture must pass the actual v1 input validators");
    const analysis = await db.savedAnalysis.create({ data: { userId, name: "e2e readonly archive", facilityTypeSlug: "warehouse",
      solutionId: chosen.solution.id, params: params as Prisma.InputJsonValue,
      assumptions: assumptions as Prisma.InputJsonValue, results: chosen.result as Prisma.InputJsonValue } });
    return { db, owner, email, analysis, solution: chosen.solution, result: chosen.result, params, assumptions, cleanup };
  } catch (error) { await cleanup(); throw error; }
}
