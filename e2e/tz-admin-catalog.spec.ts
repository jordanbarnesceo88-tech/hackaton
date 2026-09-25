import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import { normDef } from "../lib/tz/norms";

/**
 * Каталог и роли (ТЗ §3.1.1 — гость, пользователь, администратор; §3.1.2 — гость видит каталог;
 * §3.3 — иерархия, провенанс характеристик; §3.1.4 — администратор управляет нормативами).
 * Экран жюри — 1366×768 (ТЗ §4.5.5).
 *
 * Правка норматива администратором меняет живые данные для всех новых расчётов, поэтому тест
 * обязательно возвращает его к значению по умолчанию — кнопкой в админке, а если прогон
 * оборвался до неё, то напрямую в базе (см. restoreUtilization).
 */

test.use({ viewport: { width: 1366, height: 768 } });

const ADMIN_EMAIL = "admin@demo.local";
const ADMIN_PASSWORD = process.env.DEMO_ADMIN_PASSWORD ?? "demo-admin-2026";

/** Норматив, который правит тест, и значение правки (в пределах 0,70–0,85 организатора). */
const NORM_KEY = "utilization";
const NORM_EDIT = 0.8;

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(/\/projects$/);
}

async function expectNoHorizontalScroll(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, "страница шире окна 1366 px — появилась горизонтальная прокрутка").toBeLessThanOrEqual(clientWidth);
}

/**
 * Страховка на случай оборванного прогона: если в базе осталась именно правка этого теста
 * (значение NORM_EDIT с отметкой администратора), вернуть значение по умолчанию из кода. Любое
 * другое состояние норматива не трогается.
 */
async function restoreUtilization() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    const def = normDef(NORM_KEY);
    const { count } = await prisma.norm.updateMany({
      where: { key: NORM_KEY, value: NORM_EDIT, editedByAdmin: true },
      data: { value: def.value, editedByAdmin: false },
    });
    if (count > 0) console.warn(`[tz-admin-catalog] норматив ${NORM_KEY} возвращён к ${def.value} напрямую в базе`);
  } finally {
    await prisma.$disconnect();
  }
}

test("гость: каталог по процессу и карточка продукта с качеством данных и источниками", async ({ page }) => {
  await page.goto("/catalog?facility=warehouse&process=pallet-transport");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Каталог");
  const product = page.getByRole("rowheader").getByRole("link", { name: /H1500/ }).first();
  await expect(product).toBeVisible();
  await expectNoHorizontalScroll(page);

  await product.click();
  await expect(page).toHaveURL(/\/catalog\/[^/?#]+$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("H1500");
  await expect(page.getByRole("heading", { name: "Качество данных" })).toBeVisible();
  // Бейдж происхождения значения (ТЗ §3.3.4): данные каталога организатора.
  await expect(page.getByText("Организатор", { exact: true }).filter({ visible: true }).first()).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test("гость: админка закрыта — переход на вход", async ({ page }) => {
  // requireAdmin() отправляет гостя на /login, а вошедшему без роли ADMIN отвечает 404.
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Вход");
});

test("администратор: правка норматива и сброс к умолчанию", async ({ page }) => {
  test.setTimeout(90_000);
  const def = normDef(NORM_KEY);
  let restored = false;
  try {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto("/admin/norms");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Нормативы расчёта");
    await expectNoHorizontalScroll(page);

    const input = page.locator(`#norm-${NORM_KEY}`);
    const row = page.getByRole("listitem").filter({ has: input });
    await expect(input).toBeVisible();

    await input.fill(String(NORM_EDIT));
    await row.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(row.getByText(/^Записано:/)).toBeVisible({ timeout: 30_000 });
    await expect(row.getByText("правка администратора")).toBeVisible();
    await expect(input).toHaveValue(/^0[,.]8$/);

    await row.getByRole("button", { name: "Сбросить к умолчанию" }).click();
    await expect(row.getByText(/^Сброшено к умолчанию/)).toBeVisible({ timeout: 30_000 });
    restored = true;
    await expect(row.getByText("правка администратора")).toHaveCount(0);
    await expect(input).toHaveValue(String(def.value).replace(".", ","));
  } finally {
    if (!restored) await restoreUtilization();
  }
});

test("пользователь без роли администратора: админка отвечает 404", async ({ page }) => {
  const email = `e2e+tz-${Date.now()}@example.com`;
  await page.goto("/signup");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill("password123");
  await page.getByRole("button", { name: "Зарегистрироваться" }).click();
  await expect(page).not.toHaveURL(/\/signup/);

  const response = await page.goto("/admin");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Страница не найдена");
  await expect(page.getByRole("link", { name: "Админка" })).toHaveCount(0);
});
