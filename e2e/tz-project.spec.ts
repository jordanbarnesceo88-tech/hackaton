import { test, expect, type Page } from "@playwright/test";

/**
 * Путь жюри по ТЗ §5.4 на демо-аккаунте: создать проект → подбор → ручная корректировка →
 * пересчёт → сохранение → повторное открытие воспроизводит те же числа (§3.1.5) → выгрузка
 * Excel → отчёт с оговоркой и журналом корректировок (§3.5.4, §3.7) → копия и удаление
 * проекта (§3.1.3). Экран жюри — 1366×768 (ТЗ §4.5.5).
 *
 * Проекты называются `e2e-tz-…`: если прогон оборвётся до удаления, их (и копии) уберёт
 * e2e/global-teardown.ts. Демо-проект demo-warehouse тест не трогает.
 */

test.use({ viewport: { width: 1366, height: 768 } });

const DEMO_EMAIL = "demo@demo.local";
const DEMO_PASSWORD = process.env.DEMO_USER_PASSWORD ?? "demo-user-2026";

/** Сценарий, который тест корректирует и чей NPV сверяет до и после перезагрузки. */
const PURCHASE = "Покупка — Ronavi H1500";

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(/\/projects$/);
}

/** Таблица сценариев шага 6 (подпись таблицы — её доступное имя). */
function scenarioTable(page: Page) {
  return page.locator("#scenarios").getByRole("table", { name: /Сравнение сценариев/ });
}

/** Текст ячейки таблицы сценариев: столбец — по названию сценария, строка — по подписи показателя. */
async function scenarioCell(page: Page, scenario: string, row: string): Promise<string> {
  const table = scenarioTable(page);
  const heads = (await table.locator("thead th").allInnerTexts()).map((h) => h.trim());
  const col = heads.findIndex((h) => h.includes(scenario));
  expect(col, `нет столбца «${scenario}» среди: ${heads.join(" | ")}`).toBeGreaterThan(0);
  const tr = table.locator("tbody tr").filter({ has: page.getByRole("rowheader", { name: row, exact: true }) });
  // Первая ячейка строки — заголовок показателя (th), столбцы сценариев — td по порядку.
  return (await tr.locator("td").nth(col - 1).innerText()).trim();
}

async function expectNoHorizontalScroll(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, "страница шире окна 1366 px — появилась горизонтальная прокрутка").toBeLessThanOrEqual(clientWidth);
}

test("проект склада: создать, скорректировать, сохранить, открыть заново, выгрузить, скопировать и удалить", async ({
  page,
}) => {
  // Создание и сохранение считают модель и имитацию на сервере — по нескольку секунд каждое.
  test.setTimeout(240_000);
  // «Удалить проект» спрашивает подтверждение (window.confirm) — соглашаемся.
  page.on("dialog", (d) => void d.accept());

  await login(page, DEMO_EMAIL, DEMO_PASSWORD);

  // 1. Новый проект на демо-данных организатора (ТЗ §5.4 «создать проект»).
  const name = `e2e-tz-${Date.now()}`;
  await page.getByRole("main").getByRole("link", { name: "Новый проект" }).click();
  await expect(page).toHaveURL(/\/projects\/new$/);
  await page.getByLabel("Название проекта").fill(name);
  await page.getByRole("radio", { name: /^Склад/ }).check();
  await page.getByRole("radio", { name: /Демо-данные организатора/ }).check();
  await page.getByRole("button", { name: "Создать проект" }).click();
  await expect(page).toHaveURL(/\/projects\/(?!new$)[^/?#]+$/, { timeout: 60_000 });
  const projectUrl = page.url();
  await expect(page.locator("#object")).toContainText(name);
  await expect(page.getByText(/Расчёт выполнен за/).first()).toBeVisible();

  // 2. Подбор объясняет исключение числами (ТЗ §3.4.3).
  await expect(page.locator("#selection")).toContainText("600 кг < масса груза 800 кг");

  // 3. Ручная корректировка авто-значения (ТЗ §3.5.4): число роботов покупки H1500.
  const economics = page.locator("#economics");
  await economics.getByRole("tablist", { name: "Сценарий для экономики" }).getByRole("tab", { name: PURCHASE }).click();
  await expect(economics.getByRole("heading", { name: PURCHASE, exact: true })).toBeVisible();
  const autoFleet = await scenarioCell(page, PURCHASE, "Состав оборудования");
  const autoN = Number(/(\d+)\s+робот/.exec(autoFleet)?.[1]);
  expect(autoN, `в составе оборудования нет числа роботов: «${autoFleet}»`).toBeGreaterThan(0);
  const manualN = autoN + 1;
  // «12 роботов», «2 робота» — число с любым падежом слова.
  const manualFleet = new RegExp(`(^|\\D)${manualN}\\s+робот`);
  const qty = economics.getByLabel("Количество роботов", { exact: true });
  await qty.fill(String(manualN));
  await qty.press("Enter");
  await expect(economics.getByText("задано вами").first()).toBeVisible();
  await page.getByRole("button", { name: "Пересчитать", exact: true }).click();
  await expect.poll(() => scenarioCell(page, PURCHASE, "Состав оборудования")).toMatch(manualFleet);

  // 4. Сохранение: сервер пересчитывает модель и имитацию сам.
  await page.getByRole("button", { name: "Сохранить проект" }).click();
  await expect(page.getByText(/^Проект сохранён/)).toBeVisible({ timeout: 90_000 });
  const npvBefore = await scenarioCell(page, PURCHASE, "NPV");
  expect(npvBefore).toMatch(/\d/);
  await expectNoHorizontalScroll(page);

  // 5. Повторное открытие воспроизводит расчёт по снимку (ТЗ §3.1.5).
  await page.reload();
  await expect(scenarioTable(page)).toBeVisible();
  expect(await scenarioCell(page, PURCHASE, "NPV"), "NPV после перезагрузки").toBe(npvBefore);
  expect(await scenarioCell(page, PURCHASE, "Состав оборудования")).toMatch(manualFleet);

  // 6. Excel по сохранённому расчёту (ТЗ §3.7.3).
  const report = page.locator("#report");
  const [xlsx] = await Promise.all([
    page.waitForEvent("download"),
    report.getByRole("link", { name: "Excel", exact: true }).click(),
  ]);
  expect(xlsx.suggestedFilename()).toMatch(/\.xlsx$/);

  // 7. Отчёт для печати в PDF: оговорка и журнал корректировок с правкой числа роботов.
  await report.getByRole("link", { name: "Отчёт (PDF)" }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/report$/);
  await expect(page.getByText(/предварительной оценкой/).first()).toBeVisible();
  const changes = page.locator("#changes");
  await expect(changes.getByRole("heading", { name: "Журнал корректировок" })).toBeVisible();
  await expect(changes).toContainText("Количество роботов");
  await expectNoHorizontalScroll(page);

  // 8. Копия проекта (ТЗ §3.1.3) открывается сразу после копирования.
  await page.goto(projectUrl);
  await page.locator("#report").getByRole("button", { name: "Копировать проект" }).click();
  await expect(page).not.toHaveURL(projectUrl, { timeout: 30_000 });
  await expect(page).toHaveURL(/\/projects\/(?!new$)[^/?#]+$/);
  await expect(page.locator("#object")).toContainText(`${name} (копия)`);

  // 9. Удаление копии и исходного проекта (подтверждение принимается).
  await page.locator("#report").getByRole("button", { name: "Удалить проект" }).click();
  await expect(page).toHaveURL(/\/projects$/, { timeout: 30_000 });
  await page.goto(projectUrl);
  await page.locator("#report").getByRole("button", { name: "Удалить проект" }).click();
  await expect(page).toHaveURL(/\/projects$/, { timeout: 30_000 });
  await expect(page.getByRole("main")).not.toContainText(name);
});
