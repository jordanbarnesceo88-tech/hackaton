import { test, expect, type Page } from "@playwright/test";

/**
 * Гостевой демо-расчёт по методике ТЗ (/demo, ТЗ §3.1.2: гость видит демонстрационный расчёт
 * на данных организатора без сохранения; §5.5: три базовых типа объекта на уровне выбора,
 * параметров и доступных решений). Экран жюри — 1366×768 (ТЗ §4.5.5).
 *
 * Числа не закрепляются: их печатает scripts/print-demo-numbers.ts, а тест проверяет путь —
 * сценарии в одной таблице, видимый статус расчёта, вердикт имитации, управление и выгрузку PNG.
 */

test.use({ viewport: { width: 1366, height: 768 } });

/** Страница не шире окна: у жюри экран 1366×768, горизонтальной прокрутки быть не должно. */
async function expectNoHorizontalScroll(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, "страница шире окна 1366 px — появилась горизонтальная прокрутка").toBeLessThanOrEqual(clientWidth);
}

test("демо склада: сценарии в одной таблице, статус расчёта, имитация и PNG", async ({ page }) => {
  // Имитация в браузере прогоняет все сценарии и подбирает минимальный парк (бюджет 60 с).
  test.setTimeout(150_000);
  await page.goto("/demo");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Демо-расчёт");

  // Шаг 6: базовый сценарий, покупка и услуга — столбцы одной таблицы (ТЗ §2.2 шаг 6, §3.5.5).
  const scenarios = page.locator("#scenarios").getByRole("table", { name: /Сравнение сценариев/ });
  for (const name of ["Как есть", "Покупка — Ronavi H1500", "Услуга (RaaS) — Ronavi H1500"]) {
    await expect(scenarios.getByRole("columnheader", { name }), `столбец «${name}»`).toBeVisible();
  }
  // Видимый статус расчёта (ТЗ §4.3.3).
  await expect(page.getByText(/Расчёт выполнен за/).first()).toBeVisible();
  await expectNoHorizontalScroll(page);

  // Шаг 7: имитация подтверждает расчётный парк (ТЗ §3.6.2).
  const sim = page.locator("#simulation");
  await expect(sim.getByText("Расчёт подтверждён имитацией").filter({ visible: true }).first()).toBeVisible({
    timeout: 20_000,
  });

  // Парк по паспортной норме организатора на этой планировке не справляется — это находка,
  // которую имитация должна показать, а не спрятать.
  const select = sim.getByLabel("Сценарий и парк");
  const labels = (await select.locator("option:not([disabled])").allTextContents()).map((s) => s.trim());
  const byNorm =
    labels.find((l) => l.includes("Ronavi H1500") && l.includes("по норме организатора")) ??
    labels.find((l) => l.includes("по норме организатора"));
  expect(byNorm, `нет варианта «по норме организатора» среди: ${labels.join(" | ")}`).toBeDefined();
  await select.selectOption({ label: byNorm ?? "" });
  await expect(sim.getByText(/^Не подтверждён/).filter({ visible: true }).first()).toBeVisible({ timeout: 20_000 });

  // Управление (ТЗ §3.6.3): «▶ Старт» запускает проигрывание — часы модели идут.
  const clock = sim.getByText(/^Время имитации:/).filter({ visible: true }).first();
  await expect(clock).toBeVisible();
  const before = (await clock.innerText()).trim();
  await sim.getByRole("button", { name: "▶ Старт" }).click();
  await expect(clock).not.toHaveText(before, { timeout: 5_000 });
  const moving = (await clock.innerText()).trim();
  await expect(clock, "часы имитации остановились после старта").not.toHaveText(moving, { timeout: 5_000 });
  await sim.getByRole("button", { name: "❚❚ Стоп" }).click();

  // Выгрузка кадра имитации (ТЗ §3.7.4).
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    sim.getByRole("button", { name: "Скачать PNG" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.png$/);
});

for (const facility of ["airport", "medical"] as const) {
  test(`демо ${facility}: прототип — параметры и подбор без экономики`, async ({ page }) => {
    await page.goto(`/demo?facility=${facility}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Демо-расчёт");
    await expect(
      page.getByText("Прототип: экономика и имитация реализованы для склада").filter({ visible: true }).first(),
    ).toBeVisible();
    // Параметры объекта (шаг 2) показаны с полями ввода — уровень «входные параметры» §5.5.
    const params = page.locator("#params");
    await expect(params).toBeVisible();
    await expect(params.getByRole("heading", { name: /Шаг 2 из 8/ })).toBeVisible();
    await expect(params.getByRole("textbox").first()).toBeVisible();
    // Подбор решений (шаг 3) тоже есть — уровень «доступные решения».
    await expect(page.locator("#selection").getByRole("heading", { name: /Шаг 3 из 8/ })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
}
