import { test, expect } from "@playwright/test";

/**
 * Паритет шага «Решения» и шага «Расчёт».
 *
 * Список решений показывает срок окупаемости и NPV по каждому решению, а страница расчёта —
 * те же величины по выбранному. Это ДВА разных места, считающих одно и то же, и в репозитории
 * уже есть история о том, чем такое кончается: расхождение панели и отчёта однажды ушло
 * клиенту как 4 425 300 ₽ против 2 267 100 ₽ на экране.
 *
 * Сверять надо ДО первой правки допущений: после неё числа расходятся законно.
 */
test("NPV в списке решений совпадает с NPV в расчёте", async ({ page }) => {
  await page.goto("/onboarding");
  await page.getByRole("radio", { name: /Торговля и e-commerce/ }).click();
  await page.getByRole("link", { name: "Далее" }).click();

  await page.getByRole("radio", { name: /Склад$/ }).first().click();
  await page.getByRole("link", { name: "Далее" }).click();

  await expect(page).toHaveURL(/\/onboarding\/params/);
  await page.getByRole("link", { name: "Показать решения" }).click();
  await expect(page).toHaveURL(/\/compare\/warehouse/);

  // Колонки окупаемости и NPV появляются только когда параметры собраны — это и есть признак
  // того, что шаг 3 не собирает данные, которые никто не читает.
  await expect(page.getByRole("columnheader", { name: "NPV" }).first()).toBeVisible();

  const firstRow = page.locator("tbody tr").first();
  const cells = firstRow.locator("td");
  const npvInList = (await cells.last().locator("..").locator("td").nth(-2).innerText()).trim();
  expect(npvInList).not.toBe("");

  await firstRow.getByRole("link", { name: /Рассчитать/ }).click();
  await expect(page).toHaveURL(/\/calculate\//);

  // Параметры объекта обязаны доехать до расчёта — иначе он стартует с других входов, и
  // совпадение чисел было бы случайным.
  expect(page.url()).toMatch(/ops=/);

  const npvRow = page.getByText(/^NPV \(чистая приведённая стоимость\):/).first();
  const npvInCalc = (await npvRow.innerText()).split(":")[1]!.trim();

  expect(npvInCalc, `список: ${npvInList}, расчёт: ${npvInCalc}`).toBe(npvInList);
});
