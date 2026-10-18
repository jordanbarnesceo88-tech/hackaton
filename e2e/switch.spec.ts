import { test, expect } from "@playwright/test";
import { openStep } from "./legacy-support";

test("current scenario switch updates the economics panel in place without recalculation", async ({ page }) => {
  test.setTimeout(90_000);
  let calculations = 0;
  page.on("request", request => { if (request.method() === "POST" && request.url().endsWith("/api/v1/demo-calculation")) calculations++; });
  await page.goto("/demo?example=steady-flow");
  await expect(page.locator("[data-calculation-state]")).toHaveAttribute("data-calculation-state", "ready", { timeout: 75_000 });
  await openStep(page, 5);
  const tabs = page.getByRole("tablist", { name: "Сценарий для экономики" }).getByRole("tab");
  expect(await tabs.count()).toBeGreaterThanOrEqual(3);
  const targetId = await page.getByRole("tablist", { name: "Сценарий для экономики" }).getByRole("tab", { selected: false }).last().getAttribute("id");
  expect(targetId).not.toBeNull();
  // Keep the target stable when it stops matching selected:false after the click.
  const other = page.locator(`[id="${targetId}"]`);
  const panel = page.locator("#economics").getByRole("tabpanel");
  const oldLabel = await panel.getAttribute("aria-labelledby");
  const url = page.url(), requests = calculations;
  await other.click();
  await expect(other).toHaveAttribute("aria-selected", "true");
  await expect(panel).toHaveAttribute("aria-labelledby", targetId!);
  expect(targetId).not.toBe(oldLabel);
  expect(page.url()).toBe(url);
  expect(calculations).toBe(requests);
  await expect(page.locator("[data-calculation-state]")).toHaveAttribute("data-calculation-state", "ready");
});
