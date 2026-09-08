# План: ответ на первом месте, раскрытие по месту, первый экран, справочник

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Сделать так, чтобы судья, открывший ссылку без автора, за тридцать секунд понял
обещание, за две минуты получил ответ под свои параметры и на каждое сомнение нашёл ответ там
же, где сомнение возникло.

**Architecture:** Ни одно выходное число не меняется — меняется порядок, форма показа и
доступность объяснений. Реестр объяснений типизируется по уже существующим ключам
`economics-rows.ts`, поэтому пропущенный показатель ловит компилятор.

**Tech Stack:** Next 16 App Router, React 19, Tailwind v4, инлайновый SVG (без библиотек).

**Spec:** `docs/superpowers/specs/2026-09-08-competition-readiness-design.md`

## Global Constraints

- **Ни одно выходное число не меняется.** Арифметика в `lib/economics/**` и `lib/scene/**` не
  правится вообще. Задача 3 добавляет в `lib/economics/` **новый** файл `explanations.ts` —
  это текст, а не расчёт; сужение ключа с `string` до union происходит в
  `components/calculator/economics-rows.ts`, вне движка. Правка существующего теста в этих
  папках — сигнал остановиться и доложить.
- **Раздел D (ручной ввод количества и CAPEX) в этот план не входит** — отдельная спека,
  отдельная подпись.
- **Никаких библиотек графиков.** Торнадо — инлайновый SVG: одна зависимость ради одной
  диаграммы не окупается, а CSP разрешает не всякий CDN.
- **Цвета — только из токенов темы.** Палитра `--chart-1..5` валидирована; хардкод цвета в
  SVG сломает тёмную тему и печать.
- **Печать светлая, отчёт на A4.** Любая новая поверхность проверяется в `@media print`.
- **Ветка `wizard-taxonomy`**, один коммит на задачу, хвост
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Vitest — `npx --yes vitest run < /dev/null`; перед e2e убивать сервер на :3000.**

---

## Структура файлов

| Файл | Ответственность |
|---|---|
| `components/calculator/economics-rows.ts` | изменение: ключи становятся union-типом |
| `lib/economics/explanations.ts` | создание: реестр объяснений по ключам |
| `lib/economics/explanations.test.ts` | создание: полнота и осмысленность реестра |
| `components/ui/disclosure.tsx` | создание: маркер + раскрываемый блок |
| `components/calculator/best-solution.tsx` | создание: блок лучшего решения |
| `components/calculator/tornado-chart.tsx` | создание: торнадо на инлайновом SVG |
| `app/(wizard)/compare/[type]/page.tsx` | изменение: порядок колонок, блок лучшего |
| `app/page.tsx` | изменение: первый экран вместо редиректа |
| `app/methodology/page.tsx` | создание: справочник |
| `lib/sources/registry.ts` | создание: источники, собранные из модулей сева |

---

### Задача 1: Ответ на первом месте — порядок колонок и блок лучшего решения

**Files:**
- Create: `components/calculator/best-solution.tsx`
- Modify: `app/(wizard)/compare/[type]/page.tsx`
- Modify: `e2e/wizard.spec.ts`

**Interfaces:**
- Produces: `<BestSolution solutions={…} params={…} assumptions={…} facilityType={…} />`.

- [ ] **Шаг 1: Написать падающий тест**

В `e2e/wizard.spec.ts` добавить:

```ts
test("ответ виден без горизонтальной прокрутки", async ({ page }) => {
  await page.goto("/compare/warehouse?industry=retail&facility=warehouse&area=10000&ops=5000&staff=40");

  // Блок лучшего решения отвечает на вопрос до таблицы.
  const best = page.getByTestId("best-solution");
  await expect(best).toBeVisible();
  await expect(best).toContainText(/Окупается за|Не окупается/);

  // И колонка окупаемости попадает в видимую область, а не уезжает за край.
  const header = page.getByRole("columnheader", { name: "Окупаемость" }).first();
  const box = await header.boundingBox();
  const width = page.viewportSize()!.width;
  expect(box, "колонка окупаемости не отрисована").not.toBeNull();
  expect(box!.x + box!.width, "колонка окупаемости уехала за правый край").toBeLessThanOrEqual(width);
});
```

- [ ] **Шаг 2: Запустить и убедиться, что падает**

```bash
lsof -ti:3000 | xargs kill -9 2>/dev/null
npx playwright test e2e/wizard.spec.ts
```
Ожидание: FAIL — блока нет, а колонка окупаемости стоит одиннадцатой из двенадцати.

- [ ] **Шаг 3: Переставить колонки**

Новый порядок: `Решение → Окупаемость → NPV → Единиц → Цена → Производительность → Годовая
произв. → OPEX/год → Обслуж./год → Энергия/год → Лицензии/год → Цена за 1000 ед./год →` действие.
Три первых после названия — это ответ; остальное нужно тому, кто копает, и стоит после.

Когда параметров нет, колонок ответа нет — порядок остальных не меняется.

- [ ] **Шаг 4: Добавить блок лучшего решения**

```tsx
// components/calculator/best-solution.tsx
import { isViable, isCalculable } from "@/lib/economics/types";

// «Лучшее» — по NPV и ТОЛЬКО среди проходящих isViable. Предикат отделяет «экономично» от
// «стоит рекомендовать»: в сиде есть решения с economical: true и отрицательным NPV, и
// интерфейс однажды уже их праздновал, пока панель ниже писала «не окупается».
```

Если ни одно решение не проходит `isViable`, блок **не показывает лучшее из плохих**: он
говорит, что при этих параметрах не окупается ни одно, и ведёт назад к параметрам. Ложный
герой на этом экране дороже отсутствующего.

- [ ] **Шаг 5: Тест проходит, паритет не сломан**

```bash
lsof -ti:3000 | xargs kill -9 2>/dev/null
npx playwright test
```
Ожидание: все спеки зелёные, включая паритет NPV списка и расчёта.

- [ ] **Шаг 6: Коммит**

```bash
git add app components e2e
git commit -m "feat(compare): ответ на первом месте — окупаемость, NPV и блок лучшего решения

Подпись обещала сортировку по NPV, а колонки окупаемости и NPV стояли одиннадцатыми
из двенадцати и уезжали за край экрана: таблица была построена по логике
происхождения данных, а не по вопросу, с которым пришёл человек.

Лучшее решение выбирается среди проходящих isViable, а не просто economical. Если не
проходит ни одно — блок говорит это прямо, а не показывает лучшее из плохих.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Задача 2: Торнадо чувствительности на инлайновом SVG

**Files:**
- Create: `components/calculator/tornado-chart.tsx`
- Modify: `components/calculator/sensitivity-chart.tsx`

**Почему SVG руками.** Одна диаграмма не окупает библиотеку, а CSP разрешает скрипты не с
любого CDN. Палитра `--chart-1..5` уже валидирована и **не используется ни одним компонентом** —
инструмент лежит готовый.

- [ ] **Шаг 1: Нарисовать диаграмму**

Каркас, задающий систему координат — именно здесь ошибиться легче всего, потому что промах в
`viewBox` обрезает крайние подписи молча:

```tsx
const ROW_H = 28;
const PAD_LEFT = 190;   // место под самую длинную подпись допущения
const PAD_RIGHT = 120;  // место под значение справа от полосы
const PAD_Y = 24;       // место под подпись нулевой линии сверху
const PLOT_W = 420;

// ОДНА шкала на всю диаграмму: полоса каждой строки должна быть сопоставима с соседней.
// Масштабирование каждой строки от собственного максимума превращает торнадо в набор
// одинаковых полос, то есть ровно в то, чего диаграмма не должна делать.
const maxSwing = Math.max(...bars.map((b) => b.swing), 1);
const x = (v: number) => PAD_LEFT + (v / maxSwing) * PLOT_W;

const width = PAD_LEFT + PLOT_W + PAD_RIGHT;
const height = PAD_Y * 2 + bars.length * ROW_H;

<svg
  viewBox={`0 0 ${width} ${height}`}
  role="img"
  aria-label={`Чувствительность NPV. Сильнее всего влияют: ${bars.slice(0, 3).map((b) => ASSUMPTION_LABELS[b.key]).join(", ")}.`}
  className="w-full"
>
  {/* Нулевая линия: торнадо без неё нечитаем — не видно, от чего отложены полосы. */}
  <line x1={PAD_LEFT} y1={PAD_Y} x2={PAD_LEFT} y2={height - PAD_Y}
        stroke="var(--border)" strokeWidth={1} />
  {bars.map((b, i) => (
    <g key={b.key} transform={`translate(0 ${PAD_Y + i * ROW_H})`}>
      <title>{`${ASSUMPTION_LABELS[b.key]}: размах ${formatCost(b.swing, usdToRub)}`}</title>
      <text x={PAD_LEFT - 8} y={14} textAnchor="end"
            fill="var(--muted-foreground)" fontSize={12}>
        {ASSUMPTION_LABELS[b.key]}
      </text>
      <rect x={PAD_LEFT} y={4} width={x(b.swing) - PAD_LEFT} height={16} rx={2}
            fill={`var(--chart-${(i % 5) + 1})`} />
      <text x={x(b.swing) + 8} y={16} fill="var(--muted-foreground)" fontSize={12}>
        {formatCost(b.swing, usdToRub)}
      </text>
    </g>
  ))}
</svg>
```

Остальные требования, каждое проверяется на шаге 2:
- одна шкала на всю диаграмму: полосы сопоставимы между строками, а не каждая от своего
  максимума;
- нулевая линия видна и подписана — торнадо без неё нечитаем;
- цвета из `var(--chart-1)`…, текст из `var(--muted-foreground)`: хардкод сломает тёмную тему;
- `viewBox` с запасом под крайние подписи, иначе они обрежутся;
- у каждой полосы `<title>` с точным значением — это и подсказка, и доступное имя;
- `role="img"` с `aria-label`, перечисляющим три сильнейших фактора: диаграмма обязана иметь
  текстовый эквивалент, иначе она информация, потерянная для скринридера (SC 1.1.1).

- [ ] **Шаг 2: Проверить в браузере, в обеих темах**

Открыть расчёт, снять скриншот в светлой и тёмной теме, убедиться: подписи не обрезаны, ноль
на месте, полосы сопоставимы, текст читается. Прогнать `npm run check:contrast`.

- [ ] **Шаг 3: Коммит**

```bash
git add components
git commit -m "feat(calc): торнадо чувствительности настоящим графиком

Полоски из div заменены инлайновым SVG на валидированной палитре, которая до сих пор
не использовалась ни одним компонентом. Одна шкала на диаграмму, видимая нулевая
линия, цвета из токенов — иначе тёмная тема и печать ломаются.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Задача 3: Реестр объяснений и раскрытие по месту

**Files:**
- Modify: `components/calculator/economics-rows.ts`
- Create: `lib/economics/explanations.ts`, `lib/economics/explanations.test.ts`
- Create: `components/ui/disclosure.tsx`
- Modify: `components/calculator/results-panel.tsx`

**Interfaces:**
- Produces: `type EconomicsRowKey = "quantity" | "displacedFte" | "capex" | "opex" | "baseline"
  | "savings" | "simplePayback" | "discountedPayback" | "roi" | "npv"` (экспортируется из
  `economics-rows.ts`).
- Produces:

```ts
export type Explanation = {
  /** Заголовок раскрытия — вопрос, на который оно отвечает. */
  title: string;
  /** Ответ. Проза, а не формула: формулы живут в справочнике. */
  body: string;
  /** Ссылка на источник, если утверждение опирается на внешние данные. */
  sourceUrl?: string;
  /** Дата проверки источника, в формате YYYY-MM-DD. */
  lastVerified?: string;
};

export const EXPLANATIONS: Record<EconomicsRowKey, Explanation>;
```

- Produces: `<Disclosure title={…} body={…} sourceUrl={…} lastVerified={…} />`.

- [ ] **Шаг 1: Сузить ключ до union-типа**

В `economics-rows.ts` заменить `key: string` на `key: EconomicsRowKey` и экспортировать тип.
Это ход, ради которого реестр вообще возможен: **пропущенное объяснение ловит компилятор**, а
не бдительность.

- [ ] **Шаг 2: Написать падающий тест**

```ts
import { describe, it, expect } from "vitest";
import { EXPLANATIONS } from "./explanations";
import { economicsRows, PANEL_LABELS } from "@/components/calculator/economics-rows";
import { computeEconomics } from "./calculate";
import { makeAssumptions, makeCapacity, makeParams } from "./fixtures";

describe("реестр объяснений", () => {
  it("покрывает каждый показатель, который рендерят панель и отчёт", () => {
    const r = computeEconomics(makeCapacity(), makeParams(), makeAssumptions());
    if (!("quantity" in r)) throw new Error("ожидался считаемый результат");
    for (const row of economicsRows(r, 90, PANEL_LABELS)) {
      expect(EXPLANATIONS[row.key], `нет объяснения для ${row.key}`).toBeDefined();
    }
  });

  it("объяснение отвечает на вопрос «откуда», а не повторяет подпись", () => {
    // Объяснение короче сорока символов — это переименованная подпись, а не ответ.
    for (const [key, e] of Object.entries(EXPLANATIONS)) {
      expect(e.body.length, `${key}: объяснение слишком короткое, чтобы что-то объяснить`)
        .toBeGreaterThan(40);
    }
  });
});
```

- [ ] **Шаг 3: Запустить и убедиться, что падает**

Запуск: `npx --yes vitest run lib/economics/explanations < /dev/null`
Ожидание: FAIL — модуля нет.

- [ ] **Шаг 4: Написать объяснения**

По одному на показатель, из спеки: цена (диапазон, источник, дата, почему оценка);
производительность (у классов два источника); замещаемый персонал (ограничение по фактической
нагрузке, а не по штату); дисконтированная окупаемость (отличие от простой, ставка); NPV
(горизонт, ставка, повторный CAPEX); класс (что это и почему диапазон).

**Тон:** отвечать на вопрос, а не защищаться. «Цена — оценка по открытым источникам, потому что
вендоры не публикуют прайс на промышленных роботов» — ответ. «Мы стараемся быть точными» — нет.

- [ ] **Шаг 5: Компонент раскрытия**

`<Disclosure>` — `<button aria-expanded>` плюс блок под строкой. **Не всплывающая подсказка:**
она недоступна с клавиатуры, бесполезна на телефоне и не попадает в печать. Раскрытое
состояние скрыто в `@media print` — в отчёте источники идут отдельным списком.

- [ ] **Шаг 6: Тесты и клавиатура**

```bash
npx --yes vitest run < /dev/null
```
Затем в браузере: дойти табом до маркера, раскрыть Enter'ом, убедиться, что фокус виден и
`aria-expanded` меняется.

- [ ] **Шаг 7: Коммит**

```bash
git add lib components
git commit -m "feat(ui): объяснение у каждого числа, а не страница о методологии

Ключи показателей уже существовали в economics-rows и рендерятся обеими
поверхностями — реестр типизирован по ним, поэтому пропущенный показатель ловит
компилятор, а не бдительность.

Одно нераскрываемое число компрометирует остальные: если у девяти цифр есть ответ, а
у десятой нет, скептик решит, что именно её и прячут.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Задача 4: Первый экран

**Files:**
- Modify: `app/page.tsx`
- Modify: `e2e/flow.spec.ts`

- [ ] **Шаг 1: Написать падающий тест**

```ts
test("первый экран объясняет продукт и ведёт в подбор", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/); // редиректа больше нет
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: /Проверить свой объект/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Откуда цифры/ })).toBeVisible();
  await page.getByRole("link", { name: /Проверить свой объект/ }).click();
  await expect(page).toHaveURL(/\/onboarding/);
});
```

- [ ] **Шаг 2: Запустить и убедиться, что падает**

Ожидание: FAIL — `/` делает `redirect("/onboarding")`.

- [ ] **Шаг 3: Написать экран**

Структура из спеки: обещание, три возражения с ответами, одно действие, ссылка на справочник.
**Никаких счётчиков, логотипов несуществующих клиентов и слова «инновационный».** Возражения —
это содержание, а не украшение: «цены с потолка?», «почему столько людей?», «а если ставка
другая?».

- [ ] **Шаг 4: Тесты**

```bash
lsof -ti:3000 | xargs kill -9 2>/dev/null; npx playwright test
```

- [ ] **Шаг 5: Коммит**

```bash
git add app e2e
git commit -m "feat: первый экран вместо редиректа в опрос

Судья, открывший ссылку, попадал сразу на вопрос «в какой вы отрасли?», не зная,
зачем отвечать. Экран построен на трёх возражениях финансового директора и ответах на
них — это содержание, а не украшение.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Задача 5: Справочник

**Files:**
- Create: `lib/sources/registry.ts`, `lib/sources/registry.test.ts`
- Create: `app/methodology/page.tsx`
- Modify: `scripts/check-sources.ts`

**Interfaces:**
- Produces: `ALL_CITATIONS: { label, url, lastVerified, kind }[]` — собирается из
  `WAREHOUSE_REAL` и `SOLUTION_CLASSES`.

- [ ] **Шаг 1: Написать падающий тест**

```ts
it("список источников собран из модулей сева, а не переписан руками", () => {
  const urls = new Set(ALL_CITATIONS.map((c) => c.url));
  for (const s of WAREHOUSE_REAL) expect(urls.has(s.sourceUrl)).toBe(true);
  for (const c of SOLUTION_CLASSES) {
    expect(urls.has(c.sourceUrl)).toBe(true);
    expect(urls.has(c.capacitySourceUrl)).toBe(true);
  }
});
```

Страница про честность, чей список источников разошёлся с реальными данными, — худший из
возможных экспонатов. Поэтому список **выводится**, а не пишется.

- [ ] **Шаг 2: Запустить и убедиться, что падает**

Запуск: `npx --yes vitest run lib/sources < /dev/null` → FAIL.

- [ ] **Шаг 3: Реализовать реестр и переиспользовать его в check-sources**

`scripts/check-sources.ts` сегодня собирает цитаты сам; после этой задачи он берёт их из
`ALL_CITATIONS`. Два места, считающие, что такое «список источников», разъедутся.

- [ ] **Шаг 4: Написать страницу**

Формулы модели, таблица источников с датами, раздел «Как мы не даём себе соврать»: паритет
экрана и отчёта под тестом, гейт свежести, типизированный отказ вместо `NaN`, метки «оценка»,
правило «класс не заводится без источника на оба конца диапазона».

**Это единственное место, где инженерная часть уместна** — здесь она отвечает на заданный
вопрос. Тот же текст на первом экране был бы хвастовством.

- [ ] **Шаг 5: Полный гейт**

```bash
lsof -ti:3000 | xargs kill -9 2>/dev/null
npx tsc --noEmit && npx --yes vitest run < /dev/null && npm run lint -- --max-warnings=0 \
  && npm run build && npx playwright test && npm run check:contrast && npm run check:sources
```

- [ ] **Шаг 6: Коммит**

```bash
git add lib app scripts
git commit -m "feat: справочник — формулы, источники и механика, которая их стережёт

Список источников выводится из модулей сева, а не пишется руками: страница про
честность, чей список разошёлся с данными, — худший из возможных экспонатов.
check-sources берёт цитаты оттуда же, чтобы два определения «списка источников» не
разъехались.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## После этого плана

| | Тема |
|---|---|
| D | Ручной ввод количества и CAPEX — **меняет числа, нужна подпись** |
| Мелочи | Девять целей касания меньше 24px; DPI канвы визуализации |
