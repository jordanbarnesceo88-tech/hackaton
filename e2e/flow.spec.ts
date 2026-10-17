import { test, expect } from "@playwright/test";
import { exampleHref } from "../lib/wizard/example-scenario";

test("legacy v1: onboarding → compare → calculate остаётся доступен по прежнему URL", async ({ page }) => {
  // Сохранённые ссылки упрощённой модели продолжают работать. Основные входы сайта
  // ведут в /demo; этот тест проверяет отдельный прежний путь, а не текущий onboarding.
  await page.goto("/onboarding");
  await page.getByRole("radio", { name: /Торговля и e-commerce/ }).click();
  await page.getByRole("link", { name: "Далее" }).click();

  await expect(page).toHaveURL(/\/onboarding\/facility/);
  await page.getByRole("radio", { name: /^А?\s*Склад$/ }).first().click();
  await page.getByRole("link", { name: "Далее" }).click();

  await expect(page).toHaveURL(/\/onboarding\/params/);
  // Поля предзаполнены типовыми значениями — пустые поля здесь хуже приблизительных.
  await expect(page.locator("#opsPerDay")).not.toHaveValue("0");
  await page.getByRole("link", { name: "Дальше: кто чем занят" }).click();

  // Новый шаг: занятость по задачам. Движок считает замещение от неё, поэтому без этого шага
  // решения без норматива отказываются считать (Р-1). Часть полей предзаполнена нормативом со
  // ссылкой, остальные заполняем сами — как это сделал бы владелец объекта.
  await expect(page).toHaveURL(/\/onboarding\/staffing/);
  const staffingFields = page.locator('input[type="number"]');
  for (let i = 0; i < (await staffingFields.count()); i++) {
    const field = staffingFields.nth(i);
    if ((await field.inputValue()) === "") await field.fill("4");
  }
  await page.getByRole("link", { name: "Показать решения" }).click();

  await expect(page).toHaveURL(/\/compare\/warehouse/);
  // Real sourced products + honesty markers.
  await expect(page.getByText("оценка").first()).toBeVisible();
  await expect(page.getByText("открытый источник").first()).toBeVisible();
  await expect(page.getByText(/Hai Robotics|Exotec|AutoStore/).first()).toBeVisible();

  await page.getByRole("link", { name: /Рассчитать/ }).first().click();
  await expect(page).toHaveURL(/\/calculate\//);

  // Hero band + results + sensitivity render.
  // Состояний у героя ТРИ, а не два: «Окупается за» (проходит оба дисконтированных теста),
  // «Простой срок окупаемости» (экономия положительна, но вложения не возвращаются внутри
  // горизонта — герой намеренно не празднует такое) и «Не окупается».
  await expect(
    page.getByText(/Окупается за|Не окупается|Простой срок окупаемости/).first()
  ).toBeVisible();
  await expect(page.getByText("CAPEX").first()).toBeVisible();
  await expect(page.getByText("Чувствительность NPV")).toBeVisible();
});

test("готовый пример ведёт прямо на посчитанные числа, без набора", async ({ page }) => {
  // Готовый пример упрощённой модели — ссылка сразу на посчитанный расчёт, без опроса. С главной
  // его вход убран (2026-09-27), поэтому тест открывает тот же адрес, что строит exampleHref():
  // если пример когда-нибудь приведёт на отказ или на умолчания, это видно здесь.
  await page.goto(exampleHref());

  await expect(page).toHaveURL(/\/compare\/warehouse/);
  // Состояние подбора полное, поэтому колонки с числами обязаны быть на месте.
  await expect(page.getByRole("columnheader", { name: "NPV" }).first()).toBeVisible();
  await expect(page.getByTestId("best-solution")).toBeVisible();
  // И это должен быть реальный вывод, а не «пока нечем считать».
  await expect(page.getByTestId("best-solution")).not.toContainText("Пока нечем считать");
  // Название объекта из примера доезжает — значит показаны числа именно того объекта.
  await expect(page.getByText(/Распределительный центр/).first()).toBeVisible();
});

test("первый экран объясняет продукт и ведёт в расчёт", async ({ page }) => {
  await page.goto("/");
  // Редиректа в опрос нет: открывший ссылку видит, что это за продукт, а не вопрос
  // «в какой вы отрасли?».
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const footer = page.locator("footer");
  await expect(footer.getByRole("link", { name: "Откуда цифры: методика и источники", exact: true }))
    .toHaveAttribute("href", "/methodology/tz");
  await expect(footer.locator('a[href="/methodology"], a[href="/onboarding"]')).toHaveCount(0);

  await page.getByRole("link", { name: "Открыть демо-расчёт склада" }).click();
  await expect(page).toHaveURL(/\/demo/);
});

test("источники v1 сохранены, основной вход ведёт в новый расчёт, прежний подписан отдельно", async ({ page }) => {
  await page.goto("/methodology");
  await expect(page.getByRole("heading", { name: "Откуда цифры" })).toBeVisible();
  // Двадцать две цитаты: по два источника у каждого из семи классов, у трёх складских строк
  // (страница продукта — производительность, цена оценочная без ссылки) и у одной вендорской
  // строки с двумя реальными источниками. Число выведено из тех же модулей, что и сев,
  // поэтому разойтись с данными не может — и растёт по мере пополнения каталога.
  const rows = page.locator("tbody tr");
  await expect(rows).toHaveCount(22);
  await expect(page.getByRole("heading", { name: "Чем мы не даём себе соврать" })).toBeVisible();

  // Общее действие больше не отправляет в прежнюю модель молча.
  const footer = page.locator("footer");
  const current = footer.getByRole("link", { name: "Проверить свой объект →", exact: true });
  const legacy = footer.getByRole("link", { name: "Упрощённый расчёт v1 →", exact: true });
  await expect(current).toHaveAttribute("href", "/demo");
  await expect(legacy).toHaveAttribute("href", "/onboarding");
  await current.click();
  await expect(page).toHaveURL(/\/demo$/);
  await page.goBack();
  await legacy.click();
  await expect(page).toHaveURL(/\/onboarding$/);
});

test("словарь возвращает к текущей методике и новому расчёту", async ({ page }) => {
  await page.goto("/glossary");
  const footer = page.locator("footer");
  await footer.getByRole("link", { name: "Откуда цифры", exact: true }).click();
  await expect(page).toHaveURL(/\/methodology\/tz$/);
  await page.goBack();
  await footer.getByRole("link", { name: "Проверить свой объект →", exact: true }).click();
  await expect(page).toHaveURL(/\/demo$/);
});
