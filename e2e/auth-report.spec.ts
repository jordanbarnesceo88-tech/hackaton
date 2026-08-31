import { test, expect } from "@playwright/test";

test("signup → save analysis → open the report", async ({ page }) => {
  const email = `e2e+${Date.now()}@example.com`;

  await page.goto("/signup");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill("password123");
  const nameField = page.locator('input[name="name"]');
  if (await nameField.count()) await nameField.fill("E2E Tester");
  await page.getByRole("button", { name: "Зарегистрироваться" }).click();
  // signUpAction signs in + redirects to "/", which itself redirects to /onboarding — so a
  // successful signup lands on the onboarding page (proves we're authenticated + off /signup).
  await expect(page).toHaveURL(/\/onboarding/);

  // Reach a calculate page via the flow.
  await page.goto("/compare/warehouse");
  await page.getByRole("link", { name: /Рассчитать/ }).first().click();
  await expect(page).toHaveURL(/\/calculate\//);

  await page.getByRole("button", { name: "Сохранить расчёт" }).click();
  await expect(page.getByText("Сохранено")).toBeVisible();

  const reportLink = page.getByRole("link", { name: "Открыть отчёт" });
  await expect(reportLink).toBeVisible();
  await reportLink.click();

  await expect(page).toHaveURL(/\/report\//);
  await expect(page.getByText(/Отчёт ROI/)).toBeVisible();
  await expect(page.getByText(/не оферта/)).toBeVisible();
});
