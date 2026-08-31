import { test, expect } from "@playwright/test";

test("in-place solution switch keeps the URL and updates the page", async ({ page }) => {
  // Warehouse AS/RS has ≥2 real siblings (Exotec + AutoStore).
  await page.goto("/compare/warehouse");
  await page.getByRole("link", { name: /Рассчитать/ }).nth(0).click();
  await expect(page).toHaveURL(/\/calculate\//);

  await expect(page.getByText("Рекомендация для вашего объекта")).toBeVisible();
  const makePrimary = page.getByRole("button", { name: "Сделать основным" }).first();
  // The switch button only appears when there is a non-selected sibling.
  await expect(makePrimary).toBeVisible();

  const heading = page.getByRole("heading", { level: 1 });
  const titleBefore = await heading.innerText();
  const urlBefore = page.url();

  await makePrimary.click();

  // Definitive in-place proof: the h1 (Расчёт экономики: {solution}) changes to the newly
  // selected solution WHILE the URL stays the same (no navigation).
  await expect(heading).not.toHaveText(titleBefore);
  expect(page.url()).toBe(urlBefore);
});
