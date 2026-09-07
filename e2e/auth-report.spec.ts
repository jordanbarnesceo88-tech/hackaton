import { test, expect } from "@playwright/test";

test("signup → save analysis → open the report", async ({ page }) => {
  const email = `e2e+${Date.now()}@example.com`;

  await page.goto("/signup");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill("password123");
  const nameField = page.locator('input[name="name"]');
  if (await nameField.count()) await nameField.fill("E2E Tester");
  await page.getByRole("button", { name: "Зарегистрироваться" }).click();
  // signUpAction signs in + redirects to "/", which itself redirects to /onboarding — so a
  // successful signup lands on the onboarding page (proves we're authenticated + off /signup).
  await expect(page).toHaveURL(/\/onboarding/);

  // Reach a calculate page via the flow.
  await page.goto("/compare/warehouse");
  await page.getByRole("link", { name: /Рассчитать/ }).first().click();
  await expect(page).toHaveURL(/\/calculate\//);

  await page.getByRole("button", { name: "Сохранить расчёт" }).click();
  await expect(page.getByText("Сохранено")).toBeVisible();

  const reportLink = page.getByRole("link", { name: "Открыть отчёт" });
  await expect(reportLink).toBeVisible();
  await reportLink.click();

  await expect(page).toHaveURL(/\/report\//);
  await expect(page.getByText(/Отчёт ROI/)).toBeVisible();
  await expect(page.getByText(/не оферта/)).toBeVisible();
});

// The calculator panel and the print report render the same ten figures from one shared
// builder (components/calculator/economics-rows.ts). Nothing asserted that they agree, so a
// drift in either surface — or in the builder — would have shipped silently. This walks the
// numbers across the save boundary and compares them.
test("report figures match the calculator panel exactly", async ({ page }) => {
  const email = `e2e-parity+${Date.now()}@example.com`;

  await page.goto("/signup");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill("password123");
  await page.getByRole("button", { name: "Зарегистрироваться" }).click();
  await expect(page).toHaveURL(/\/onboarding/);

  await page.goto("/compare/warehouse");
  await page.getByRole("link", { name: /Рассчитать/ }).first().click();
  await expect(page).toHaveURL(/\/calculate\//);

  // Read a surface's «label: value» pairs, scoped to the block the heading titles.
  //
  // `xpath=../..` was wrong on one of the two surfaces and silently so. On the panel the
  // heading is a CardTitle inside a CardHeader, so two levels up is the Card. On the report it
  // is an `<h2>` that is a direct child of `<section class="report-block">`, so two levels up
  // is the whole report container — the Map was then built from every «x: y» line on the page
  // (parameters, assumptions, the solution block) and, since it keys by label, quietly kept
  // the *last* value for any label that appears twice. A real drift in a duplicated label
  // could have been masked by a matching line from somewhere else on the page.
  //
  // Climb to the nearest enclosing card or section instead, which is the block in both cases.
  const readRows = async (sectionHeading: string) => {
    const block = page
      .getByRole("heading", { name: sectionHeading, exact: true })
      .locator("xpath=ancestor::*[@data-slot='card' or self::section][1]");
    const text = await block.innerText();
    const rows = new Map<string, string>();
    for (const line of text.split("\n")) {
      const i = line.indexOf(":");
      if (i > 0) rows.set(line.slice(0, i).trim(), line.slice(i + 1).trim());
    }
    return rows;
  };
  // Walk the region path before saving. The panel/report parity assertion below only caught a
  // stale-assumptions bug when something actually made the two diverge, and picking a region and
  // then moving the exchange rate is exactly that: the labour rate is re-derived from a ruble
  // citation, so a surface reading the raw state instead of the derived one silently persists
  // the pre-derivation figure. That shipped once — the report said 4 425 300 ₽ against the
  // 2 267 100 ₽ on screen — with this spec green, because it never touched these two controls.
  await page.locator("#region").selectOption("moscow");
  await page.locator("#usdToRub").fill("110");
  await page.locator("#usdToRub").blur();
  await expect(page.locator("#laborCostPerHourUsd")).not.toHaveValue("15");

  const panel = await readRows("Результаты");
  expect(panel.size).toBeGreaterThan(4);

  await page.locator('input[placeholder*="Название"]').fill("parity");
  await page.getByRole("button", { name: "Сохранить расчёт" }).click();
  await expect(page.getByText("Сохранено")).toBeVisible();
  await page.getByRole("link", { name: "Открыть отчёт" }).click();
  await expect(page).toHaveURL(/\/report\//);

  const report = await readRows("Экономика");

  // Pin the scoping itself. `xpath=../..` climbed to the whole report container here, so the
  // Map was built from every «x: y» line on the page — parameters, assumptions, the solution
  // block — and keyed by label, silently keeping the last of any duplicate. Neither of these
  // labels belongs to the block its heading titles.
  expect(report.has("Персонал (замещаемый)"), "report block leaked a parameters row").toBe(false);
  expect(panel.has("Ставка дисконтирования"), "panel block leaked an assumptions row").toBe(false);

  // Labels shared verbatim by both surfaces must carry identical values.
  for (const label of [
    "Требуется единиц",
    "Замещается персонала (ЭПЗ)",
    "CAPEX",
    "OPEX/год",
    "Базовые затраты на труд/год",
    "Срок окупаемости (простой)",
    "Срок окупаемости (дисконт.)",
  ]) {
    expect(report.get(label), `report vs panel: ${label}`).toBe(panel.get(label));
  }

  // ROI and NPV are the two rows that deliberately differ in wording between the surfaces
  // (the report's grid is tighter), so compare them by their own labels.
  expect(report.get("ROI (простой)")).toBe(panel.get("ROI (простой, без дисконтирования)"));
  expect(report.get("NPV")).toBe(panel.get("NPV (чистая приведённая стоимость)"));
});
