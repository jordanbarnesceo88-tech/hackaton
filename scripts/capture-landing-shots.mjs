// Real current server-calculated steady-flow example; never capture bootstrap/loading values.
// Run only after the matching app/worker deploy: node scripts/capture-landing-shots.mjs http://localhost:3085
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3085";
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "landing");
mkdirSync(outDir, { recursive: true });
const SHOTS = [
  { name: "scenarios", step: 6, locator: p => p.locator("#scenarios table").first() },
  { name: "capex", step: 5, tablist: "Сценарий для экономики", locator: p => p.locator("#economics h4", { hasText: "CAPEX по статьям" }).locator("..") },
  { name: "staff", step: 2, locator: p => p.locator("#params section").filter({ has: p.getByRole("heading", { name: "Основные условия расчёта", exact: true }) }) },
  { name: "sensitivity", step: 6, tablist: "Сценарий для анализа чувствительности", locator: p => p.locator("#scenarios figure").last() },
];

const browser = await chromium.launch();
try {
  for (const scheme of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: { width: 1024, height: 900 }, deviceScaleFactor: 2, colorScheme: scheme });
    try {
      await ctx.addInitScript(() => localStorage.setItem("onboarding-tour-seen", "1"));
      const page = await ctx.newPage();
      const receipt = page.waitForResponse(r => r.url().endsWith("/api/v1/demo-calculation") && r.request().method() === "POST", { timeout: 90_000 });
      await page.goto(`${base}/demo?example=steady-flow`, { waitUntil: "domcontentloaded" });
      const actual = await receipt;
      if (actual.status() !== 200) throw new Error(`Actual demo calculation failed: ${actual.status()} ${await actual.text()}`);
      await expect(page.locator("[data-guest-calculation]")).toHaveAttribute("data-guest-calculation", "ready", { timeout: 90_000 });
      await page.addStyleTag({ content: ".sticky { position: static !important; } nextjs-portal, [aria-label='Наверх'] { display:none !important; }" });
      for (const shot of SHOTS) {
        await page.setViewportSize({ width: 1024, height: 900 });
        await page.getByRole("navigation", { name: "Шаги расчёта" }).getByRole("link", { name: new RegExp(`^${shot.step} `) }).click();
        if (shot.tablist) {
          const tab = page.getByRole("tablist", { name: shot.tablist, exact: true }).getByRole("tab", { name: /^Покупка/ });
          await tab.click();
          await expect(tab).toHaveAttribute("aria-selected", "true");
        }
        const el = shot.locator(page);
        await expect(el).toHaveCount(1);
        await expect(el).toBeVisible();
        // Capture the entire table, including the rightmost recommendation and all rows.
        // Expand only screenshot overflow containers; never crop an arbitrary 560px off the result.
        const requiredWidth = await el.evaluate(e => Math.max(e.scrollWidth, ...Array.from(e.querySelectorAll("table")).map(t => t.scrollWidth)));
        if (requiredWidth > 976) await page.setViewportSize({ width: Math.ceil(requiredWidth + 64), height: 900 });
        await el.evaluate(e => {
          for (let ancestor = e.parentElement; ancestor && !ancestor.matches("section"); ancestor = ancestor.parentElement) {
            if (ancestor.classList.contains("data-table-wrap")) { ancestor.style.overflow = "visible"; ancestor.style.maxHeight = "none"; }
          }
        });
        await page.evaluate(() => document.fonts.ready);
        await el.screenshot({ path: path.join(outDir, `${shot.name}-${scheme}.png`), animations: "disabled" });
        console.log(`${shot.name}-${scheme}.png: actual server receipt, complete block`);
      }
    } finally { await ctx.close(); }
  }
} finally { await browser.close(); }
