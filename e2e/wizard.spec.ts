import { test, expect } from "@playwright/test";

/**
 * Паритет шага «Решения» и шага «Расчёт».
 *
 * Список решений показывает срок окупаемости и NPV по каждому решению, а страница расчёта —
 * те же величины по выбранному. Это ДВА разных места, считающих одно и то же, и в репозитории
 * уже есть история о том, чем такое кончается: расхождение панели и отчёта однажды ушло
 * клиенту как 4 425 300 ₽ против 2 267 100 ₽ на экране.
 *
 * Сверять надо ДО первой правки допущений: после неё числа расходятся законно.
 */
test("NPV в списке решений совпадает с NPV в расчёте", async ({ page }) => {
  await page.goto("/onboarding");
  await page.getByRole("radio", { name: /Торговля и e-commerce/ }).click();
  await page.getByRole("link", { name: "Далее" }).click();

  await page.getByRole("radio", { name: /Склад$/ }).first().click();
  await page.getByRole("link", { name: "Далее" }).click();

  await expect(page).toHaveURL(/\/onboarding\/params/);
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

  // Колонки окупаемости и NPV появляются только когда параметры собраны — это и есть признак
  // того, что шаг 3 не собирает данные, которые никто не читает.
  await expect(page.getByRole("columnheader", { name: "NPV" }).first()).toBeVisible();

  // Колонку ищем по заголовку, а не по позиции: тест, привязанный к индексу, ломается от
  // любой перестановки колонок — а перестановка их порядка это как раз то, что улучшает
  // продукт, и ронять из-за неё паритет-тест значит наказывать за улучшение.
  const headers = await page.locator("thead th").first().locator("..").locator("th").allInnerTexts();
  const npvIndex = headers.findIndex((h) => h.trim() === "NPV");
  expect(npvIndex, `в заголовке нет колонки NPV: ${headers.join(" | ")}`).toBeGreaterThanOrEqual(0);

  // Берём первую строку, У КОТОРОЙ ЕСТЬ NPV, а не просто первую.
  //
  // Раньше бралась первая, и тест проходил по случайности: при ставке труда $15 окупалось
  // вообще всё, поэтому «первая строка» и «строка с числом» совпадали. На защитимой ставке
  // $6,7 из семи складских решений окупается одно, первая строка первой категории показывает
  // «—», и тест падал на экране расчёта, где никакого NPV, разумеется, нет.
  //
  // Тест проверяет ПАРИТЕТ — что одно и то же число одинаково на двух экранах. Строка без
  // числа для этого не годится ни при какой ставке, и привязка к позиции была ошибкой,
  // которую прикрывали щедрые допущения.
  const rows = page.locator("tbody tr");
  let target = -1;
  for (let i = 0; i < (await rows.count()); i++) {
    const cell = (await rows.nth(i).locator("td").nth(npvIndex).innerText()).trim();
    if (/\d/.test(cell)) { target = i; break; }
  }
  expect(target, "ни одно решение не окупается — паритет проверять не на чем").toBeGreaterThanOrEqual(0);

  const firstRow = rows.nth(target);
  const npvInList = (await firstRow.locator("td").nth(npvIndex).innerText()).trim();
  expect(npvInList).not.toBe("");

  await firstRow.getByRole("link", { name: /Рассчитать/ }).click();
  await expect(page).toHaveURL(/\/calculate\//);

  // Параметры объекта обязаны доехать до расчёта — иначе он стартует с других входов, и
  // совпадение чисел было бы случайным.
  expect(page.url()).toMatch(/ops=/);

  const npvRow = page.getByText(/^NPV \(чистая приведённая стоимость\):/).first();
  const npvInCalc = (await npvRow.innerText()).split(":")[1]!.trim();

  expect(npvInCalc, `список: ${npvInList}, расчёт: ${npvInCalc}`).toBe(npvInList);
});

test("ответ виден без горизонтальной прокрутки", async ({ page }) => {
  await page.goto("/compare/warehouse?industry=retail&facility=warehouse&area=10000&ops=5000&staff=40");

  // Блок лучшего решения отвечает на вопрос до таблицы.
  const best = page.getByTestId("best-solution");
  await expect(best).toBeVisible();
  await expect(best).toContainText(/Окупается за|Не окупается/);

  // И колонка окупаемости попадает в видимую область, а не уезжает за край: подпись
  // обещает сортировку по NPV, и человек должен увидеть то, что ему обещали.
  const header = page.getByRole("columnheader", { name: "Окупаемость" }).first();
  const box = await header.boundingBox();
  const width = page.viewportSize()!.width;
  expect(box, "колонка окупаемости не отрисована").not.toBeNull();
  expect(box!.x + box!.width, "колонка окупаемости уехала за правый край").toBeLessThanOrEqual(width);
});

test("переопределения доезжают до сохранённого отчёта", async ({ page }) => {
  // Свидетель настоящего бага: validateParams собирал объект из перечисленных полей и молча
  // отбрасывал переопределения, поэтому клиент получал документ, где введённые руками
  // количество и цена выглядели вычисленными. Это ровно то, что запрещает спека.
  const email = `ovr+${Date.now()}@example.com`;
  await page.goto("/signup");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill("password123");
  await page.getByRole("button", { name: "Зарегистрироваться" }).click();
  await expect(page).toHaveURL(/\/onboarding/);

  await page.goto("/compare/warehouse?industry=retail&facility=warehouse&area=10000&ops=5000&staff=40");
  await page.getByRole("link", { name: "Разобрать расчёт" }).click();
  await expect(page).toHaveURL(/\/calculate\//);

  const q = page.locator("#quantityOverride");
  await q.scrollIntoViewIfNeeded();
  await q.fill("6");
  await q.blur();
  await expect(page.getByText("задано вами").first()).toBeVisible();

  await page.locator('input[placeholder*="Название"]').fill("переопределения");
  await page.getByRole("button", { name: "Сохранить расчёт" }).click();
  await expect(page.getByText("Сохранено")).toBeVisible();
  await page.getByRole("link", { name: "Открыть отчёт" }).click();
  await expect(page).toHaveURL(/\/report\//);

  await expect(page.getByText(/задана вручную/)).toContainText("количество единиц — 6");
});
