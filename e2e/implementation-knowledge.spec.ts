import { expect, test } from "@playwright/test";
import { IMPLEMENTATION_CLASSES } from "../lib/implementation/guides";

test("class preparation and sourced cleaning cards stay reachable and readable", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/knowledge");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("От расчёта к внедрению");
  for (const type of IMPLEMENTATION_CLASSES) await expect(page.locator(`a[href='/knowledge/${type}']`)).toBeVisible();
  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/knowledge/cleaner");
    await expect(page.getByRole("heading", { name: "Как принимать пилот", exact: true })).toBeVisible();
    const classResources = page.getByRole("region", { name: "Материалы производителей", exact: true });
    await expect(classResources.getByRole("link", { name: /PUDU CC1/ })).toHaveAttribute("href", "https://academy.pudutech.com/en/docs/PUDU-CC1-Operation-Guide-V6");
    await expect(classResources).toContainText("Спецификация");
    await expect(page.locator("main")).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
    await testInfo.attach(`cleaning-guide-${width}`, { body: await page.screenshot({ path: testInfo.outputPath(`cleaning-guide-${width}.png`), fullPage: true }), contentType: "image/png" });
    await page.goto("/catalog/pudu-cc1");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("PUDU CC1");
    const modelResources = page.getByRole("region", { name: "Материалы производителей", exact: true });
    await expect(modelResources).toContainText("Руководство");
    await expect(modelResources.getByRole("link", { name: /PUDU CC1/ })).toHaveAttribute("rel", "noopener noreferrer");
    await expect(modelResources).not.toContainText("VIGGO");
    await expect(page.locator("body")).toContainText("Цена не подтверждена");
    await expect(page.locator("a[href='/knowledge/cleaner']")).toBeVisible();
    await expect(page.locator("a[href='https://pudurobots.ru/support']").first()).toBeVisible();
    await expect(page.locator("body")).toContainText("срок не опубликован");
    await expect(page.getByRole("row", { name: /Время зарядки/ })).toContainText(/до\s+180\s+мин/);
    await expect(page.getByRole("row", { name: /Дата общей проверки карточки/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
    await testInfo.attach(`pudu-card-${width}`, { body: await page.screenshot({ path: testInfo.outputPath(`pudu-card-${width}.png`), fullPage: true }), contentType: "image/png" });
    if (width === 390) {
      await expect(page.getByText("Прокрутите таблицу вправо → там источник, дата и подтверждение каждого значения.").first()).toBeVisible();
      const table = page.getByRole("region", { name: "Таблица: Технические характеристики", exact: true });
      expect(await table.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
      await table.evaluate(element => { element.scrollLeft = element.scrollWidth; });
      expect(await table.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
      await testInfo.attach("pudu-mobile-sources", { body: await page.screenshot({ path: testInfo.outputPath("pudu-mobile-sources.png"), fullPage: true }), contentType: "image/png" });
    }
  }
  for (const [slug, name] of [["agibot-c5", "AGIBOT C5"], ["viggo-sc80", "VIGGO SC80"]]) {
    await page.goto(`/catalog/${slug}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(name!);
    await expect(page.locator("body")).toContainText("Цена не подтверждена");
  }
  const missing = await page.goto("/knowledge/constructor");
  expect(missing?.status()).toBe(404);
  expect(errors).toEqual([]);
});
