import { test, expect } from "@playwright/test";

test("model videos stay off the landing page and follow completed results in both workspace views", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  for (const [name, width, height, colorScheme] of [
    ["desktop", 1440, 1000, "light"], ["mobile", 390, 844, "light"], ["dark", 1440, 1000, "dark"],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.goto("/");
    await expect(page.locator('[data-video-id]')).toHaveCount(0);

    await page.goto("/catalog/pudu-cc1");
    const catalog = page.locator("#customer-videos");
    await expect(catalog.getByRole("link", { name: /Смотреть «SPI robotics/ })).toBeVisible();
    await expect(catalog.locator('a[href*="docs.google.com"], a[href*="rutube.ru/api"], details')).toHaveCount(0);
    await expect(catalog).not.toContainText("Источник и границы проверки");

    await page.goto("/demo?example=warehouse-cleaning");
    await expect(page.locator("[data-guest-calculation]")).toHaveAttribute("data-guest-calculation", "ready", { timeout: 90_000 });
    const steps = page.getByRole("navigation", { name: "Шаги расчёта" });
    await steps.getByRole("link", { name: /^8 / }).click();
    for (const mode of ["Подробно · расчёт и условия", "Кратко · для решения"]) {
      await page.getByRole("button", { name: mode, exact: true }).click();
      const videos = page.getByRole("region", { name: "Видео по моделям сценария" }).filter({ visible: true });
      await expect(videos).toHaveCount(1);
      await expect(videos.getByRole("link", { name: /Смотреть «SPI robotics/ })).toBeVisible();
      await expect(videos.getByRole("link", { name: "Карточка: PUDU CC1" }).first()).toHaveAttribute("href", "/catalog/pudu-cc1#customer-videos");
      await expect(videos.locator('a[href*="docs.google.com"], a[href*="rutube.ru/api"], details')).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await videos.getByRole("heading", { name: "Видео по моделям сценария", exact: true }).scrollIntoViewIfNeeded();
      await testInfo.attach(`${name}-${mode.startsWith("Кратко") ? "brief" : "detail"}-model-videos`, {
        body: await page.screenshot({ path: testInfo.outputPath(`${name}-${mode.startsWith("Кратко") ? "brief" : "detail"}.png`) }), contentType: "image/png",
      });
    }
  }
  expect(errors).toEqual([]);
});
