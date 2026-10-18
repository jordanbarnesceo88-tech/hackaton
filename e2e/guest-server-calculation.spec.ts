import { expect, test } from "@playwright/test";
import { fixtureResults } from "../lib/report/tz/test-fixtures";

test("a catalogue choice reaches both submitted scenarios without default-product substitution", async ({ page }) => {
  const submissions: { scenarios: { kind: string; items: { productSlug: string }[] }[] }[] = [];
  await page.route("**/api/v1/demo-calculation", route => {
    submissions.push(route.request().postDataJSON());
    return route.fulfill({ status: 503, json: { error: "Контроль передачи выбранного продукта" } });
  });
  await page.goto("/catalog/moros-amr-1500");
  await page.locator('a[href="/demo?facility=warehouse&product=moros-amr-1500"]').click();
  await expect.poll(() => submissions.length, { timeout: 60_000 }).toBe(1);
  expect(submissions[0]!.scenarios.filter(s => s.kind !== "asis").map(s => ({ kind: s.kind, products: s.items.map(i => i.productSlug) })))
    .toEqual([{ kind: "purchase", products: ["moros-amr-1500"] }, { kind: "raas", products: ["moros-amr-1500"] }]);
  await expect(page.locator("[data-guest-calculation]")).toHaveAttribute("data-guest-calculation", "error");
});

test("a known incompatible product explains the refusal without calculating a default robot", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/v1/demo-calculation", route => { calls++; return route.fulfill({ status: 503, json: { error: "Unexpected fallback calculation" } }); });
  await page.goto("/demo?facility=warehouse&product=dikom-dmr-600");
  await expect(page.getByRole("heading", { name: "Не удалось рассчитать выбранное решение" })).toBeVisible();
  await expect(page.getByText("Другой робот не подставлен.", { exact: false })).toBeVisible();
  await expect(page.locator(".project-workspace")).toHaveCount(0);
  expect(calls).toBe(0);
});

for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
  test(`explicit navigation reveals step content from above and below at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.route("**/api/v1/demo-calculation", route => route.fulfill({ json: { results: fixtureResults(), ms: 1 } }));
    await page.goto("/demo?example=steady-flow");
    await expect(page.locator("[data-guest-calculation]")).toHaveAttribute("data-guest-calculation", "ready");
    const heading = page.locator(".workspace-steps > section:not([hidden]) h2").first();
    const visibleContent = async () => {
      const bounds = await heading.boundingBox();
      return !!bounds && bounds.y >= 0 && bounds.y + bounds.height < viewport.height - 100;
    };
    await expect.poll(visibleContent).toBe(true);
    for (const [step, where] of [[2, "top"], [3, "bottom"]] as const) {
      await page.evaluate(edge => window.scrollTo(0, edge === "top" ? 0 : document.documentElement.scrollHeight), where);
      await page.getByRole("navigation", { name: "Шаги расчёта" }).getByRole("link", { name: new RegExp(`^${step} `) }).click();
      await expect(heading).toContainText(`Шаг ${step} из 8`);
      await expect.poll(visibleContent).toBe(true);
    }
  });
}

test("guest starts a server request and shares its pending/error/retry state across all eight steps", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  await page.route("**/api/v1/demo-calculation", async route => {
    calls++;
    if (calls === 1) await held;
    await route.fulfill({ status: 503, json: { error: "Проверка временно недоступна" } });
  });
  await page.goto("/demo?example=steady-flow");
  await expect.poll(() => calls).toBe(1);
  for (let n = 1; n <= 8; n++) {
    await page.getByRole("navigation", { name: "Шаги расчёта" }).getByRole("link", { name: new RegExp(`^${n} `) }).click();
    await expect(page.locator("[data-guest-calculation]")).toHaveAttribute("data-guest-calculation", "running");
    if (n === 5) await expect(page.locator("[data-economics-pending]")).toBeVisible();
    if (n === 6) {
      await expect(page.locator("[data-comparison-pending]")).toBeVisible();
      await expect(page.locator("#scenarios table")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Сравнить модели: покупка и RaaS", exact: true })).toBeDisabled();
    }
  }
  await expect(page.locator("[data-decision-status]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "CSV", exact: true })).toBeDisabled();
  release();
  await expect(page.locator("[data-guest-calculation]")).toHaveAttribute("data-guest-calculation", "error");
  await expect(page.locator("[data-guest-calculation]")).toContainText("Проверка временно недоступна");
  await page.getByRole("button", { name: "Повторить расчёт", exact: true }).click();
  await expect.poll(() => calls).toBe(2);
  await expect(page.locator("[data-decision-status]")).toHaveCount(0);
});

test("an edited guest draft ignores the previous response and submits the new values explicitly", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const submissions: Record<string, unknown>[] = [];
  await page.route("**/api/v1/demo-calculation", async route => {
    submissions.push(route.request().postDataJSON());
    if (submissions.length === 1) {
      await held;
      const results = fixtureResults(); results.paramsUsed.activeAreaM2 = 9999;
      await route.fulfill({ json: { results, ms: 1 } }).catch(() => {}); // The obsolete request may already be aborted.
    } else await route.fulfill({ status: 503, json: { error: "Контроль нового входа" } });
  });
  await page.goto("/demo?example=steady-flow");
  await expect.poll(() => submissions.length).toBe(1);
  await page.getByRole("navigation", { name: "Шаги расчёта" }).getByRole("link", { name: /^2 / }).click();
  const area = page.locator("#p-activeAreaM2");
  await area.fill("5100"); await area.blur();
  await expect(page.locator("[data-guest-calculation]")).toHaveAttribute("data-guest-calculation", "edited");
  release();
  await expect.poll(async () => Number((await area.inputValue()).replace(/\s/g, ""))).toBe(5100);
  await expect(page.locator("[data-decision-status]")).toHaveCount(0);
  await page.getByRole("button", { name: "Пересчитать", exact: true }).click();
  await expect.poll(() => submissions.length).toBe(2);
  expect((submissions[1]!.params as Record<string, unknown>).activeAreaM2).toBe(5100);
  await expect(page.locator("[data-guest-calculation]")).toHaveAttribute("data-guest-calculation", "error");
  await expect.poll(async () => Number((await area.inputValue()).replace(/\s/g, ""))).toBe(5100);
});

test("a normalized scenario is the submitted draft, so a valid server reply cannot leave the guest running forever", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const submissions: Record<string, unknown>[] = [];
  await page.route("**/api/v1/demo-calculation", async route => {
    const input = route.request().postDataJSON(); submissions.push(input);
    if (submissions.length === 1) { await held; await route.fulfill({ status: 503, json: { error: "Устаревший запрос" } }).catch(() => {}); return; }
    const results = fixtureResults(); results.paramsUsed.avgPalletMassKg = 1600;
    await route.fulfill({ json: { results, ms: 1 } });
  });
  await page.goto("/demo?example=steady-flow");
  await expect.poll(() => submissions.length).toBe(1);
  await page.getByRole("navigation", { name: "Шаги расчёта" }).getByRole("link", { name: /^2 / }).click();
  const mass = page.locator("#p-avgPalletMassKg");
  // The field may belong to the additional-conditions disclosure.
  await mass.evaluate(el => { for (let p = el.parentElement; p; p = p.parentElement) if (p instanceof HTMLDetailsElement) p.open = true; });
  await mass.fill("1600"); await mass.blur(); release();
  await page.getByRole("button", { name: "Пересчитать", exact: true }).click();
  await expect.poll(() => submissions.length).toBe(2);
  const scenarios = submissions[1]!.scenarios as { items: { manuallyAdded?: boolean }[] }[];
  expect(scenarios.some(s => s.items.some(item => item.manuallyAdded))).toBe(true);
  await expect(page.locator("[data-guest-calculation]")).toHaveAttribute("data-guest-calculation", "ready");
});
