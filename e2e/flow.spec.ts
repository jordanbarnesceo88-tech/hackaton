import { test, expect } from "@playwright/test";

test("anonymous flow: onboarding → compare → calculate", async ({ page }) => {
  await page.goto("/onboarding");
  // Подпись отрасли — «Торговля и e-commerce» после расширения справочника. Slug остался
  // `retail`, поэтому сохранённые расчёты не тронуты; поменялось только то, что видит человек.
  await page.getByText("Торговля и e-commerce", { exact: true }).click();
  await page.getByText("Склад", { exact: true }).click();
  await page.getByRole("button", { name: "Перейти к сравнению решений" }).click();

  await expect(page).toHaveURL(/\/compare\/warehouse/);
  // Real sourced products + honesty markers.
  await expect(page.getByText("оценка").first()).toBeVisible();
  await expect(page.getByText("открытый источник").first()).toBeVisible();
  await expect(page.getByText(/Hai Robotics|Exotec|AutoStore/).first()).toBeVisible();

  await page.getByRole("link", { name: /Рассчитать/ }).first().click();
  await expect(page).toHaveURL(/\/calculate\//);

  // Hero band + results + sensitivity render.
  await expect(page.getByText(/Окупается за|Не окупается/).first()).toBeVisible();
  await expect(page.getByText("CAPEX").first()).toBeVisible();
  await expect(page.getByText("Чувствительность NPV")).toBeVisible();
});
