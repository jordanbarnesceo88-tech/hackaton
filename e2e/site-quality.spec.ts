import { test, expect, type Locator, type Page, type TestInfo } from "@playwright/test";
import { writeFile } from "node:fs/promises";

/** Sheet №46: public UI quality, not a certification of model capacity or physical safety. */
const VIEWPORTS = [
  { name: "desktop-1366x768", width: 1366, height: 768, theme: "dark" },
  { name: "desktop-1920x1080", width: 1920, height: 1080, theme: "light" },
  { name: "mobile-390x844", width: 390, height: 844, theme: "light" },
] as const;
const STEPS = ["object", "params", "selection", "comparison", "economics", "scenarios", "simulation", "report"] as const;

async function readable(locator: Locator, minFontPx = 12) {
  await expect(locator).toBeVisible();
  const metrics = await locator.evaluate(el => {
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return { text: el.textContent?.trim(), fontPx: parseFloat(s.fontSize), opacity: Number(s.opacity), width: r.width, height: r.height };
  });
  expect(metrics.fontPx, `Unreadable text size: ${metrics.text}`).toBeGreaterThanOrEqual(minFontPx);
  expect(metrics.opacity).toBeGreaterThan(0);
  expect(metrics.width).toBeGreaterThan(0);
  expect(metrics.height).toBeGreaterThan(0);
  return metrics;
}

async function pageQuality(page: Page, heading: Locator) {
  const headingMetrics = await readable(heading, 16);
  await expect(heading).toBeInViewport();
  const geometry = await page.evaluate(() => ({
    viewport: { width: innerWidth, height: innerHeight },
    root: { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth },
    body: { scrollWidth: document.body.scrollWidth, clientWidth: document.body.clientWidth },
  }));
  expect(geometry.root.scrollWidth, "Global document horizontal overflow").toBeLessThanOrEqual(geometry.root.clientWidth);
  expect(geometry.body.scrollWidth, "Global body horizontal overflow").toBeLessThanOrEqual(geometry.root.clientWidth);
  // Local table/tab scroll containers are allowed; an obscured active content heading is not.
  const headingPosition = await heading.evaluate(el => {
    const r = el.getBoundingClientRect(), x = Math.max(0, Math.min(innerWidth - 1, r.left + r.width / 2));
    const y = Math.max(0, Math.min(innerHeight - 1, r.top + r.height / 2)), top = document.elementFromPoint(x, y);
    return { top: r.top, bottom: r.bottom, obscured: !top || !el.contains(top) };
  });
  expect(headingPosition.obscured, "Active heading is covered by a sticky header/overlay").toBe(false);
  return { headingMetrics, headingPosition, ...geometry };
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready);
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, animations: "disabled" });
  await testInfo.attach(name, { path, contentType: "image/png" });
  return path;
}

async function comparisonCellGeometry(section: Locator) {
  const cells = await section.locator("td").evaluateAll(elements => elements.flatMap(el => {
    const box = el.getBoundingClientRect();
    if (!box.width || !box.height || box.right <= 0 || box.left >= innerWidth || box.bottom <= 0 || box.top >= innerHeight) return [];
    // Only the actual direct value, never the visually hidden “best in row” annotation.
    const text = Array.from(el.childNodes).find(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
    if (!text?.textContent) return [];
    const value = text.textContent, range = document.createRange();
    range.setStart(text, value.length - value.trimStart().length);
    range.setEnd(text, value.trimEnd().length);
    // A Range includes every line of a wrapped colspan placeholder without assuming one line.
    const bounds = range.getBoundingClientRect();
    return [{ value: value.trim(), leftInsetPx: bounds.left - box.left, rightInsetPx: box.right - bounds.right,
      cell: { left: box.left, right: box.right, top: box.top, bottom: box.bottom },
      text: { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom } }];
  }));
  expect(cells.length, "Comparison has no visible value cells to inspect").toBeGreaterThan(0);
  for (const cell of cells) {
    expect(cell.leftInsetPx, `Comparison value '${cell.value}' touches/overflows its left cell edge: ${JSON.stringify(cell)}`).toBeGreaterThanOrEqual(7.75);
    expect(cell.rightInsetPx, `Comparison value '${cell.value}' touches/overflows its right cell edge: ${JSON.stringify(cell)}`).toBeGreaterThanOrEqual(7.75);
  }
  return cells;
}

for (const viewport of VIEWPORTS) {
  test(`site quality · ${viewport.name} · public pages and eight-step demo`, async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: viewport.theme });
    await page.addInitScript(theme => {
      localStorage.setItem("onboarding-tour-seen", "1");
      localStorage.setItem("theme", theme);
    }, viewport.theme);
    const errors: { kind: string; url: string; text: string }[] = [];
    const warnings: string[] = [];
    const requests: { url: string; method: string }[] = [];
    const views: object[] = [];
    const facts: Record<string, unknown> = { viewport, views, errors, warnings, demoRequests: requests };
    page.on("pageerror", error => errors.push({ kind: "pageerror", url: page.url(), text: error.message }));
    page.on("console", message => {
      if (message.type() === "error") errors.push({ kind: "console", url: page.url(), text: message.text() });
      if (message.type() === "warning") warnings.push(message.text());
    });
    page.on("request", request => {
      if (new URL(request.url()).pathname === "/api/v1/demo-calculation" && request.method() === "POST") requests.push({ url: request.url(), method: request.method() });
    });
    try {
      for (const route of [
        { path: "/", heading: "Подбор роботов от тех, кто уже запускал их на других объектах", name: "home" },
        { path: "/catalog", heading: "Каталог роботизированных решений", name: "catalog" },
        { path: "/methodology", heading: "Откуда цифры", name: "methodology" },
      ]) {
        const response = await page.goto(route.path, { waitUntil: "domcontentloaded" });
        expect(response?.status(), route.path).toBe(200);
        const heading = page.getByRole("heading", { level: 1, name: route.heading, exact: true });
        const quality = await pageQuality(page, heading);
        if (route.name === "home") {
          const workflow = page.getByRole("list", { name: "Как работает платформа", exact: true });
          await expect(workflow).toBeVisible();
          await expect(workflow.getByRole("listitem")).toHaveCount(4);
          await expect(workflow.getByRole("heading", { level: 3 })).toHaveText(["Объект", "Экономика", "Проверка потока", "План пилота"]);
          for (const heading of await workflow.getByRole("heading", { level: 3 }).all()) await readable(heading, 14);
          const primary = page.getByRole("link", { name: "Открыть демо-расчёт склада", exact: true });
          await readable(primary);
          await expect(primary).toHaveAttribute("href", "/demo?example=steady-flow");
        } else if (route.name === "catalog") {
          await readable(page.getByRole("search", { name: "Фильтры каталога" }).getByLabel("Поиск", { exact: true }));
          await expect(page.getByRole("link", { name: /Ronavi H1500/i }).first()).toBeVisible();
        } else {
          await expect(page.getByRole("link", { name: /методик/i }).filter({ hasText: /ТЗ|текущ/i }).first()).toHaveAttribute("href", "/methodology/tz");
        }
        views.push({ route: route.path, ...quality, screenshot: await capture(page, testInfo, route.name) });
        expect(errors).toEqual([]);
      }

      // Observe the actual POST before navigation; no interception or fabricated ready state.
      const completed = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/demo-calculation" && response.request().method() === "POST", { timeout: 120_000 });
      expect((await page.goto("/demo", { waitUntil: "domcontentloaded" }))?.status()).toBe(200);
      const receipt = await completed;
      expect(receipt.status(), await receipt.text()).toBe(200);
      const payload = await receipt.json();
      expect(Array.isArray(payload.results?.scenarios)).toBe(true);
      expect(payload.results.scenarios.length).toBeGreaterThan(0);
      facts.serverReceipt = { status: receipt.status(), ms: payload.ms, scenarios: payload.results.scenarios.map((s: { key: string }) => s.key) };
      await expect(page.locator("[data-server-calculation]")).toHaveAttribute("data-server-calculation", "ready", { timeout: 120_000 });
      const nav = page.getByRole("navigation", { name: "Шаги расчёта" });
      for (const [index, id] of STEPS.entries()) {
        const n = index + 1;
        await nav.getByRole("link", { name: new RegExp(`^${n} `) }).click();
        const section = page.locator(`#${id}`), heading = section.getByRole("heading", { level: 2, name: new RegExp(`^Шаг ${n} из 8`) });
        await expect(section).toBeVisible();
        await expect(nav.getByRole("link", { name: new RegExp(`^${n} `) })).toHaveAttribute("aria-current", "step");
        const quality = await pageQuality(page, heading);
        expect((await section.innerText()).trim().length).toBeGreaterThan(40);
        if (n === 2) await readable(section.locator("#p-forkliftSalaryRubMonth"));
        if (n === 4) {
          await expect(section.getByRole("table").first()).toBeVisible();
          facts.comparisonCellGeometry = await comparisonCellGeometry(section);
        }
        if (n === 5) await expect(section.getByText(/CAPEX/).first()).toBeVisible();
        if (n === 6) await expect(section.getByRole("table", { name: /Сравнение сценариев/ })).toBeVisible();
        if (n === 7) await expect(section.locator("[data-validation-kind]").first()).toBeVisible();
        if (n === 8) {
          await expect(section.locator("[data-decision-pending]")).toHaveCount(0);
          await readable(section.getByRole("button", { name: "Войти, чтобы сохранить проект", exact: true }));
        }
        views.push({ route: "/demo", step: n, ...quality, screenshot: await capture(page, testInfo, `demo-step-${n}`) });
        expect(requests, "Step navigation must reuse one actual server calculation").toHaveLength(1);
        expect(errors).toEqual([]);
      }
      // Editing is retained by navigation and is honestly marked uncalculated; do not auto-run each step.
      await nav.getByRole("link", { name: /^2 / }).click();
      const salary = page.locator("#p-forkliftSalaryRubMonth");
      await salary.fill("123456");
      await nav.getByRole("link", { name: /^8 / }).click();
      await expect(page.locator("[data-server-calculation]")).toHaveAttribute("data-server-calculation", "edited");
      await expect(page.locator("[data-decision-pending]")).toBeVisible();
      await nav.getByRole("link", { name: /^2 / }).click();
      await expect.poll(async () => Number((await salary.inputValue()).replace(/\s/g, ""))).toBe(123456);
      expect(requests).toHaveLength(1);
      expect(errors).toEqual([]);
      facts.editNavigation = { salary: await salary.inputValue(), status: await page.locator("[data-server-calculation]").getAttribute("data-server-calculation"), posts: requests.length };
      facts.passed = true;
    } catch (error) {
      facts.failure = error instanceof Error ? error.message : String(error);
      if (!page.isClosed()) {
        try { facts.failureScreenshot = await capture(page, testInfo, "failure"); }
        catch (screenshotError) { facts.failureScreenshotError = String(screenshotError); }
      }
      throw error;
    } finally {
      const path = testInfo.outputPath("quality-facts.json");
      await writeFile(path, JSON.stringify(facts, null, 2));
      await testInfo.attach("site-quality-facts", { path, contentType: "application/json" });
    }
  });
}
