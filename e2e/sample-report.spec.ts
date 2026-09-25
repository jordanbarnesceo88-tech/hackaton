import { mkdirSync } from "node:fs";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";

/**
 * Образец итогового отчёта для сдачи (ТЗ §8.2 — «экспортированный пример итогового отчёта»,
 * §3.7.2–3.7.4 — PDF, Excel/CSV и выгрузка визуализации). Не проверка, а генератор файлов:
 * по умолчанию пропускается и запускается явно —
 *
 *   SAMPLE_REPORT=1 npx playwright test e2e/sample-report.spec.ts
 *
 * Берёт засеянный демо-проект demo-warehouse (тот же расчёт, что у «Нового проекта» на
 * демо-данных организатора, §5.6) и пишет в docs/submission/:
 * sample-report.pdf (печать страницы отчёта в A4), sample-report.xlsx, sample-report.csv и
 * sample-simulation.png (кадр имитации рекомендуемого сценария). Числа в файлах — из сборки, а не
 * набраны руками. Каталог вывода можно переопределить переменной SAMPLE_REPORT_DIR.
 */

test.use({ viewport: { width: 1366, height: 768 } });
test.skip(!process.env.SAMPLE_REPORT, "генератор образца отчёта: запускается с SAMPLE_REPORT=1");

const DEMO_EMAIL = "demo@demo.local";
const DEMO_PASSWORD = process.env.DEMO_USER_PASSWORD ?? "demo-user-2026";
const DEMO_PROJECT = "demo-warehouse";
const OUT_DIR = process.env.SAMPLE_REPORT_DIR ?? path.join(__dirname, "..", "docs", "submission");

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(/\/projects$/);
}

/** Скачать файл по ссылке или кнопке и сохранить под именем `name` в каталоге вывода. */
async function saveDownload(page: Page, trigger: () => Promise<void>, name: string, ext: RegExp) {
  const [download] = await Promise.all([page.waitForEvent("download"), trigger()]);
  expect(download.suggestedFilename()).toMatch(ext);
  await download.saveAs(path.join(OUT_DIR, name));
}

test("образец отчёта демо-проекта: PDF, Excel, CSV и PNG имитации", async ({ page }) => {
  test.setTimeout(120_000);
  mkdirSync(OUT_DIR, { recursive: true });
  await login(page, DEMO_EMAIL, DEMO_PASSWORD);

  // Отчёт для печати — тот же, что пользователь сохраняет в PDF кнопкой печати браузера.
  await page.goto(`/projects/${DEMO_PROJECT}/report`);
  await expect(page.getByText(/предварительной оценкой/).first()).toBeVisible();
  await expect(page.locator("#changes")).toBeAttached();
  await page.pdf({ path: path.join(OUT_DIR, "sample-report.pdf"), format: "A4", printBackground: true });

  await saveDownload(page, () => page.getByRole("link", { name: "Скачать Excel" }).click(), "sample-report.xlsx", /\.xlsx$/);
  await saveDownload(page, () => page.getByRole("link", { name: "Скачать CSV" }).click(), "sample-report.csv", /\.csv$/);

  // Кадр имитации: сценарий, выбранный при открытии (рекомендуемый), итог прогона без анимации.
  await page.goto(`/projects/${DEMO_PROJECT}`);
  const sim = page.locator("#simulation");
  const png = sim.getByRole("button", { name: "Скачать PNG" });
  await expect(png).toBeEnabled({ timeout: 30_000 });
  await saveDownload(page, () => png.click(), "sample-simulation.png", /\.png$/);
});
