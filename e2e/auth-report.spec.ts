import { test, expect } from "@playwright/test";
import { economicsRows, REPORT_LABELS } from "../components/calculator/economics-rows";
import { createOwnedArchive } from "./legacy-support";

test("authenticated legacy entry opens the current project; owned archive is read-only", async ({ page }) => {
  const fixture = await createOwnedArchive(page);
  try {
    await page.goto("/compare/airport?facility=warehouse&ops=999999&staff=999");
    await expect(page).toHaveURL(/\/projects\/new\?legacy=1&facility=airport$/);
    await expect(page.getByRole("heading", { level: 1, name: "Новый проект" })).toBeVisible();
    await expect(page.locator('input[name="facility"][value="airport"]')).toBeChecked();
    await expect(page.getByText(/Старые операции, занятость и денежные параметры не перенесены/)).toBeVisible();
    await page.goto("/analyses");
    await expect(page.getByRole("heading", { name: "Архив расчётов v1" })).toBeVisible();
    await expect(page.locator('a[href*="/calculate/"]')).toHaveCount(0);
    await page.getByRole("link", { name: "Просмотреть архивный отчёт", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/report/${fixture.analysis.id}$`));
    await expect(page.locator("[data-legacy-report]")).toContainText("просмотр без сохранения");
    await expect(page.getByRole("heading", { name: `Отчёт ROI: ${fixture.analysis.name}` })).toBeVisible();
    await expect(page.getByText(/не\s+оферта/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Сохранить расчёт", exact: true })).toHaveCount(0);
    expect(await fixture.db.savedAnalysis.findUniqueOrThrow({ where: { id: fixture.analysis.id } })).toEqual(fixture.analysis);
  } finally { await fixture.cleanup(); }
});

test("archive report preserves manual quantity and all ten current v1 economic rows", async ({ page }) => {
  const fixture = await createOwnedArchive(page);
  try {
    await page.goto(`/calculate/${fixture.solution.id}?analysis=${fixture.analysis.id}&quantityOverride=999&ops=999999`);
    await expect(page).toHaveURL(new RegExp(`/report/${fixture.analysis.id}$`));
    const block = page.getByRole("heading", { name: "Экономика", exact: true }).locator("xpath=ancestor::section[1]");
    const rendered = new Map<string, string>();
    for (const line of (await block.innerText()).split("\n")) {
      const separator = line.indexOf(":");
      if (separator > 0) rendered.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
    }
    const expected = economicsRows(fixture.result, fixture.assumptions.usdToRub, REPORT_LABELS);
    expect(expected).toHaveLength(10);
    for (const row of expected) expect(rendered.get(row.label), row.label).toBe(row.value);
    expect(rendered.has("Персонал (замещаемый)")).toBe(false);
    expect(rendered.has("Ставка дисконтирования")).toBe(false);
    await expect(block).toContainText("количество единиц — 6");
    await expect(page.locator("[data-legacy-report]")).toContainText("не неизменяемый снимок прежних чисел");
    expect(await fixture.db.savedAnalysis.findUniqueOrThrow({ where: { id: fixture.analysis.id } })).toEqual(fixture.analysis);
  } finally { await fixture.cleanup(); }
});
