import { test, expect } from "@playwright/test";
import { formatRub } from "../lib/format/rub";
import type { ProjectResults } from "../lib/tz/types";
import { openStep } from "./legacy-support";

test("current scenario table and decision use the same fresh server calculation", async ({ page }) => {
  test.setTimeout(90_000);
  const response = page.waitForResponse(r => r.url().endsWith("/api/v1/demo-calculation") && r.request().method() === "POST", { timeout: 75_000 });
  await page.goto("/demo?example=steady-flow");
  const actual = await response;
  expect(actual.status()).toBe(200);
  const { results } = await actual.json() as { results: ProjectResults };
  await expect(page.locator("[data-calculation-state]")).toHaveAttribute("data-calculation-state", "ready", { timeout: 75_000 });
  const candidate = results.results.find(r => r.status === "ok" && r.kind !== "asis" && typeof r.npvRub === "number" && Number.isFinite(r.npvRub));
  if (!candidate || candidate.status !== "ok") throw new Error("The actual server calculation has no numerical robot scenario to compare");
  await openStep(page, 5);
  await page.getByRole("tablist", { name: "Сценарий для экономики" }).getByRole("tab", { name: candidate.name, exact: true }).click();
  await openStep(page, 6);
  const table = page.getByRole("table", { name: /Сравнение сценариев/ });
  const headers = await table.getByRole("columnheader").allInnerTexts();
  const column = headers.findIndex(h => h.includes(candidate.name));
  expect(column).toBeGreaterThan(0);
  const npv = table.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "NPV", exact: true }) }).getByRole("cell").nth(column - 1);
  await expect(npv).toHaveText(formatRub(candidate.npvRub));
  const tableValue = await npv.innerText();
  await openStep(page, 8);
  const decision = page.locator("[data-decision-status]");
  await expect(decision.getByRole("heading", { name: candidate.name, exact: true })).toBeVisible();
  const metrics = decision.locator('dl[aria-label="Ключевые показатели решения"]');
  await expect(metrics.locator("div").filter({ has: page.locator("dt", { hasText: /^NPV за / }) }).locator("dd")).toHaveText(tableValue);
  // Parity also applies to PARTIAL; neither profit nor physical success is fabricated.
  await expect(decision).not.toHaveAttribute("data-decision-status", "stale");
});

test("current decision metrics stay within the viewport", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/demo?example=steady-flow");
  await expect(page.locator("[data-calculation-state]")).toHaveAttribute("data-calculation-state", "ready", { timeout: 75_000 });
  await openStep(page, 8);
  const bounds = await page.locator('dl[aria-label="Ключевые показатели решения"]').boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
});
