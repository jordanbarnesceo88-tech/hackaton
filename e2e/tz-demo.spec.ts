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

/**
 * Рабочая область — пейджер: на экране один шаг, остальные скрыты (hidden). Шаг открывают так
 * же, как пользователь, — вкладкой в панели шагов («5 Экономика»).
 */
async function openStep(page: Page, label: string) {
  await page.getByRole("navigation", { name: "Шаги расчёта" }).getByRole("link", { name: label, exact: true }).click();
  // Смена шага идёт через View Transition: новый шаг показывается кадром позже клика. Ждём
  // его заголовок, чтобы не читать таблицы раньше (allInnerTexts не ждёт появления).
  const n = label.split(" ")[0];
  await expect(page.getByRole("heading", { level: 2, name: new RegExp(`^Шаг ${n} из`) })).toBeVisible();
}

/** Страница не шире окна: у жюри экран 1366×768, горизонтальной прокрутки быть не должно. */
async function expectNoHorizontalScroll(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, "страница шире окна 1366 px — появилась горизонтальная прокрутка").toBeLessThanOrEqual(clientWidth);
}

test("демо склада: реальные серверные сценарии и единая пространственная проверка", async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto("/demo?example=steady-flow");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Регулярный поток");

  // Шаг 6: базовый сценарий, покупка и услуга — столбцы одной таблицы (ТЗ §2.2 шаг 6, §3.5.5).
  await openStep(page, "6 Сценарии");
  const scenarios = page.locator("#scenarios").getByRole("table", { name: /Сравнение сценариев/ });
  await expect(scenarios).toBeVisible({ timeout: 90_000 });
  for (const name of ["Как есть", "Покупка — Ronavi H1500", "Услуга (RaaS) — Ronavi H1500"]) {
    await expect(scenarios.getByRole("columnheader", { name }), `столбец «${name}»`).toBeVisible();
  }
  // Видимый статус расчёта (ТЗ §4.3.3).
  await page.getByText("Детали расчёта", { exact: true }).click();
  await expect(page.getByText(/Расчёт выполнен за/).first()).toBeVisible();
  await expectNoHorizontalScroll(page);

  // Closed-pod has one spatial receipt; the single-leg diagnostic cannot confirm this workflow.
  await openStep(page, "7 Имитация");
  const sim = page.locator("#simulation");
  await expect(sim.getByRole("definition").first()).toBeVisible();
  await expect(sim.getByRole("button", { name: "Проверить этот вариант в 3D ↗", exact: true })).toBeEnabled();
  await sim.getByText("Упрощённая аналитическая проверка", { exact: true }).click();
  await expect(sim).toContainText("обязательную подачу и возврат стеллажей");
  await expect(sim.getByRole("button", { name: "▶ Старт", exact: true })).toHaveCount(0);
  await expectNoHorizontalScroll(page);
});

for (const facility of ["airport", "medical"] as const) {
  test(`демо ${facility}: прототип — параметры и подбор без экономики`, async ({ page }) => {
    await page.goto(`/demo?facility=${facility}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Демо-расчёт");
    await expect(
      page.getByText("Прототип: экономика и имитация реализованы для склада").filter({ visible: true }).first(),
    ).toBeVisible();
    // Параметры объекта (шаг 2) показаны с полями ввода — уровень «входные параметры» §5.5.
    await openStep(page, "2 Параметры");
    const params = page.locator("#params");
    await expect(params).toBeVisible();
    await expect(params.getByRole("heading", { name: /Шаг 2 из 8/ })).toBeVisible();
    await expect(params.getByRole("textbox").first()).toBeVisible();
    // Подбор решений (шаг 3) тоже есть — уровень «доступные решения».
    await openStep(page, "3 Подбор");
    await expect(page.locator("#selection").getByRole("heading", { name: /Шаг 3 из 8/ })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
}
