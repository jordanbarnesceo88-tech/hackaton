import { test, expect } from "@playwright/test";

// Первый визит: без флага «тур просмотрен» (конфиг по умолчанию его ставит — см.
// playwright.config.ts).
test.use({ storageState: { cookies: [], origins: [] } });

test("тур открывается сам при первом визите, «Пропустить» закрывает его насовсем", async ({ page }) => {
  await page.goto("/");
  const tour = page.getByRole("dialog");
  await expect(tour).toBeVisible();
  await expect(tour.getByText("Шаг 1 из 8")).toBeVisible();
  // Фокус — на главном действии тура, а не на первой кнопке по порядку.
  await expect(tour.getByRole("button", { name: "Далее" })).toBeFocused();

  await tour.getByRole("button", { name: "Пропустить" }).click();
  await expect(tour).toBeHidden();

  // Флаг сохранён: при следующем визите тур сам не открывается.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("«Назад»/«Далее» листают шаги; «Как это работает» открывает тур с первого шага", async ({ page }) => {
  await page.goto("/");
  const tour = page.getByRole("dialog");
  await expect(tour).toBeVisible();
  // На первом шаге «Назад» нет.
  await expect(tour.getByRole("button", { name: "Назад" })).toHaveCount(0);

  await tour.getByRole("button", { name: "Далее" }).click();
  await tour.getByRole("button", { name: "Далее" }).click();
  await expect(tour.getByText("Шаг 3 из 8")).toBeVisible();
  await tour.getByRole("button", { name: "Назад" }).click();
  await expect(tour.getByText("Шаг 2 из 8")).toBeVisible();

  // Закрытие крестиком из шапки окна.
  await tour.getByRole("button", { name: "Закрыть" }).click();
  await expect(tour).toBeHidden();

  // Повторное открытие начинается с первого шага, а не с того, на котором закрыли.
  await page.getByRole("button", { name: "Как это работает" }).click();
  await expect(page.getByRole("dialog").getByText("Шаг 1 из 8")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
});
