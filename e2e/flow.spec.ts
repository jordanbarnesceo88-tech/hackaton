import { test, expect } from "@playwright/test";

test("anonymous flow: onboarding → compare → calculate", async ({ page }) => {
  // Подбор стал пошаговым: отрасль → тип объекта → параметры → решения. Параметры
  // спрашиваются ДО сравнения, иначе сравнению нечем ранжировать, кроме абстрактной цены
  // за единицу производительности.
  await page.goto("/onboarding");
  await page.getByRole("radio", { name: /Торговля и e-commerce/ }).click();
  await page.getByRole("link", { name: "Далее" }).click();

  await expect(page).toHaveURL(/\/onboarding\/facility/);
  await page.getByRole("radio", { name: /^А?\s*Склад$/ }).first().click();
  await page.getByRole("link", { name: "Далее" }).click();

  await expect(page).toHaveURL(/\/onboarding\/params/);
  // Поля предзаполнены типовыми значениями — пустые поля здесь хуже приблизительных.
  await expect(page.locator("#opsPerDay")).not.toHaveValue("0");
  await page.getByRole("link", { name: "Показать решения" }).click();

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
