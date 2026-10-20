import { test, expect } from "@playwright/test";
import { exampleHref } from "../lib/wizard/example-scenario";
import { navigationOnly, openStep } from "./legacy-support";

test("retired guest wizard entries open the current eight-step workflow", async ({ page }) => {
  await navigationOnly(page);
  for (const path of ["/onboarding", "/onboarding/facility", "/onboarding/params", "/onboarding/staffing", "/compare/warehouse", "/calculate/retired-solution"]) {
    await page.goto(path + "?facility=warehouse&ops=999999&staff=999&quantityOverride=999");
    await expect(page).toHaveURL(/\/demo\?legacy=1&facility=warehouse$/);
    await expect(page.getByText(/Старые операции, занятость и денежные параметры не перенесены/)).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Шаги расчёта" }).getByRole("link")).toHaveCount(8);
    await expect(page.locator("#opsPerDay, #quantityOverride")).toHaveCount(0);
  }
  await openStep(page, 2);
  await expect(page.locator("#p-activeAreaM2")).not.toHaveValue("0");
  await openStep(page, 3);
  await expect(page.locator("#selection")).toBeVisible();
});

test("old example link transfers facility only and discloses discarded v1 values", async ({ page }) => {
  await navigationOnly(page);
  await page.goto(exampleHref());
  await expect(page).toHaveURL(/\/demo\?legacy=1&facility=warehouse$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Демо-расчёт");
  await expect(page.getByText(/Старые операции, занятость и денежные параметры не перенесены/)).toBeVisible();
  expect(new URL(page.url()).searchParams.has("ops")).toBe(false);
  expect(new URL(page.url()).searchParams.has("objectName")).toBe(false);
  await expect(page.getByTestId("best-solution")).toHaveCount(0);
});

test("first screen explains the product and links to the current calculation", async ({ page }) => {
  await navigationOnly(page);
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const footer = page.locator("footer");
  await expect(footer.getByRole("link", { name: "Откуда цифры: методика и источники", exact: true })).toHaveAttribute("href", "/methodology/tz");
  await expect(footer.locator('a[href="/methodology"], a[href="/onboarding"]')).toHaveCount(0);
  await page.getByRole("banner").getByRole("button", { name: "Демо", exact: true }).click();
  await page.getByRole("menuitem", { name: "Открыть демо-расчёт склада" }).click();
  await expect(page).toHaveURL(/\/demo/);
});

test("v1 sources remain available while both methodology actions use the current model", async ({ page }) => {
  await navigationOnly(page);
  await page.goto("/methodology");
  await expect(page.getByRole("heading", { name: "Откуда цифры", exact: true })).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(22);
  await expect(page.getByRole("heading", { name: "Чем мы не даём себе соврать" })).toBeVisible();
  const footer = page.locator("footer");
  const current = footer.getByRole("link", { name: "Проверить свой объект →", exact: true });
  await expect(current).toHaveAttribute("href", "/demo");
  await expect(footer.getByRole("link", { name: "Создать проект с текущей моделью →", exact: true })).toHaveAttribute("href", "/projects/new");
  await expect(footer.locator('a[href="/onboarding"], a[href^="/compare/"], a[href^="/calculate/"]')).toHaveCount(0);
  await current.click();
  await expect(page).toHaveURL(/\/demo$/);
});

test("glossary returns to the current methodology and calculation", async ({ page }) => {
  await navigationOnly(page);
  await page.goto("/glossary");
  const footer = page.locator("footer");
  await footer.getByRole("link", { name: "Откуда цифры", exact: true }).click();
  await expect(page).toHaveURL(/\/methodology\/tz$/);
  await page.goBack();
  await footer.getByRole("link", { name: "Проверить свой объект →", exact: true }).click();
  await expect(page).toHaveURL(/\/demo$/);
});
