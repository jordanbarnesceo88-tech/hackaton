// Снимки экранов демо-расчёта для главной (public/landing/*): светлая и тёмная тема.
//
// Запуск — против работающего приложения с засеянной базой:
//   node scripts/capture-landing-shots.mjs http://localhost:3000
// Снимки — настоящие экраны /demo, поэтому их стоит переснимать после заметных изменений
// интерфейса или демо-данных. Размер: вёрстка 1024px (на главной снимок уменьшается примерно
// вдвое — при более широкой вёрстке текст на нём становился нечитаемым), плотность 2x,
// обрезка по блоку.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "landing");
mkdirSync(outDir, { recursive: true });

/** Что снимать: шаг демо-расчёта, блок на нём и высота обрезки (CSS px). */
const SHOTS = [
  // Главный экран: сценарии рядом — «как есть», покупка, услуга; рекомендованный отмечен.
  { name: "scenarios", step: "scenarios", locator: (p) => p.locator("#scenarios table").first(), maxHeight: 620 },
  // «Цены с потолка?» — статьи CAPEX с формулой и происхождением каждой цены.
  {
    name: "capex",
    step: "economics",
    locator: (p) => p.locator("#economics h4", { hasText: "CAPEX по статьям" }).locator(".."),
    maxHeight: 560,
  },
  // «Почему столько людей?» — численность вводится по задачам.
  {
    name: "staff",
    step: "params",
    locator: (p) => p.locator("#params details").filter({ has: p.getByRole("heading", { name: "Персонал" }) }),
    maxHeight: 560,
  },
  // «А если ставка другая?» — диаграмма чувствительности.
  { name: "sensitivity", step: "scenarios", locator: (p) => p.locator("#scenarios figure").last(), maxHeight: 560 },
];

const browser = await chromium.launch();
for (const scheme of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 900 }, deviceScaleFactor: 2, colorScheme: scheme });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("onboarding-tour-seen", "1");
    } catch {}
  });
  const page = await ctx.newPage();
  for (const s of SHOTS) {
    await page.goto(`${base}/demo#${s.step}`, { waitUntil: "networkidle" });
    // Липкие панели (шаги, пересчёт) при прокрутке к блоку ложатся поверх его верха; значок
    // dev-сервера Next в угол снимка тоже не нужен.
    await page.addStyleTag({ content: ".sticky { position: static !important; } nextjs-portal, [aria-label=\"Наверх\"] { display: none !important; }" });
    await page.waitForTimeout(1200);
    const el = s.locator(page);
    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const box = await el.boundingBox();
    if (!box) throw new Error(`не найден блок для «${s.name}»`);
    const file = path.join(outDir, `${s.name}-${scheme}.png`);
    await page.screenshot({
      path: file,
      clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, s.maxHeight) },
    });
    console.log(file);
  }
  await ctx.close();
}
await browser.close();
