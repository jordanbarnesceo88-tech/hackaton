# План 2 из 3: визуальный язык — типографика, воздух, ширины

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Убрать ощущение скудости, которое даёт нейтральный системный шрифт, мелкая
типографическая шкала и колонка в 768px посреди монитора в 1440.

**Architecture:** Меняются токены, а не компоненты. Типографическая шкала, фон и правило ширин
живут в `app/globals.css` и `app/layout.tsx`; страницы получают новую ширину заменой одного
класса-обёртки на семантический. Акцентный цвет **не меняется** — он уже валидирован.

**Tech Stack:** Tailwind v4 (`@theme inline`), `next/font/google`, shadcn-токены, oklch.

**Spec:** `docs/superpowers/specs/2026-09-07-wizard-and-taxonomy-design.md` (раздел 2)

## Global Constraints

- **Акцент `--primary` не меняется.** Палитра графиков `--chart-1..5` прошла валидатор
  (полоса светлоты, порог цветности, различимость при цветовой слепоте ΔE ≥ 8, при полном
  зрении ΔE ≥ 15, контраст ≥ 3:1) в обеих темах. Менять оттенок — значит гонять это заново
  ради эффекта, который дают не оттенок, а шкала и воздух.
- **Кириллица обязательна.** Интерфейс русский; шрифт без полноценной кириллицы не
  рассматривается, каким бы характерным он ни был. Проверять фактическую загрузку кириллических
  начертаний, а не строку в конфиге.
- **Отчёт печатается светлым** при любой теме — блок `@media print` в `globals.css` сбрасывает
  все токены. Любой новый токен обязан попасть и туда.
- **Ни одно выходное число не меняется.** `lib/economics/**` и `lib/scene/**` не редактируются.
- **Ветка `wizard-taxonomy`.** Один коммит на задачу. Хвост:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- **Vitest — `npx --yes vitest run < /dev/null`; перед e2e убивать сервер на :3000.**

---

## Структура файлов

| Файл | Ответственность |
|---|---|
| `app/layout.tsx` | изменение: подключение шрифтов |
| `app/globals.css` | изменение: типографическая шкала, фон, поля, печать |
| `app/(app)/compare/[type]/page.tsx` | изменение: ширина по назначению |
| `app/(app)/calculate/[solutionId]/page.tsx` | изменение: ширина по назначению |
| `app/(app)/analyses/page.tsx` | изменение: ширина по назначению |
| `components/ui/num-field.tsx` | изменение: поля с подчёркиванием |
| `scripts/check-contrast.ts` | создание: проверка контраста токенов в обеих темах |

---

### Задача 1: Шрифтовая пара с кириллицей

**Files:**
- Modify: `app/layout.tsx`
- Modify: `app/globals.css:34-36`
- Test: `scripts/check-contrast.ts` не затрагивается; проверка — браузерная, шаг 4

**Interfaces:**
- Produces: CSS-переменные `--font-display` и `--font-body`; токены `--font-sans`,
  `--font-heading` указывают на них.

**Выбор и его обоснование.** Заголовки — **Onest**, текст — **Manrope**. Обе есть в Google
Fonts с кириллицей. Onest — современный гротеск с характером в заголовочных начертаниях, где
его и видно; Manrope спокоен в наборе и имеет табличные цифры, что важно: в интерфейсе колонки
денежных сумм, а прыгающая ширина цифр в них читается как брак. Geist остаётся моноширинным
для технических подписей.

- [ ] **Шаг 1: Подключить шрифты**

В `app/layout.tsx`:

```tsx
import { Onest, Manrope, Geist_Mono } from "next/font/google";

const display = Onest({
  variable: "--font-display",
  subsets: ["latin", "cyrillic"],
  weight: ["600", "700"],
});
const body = Manrope({
  variable: "--font-body",
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600"],
});
```

`subsets` обязан включать `cyrillic`: без него Next не грузит кириллические начертания, текст
молча падает на системный шрифт, и это заметно только глазами.

Заменить `geistSans` на `display`/`body` в списке классов на `<html>`, `geistMono` оставить.

- [ ] **Шаг 2: Перенаправить токены**

В `app/globals.css`:

```css
  --font-sans: var(--font-body);
  --font-mono: var(--font-geist-mono);
  --font-heading: var(--font-display);
```

- [ ] **Шаг 3: Собрать**

Запуск: `npm run build`
Ожидание: 0 ошибок. Next скачивает шрифты на этапе сборки — падение здесь означает опечатку в
имени семейства или недоступное начертание.

- [ ] **Шаг 4: Проверить кириллицу в браузере, а не в конфиге**

```bash
lsof -ti:3000 | xargs kill -9 2>/dev/null
npm run start &
```

Открыть `http://localhost:3000/onboarding` и выполнить в консоли:

```js
document.fonts.check("600 32px Onest") && document.fonts.check("400 16px Manrope")
```

Ожидание: `true` для обоих. Затем убедиться глазами, что заголовок с русским текстом набран
новым шрифтом, а не системным: у Onest характерная «а» и заметно другой ритм, подмену видно.

- [ ] **Шаг 5: Коммит**

```bash
git add app
git commit -m "feat(ui): шрифтовая пара Onest + Manrope с кириллицей

Geist нейтрален по замыслу, и в этом была половина ощущения скудости. Заголовки
получают характер, текст — табличные цифры: в колонках денежных сумм прыгающая
ширина цифры читается как брак.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Задача 2: Типографическая шкала

**Files:**
- Modify: `app/globals.css`
- Modify: `components/ui/card.tsx` (`CardTitle`)

**Interfaces:**
- Produces: классы-утилиты не заводятся; меняются базовые размеры в слое `base`.

**Проблема, которую решаем.** Сейчас контраст размеров — заголовок 20px против текста 14px.
Это соотношение 1.43; глаз читает такую страницу как один сплошной блок. Typeform держится на
соотношении около 2.5.

- [ ] **Шаг 1: Задать шкалу в базовом слое**

В `app/globals.css`, в существующий `@layer base`:

```css
@layer base {
  body {
    font-size: 16px;
    line-height: 1.6;
  }
  h1 {
    font-family: var(--font-heading);
    font-weight: 700;
    font-size: clamp(1.75rem, 1.2rem + 2.2vw, 2.5rem);
    line-height: 1.1;
    letter-spacing: -0.022em;
    text-wrap: balance;
  }
  h2 {
    font-family: var(--font-heading);
    font-weight: 600;
    font-size: clamp(1.25rem, 1.05rem + 0.8vw, 1.5rem);
    line-height: 1.2;
    letter-spacing: -0.015em;
    text-wrap: balance;
  }
  /* Денежные колонки: цифры одной ширины, иначе столбец «дышит» при пересчёте. */
  b, strong, td, .tabular {
    font-variant-numeric: tabular-nums;
  }
}
```

- [ ] **Шаг 2: Снять жёсткие размеры с CardTitle**

`CardTitle` задаёт свой размер и перебивает шкалу. Оставить ему только начертание, размер
отдать `h2`.

- [ ] **Шаг 3: Проверить, что ничего не переехало**

```bash
npm run build
lsof -ti:3000 | xargs kill -9 2>/dev/null
npx playwright test
```
Ожидание: сборка 0, e2e 4/4. Тесты ищут элементы по роли и тексту, поэтому падение здесь
означает, что заголовок перестал быть заголовком, а не что он стал крупнее.

- [ ] **Шаг 4: Коммит**

```bash
git add app components
git commit -m "feat(ui): типографическая шкала с реальным контрастом размеров

Было 20px против 14px — соотношение 1.43, при котором страница читается одним
блоком. Стало примерно 2.5, как в опросных интерфейсах, на которые мы равняемся.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Задача 3: Фон и поля

**Files:**
- Modify: `app/globals.css` (все четыре блока токенов, включая `@media print`)
- Modify: `components/ui/num-field.tsx`
- Create: `scripts/check-contrast.ts`

**Interfaces:**
- Produces: `npm run check:contrast` — печатает контраст пар токенов и падает ниже AA.

- [ ] **Шаг 1: Написать проверку контраста ДО изменения цветов**

Создать `scripts/check-contrast.ts`. Скрипт, а не тест: он проверяет решение дизайнера, а не
поведение кода, и падение по нему — повод подумать, а не повод чинить сборку.

**Скрипт читает токены из `app/globals.css` сам.** Дублировать цвета рядом в sRGB — значит
завести второй источник правды, который разъедется с первым молча. Конвертация oklch → sRGB
определена однозначно, поэтому её проще написать, чем поддерживать копию.

```ts
// RELATIVE import: под tsx алиас "@/" не резолвится.
import { readFileSync } from "node:fs";

// oklch → linear sRGB → sRGB. Матрицы из спецификации CSS Color 4.
function oklchToRgb(L: number, C: number, hDeg: number): [number, number, number] {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const [l, m, s] = [l_ ** 3, m_ ** 3, s_ ** 3];
  const lin = [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const enc = (v: number) => {
    const c = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, c)) * 255);
  };
  return [enc(lin[0]!), enc(lin[1]!), enc(lin[2]!)];
}

function luminance([r, g, b]: [number, number, number]): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function ratio(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** Токены одного блока globals.css: `--name: oklch(L C H);` */
function parseBlock(css: string, startMarker: string): Record<string, [number, number, number]> {
  const from = css.indexOf(startMarker);
  if (from < 0) throw new Error(`Не найден блок токенов: ${startMarker}`);
  const body = css.slice(from, css.indexOf("\n}", from));
  const out: Record<string, [number, number, number]> = {};
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/g)) {
    out[m[1]!] = oklchToRgb(Number(m[2]), Number(m[3]), Number(m[4]));
  }
  return out;
}

// Пары «что на чём читают». Минимум 4.5:1 для текста, 3.0:1 для крупного и для графики.
const PAIRS: [fg: string, bg: string, min: number][] = [
  ["foreground", "background", 4.5],
  ["card-foreground", "card", 4.5],
  ["muted-foreground", "card", 4.5],
  ["muted-foreground", "background", 4.5],
  ["primary", "background", 3.0],
  ["primary-foreground", "primary", 4.5],
  ["destructive", "background", 4.5],
  ["chart-1", "background", 3.0],
  ["chart-2", "background", 3.0],
  ["chart-3", "background", 3.0],
  ["chart-4", "background", 3.0],
  ["chart-5", "background", 3.0],
];

const css = readFileSync("app/globals.css", "utf8");
const themes: [string, string][] = [
  ["светлая", ":root {"],
  ["тёмная", ".dark {"],
];

let failed = 0;
for (const [label, marker] of themes) {
  const t = parseBlock(css, marker);
  console.log(`\n${label} тема`);
  for (const [fg, bg, min] of PAIRS) {
    // Токен, не найденный в блоке, — это не «пропустить»: это либо опечатка, либо цвет,
    // определённый только в одной теме, а такой цвет и есть классический баг нечитаемой
    // страницы. Считаем провалом.
    if (!t[fg] || !t[bg]) {
      failed++;
      console.log(`  FAIL  --${fg} или --${bg} не определён в этом блоке`);
      continue;
    }
    const r = ratio(t[fg]!, t[bg]!);
    const ok = r >= min;
    if (!ok) failed++;
    console.log(`  ${ok ? "ok   " : "FAIL "} ${r.toFixed(2)}:1 (нужно ${min})  --${fg} на --${bg}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} пар(ы) ниже порога.`);
  process.exit(1);
}
console.log("\nВсе пары проходят в обеих темах.");
```

Добавить в `package.json`: `"check:contrast": "tsx scripts/check-contrast.ts"`.

- [ ] **Шаг 2: Запустить на текущих цветах и записать базовую линию**

Запуск: `npm run check:contrast`
Ожидание: все пары проходят. Это фиксирует, что мы ничего не ломаем, а не что мы что-то
починили.

- [ ] **Шаг 3: Сдвинуть фон и заполнить пары**

`--background` в светлой теме перестаёт быть чистым белым и получает лёгкий холодный тон,
согласованный с синим акцентом (чистый белый под насыщенным синим читается как «дефолт»):

```css
  --background: oklch(0.985 0.003 264);
  --card: oklch(1 0 0);
```

Карточка остаётся белой — так она отделяется от фона без границы и тени, что и есть язык, к
которому мы идём. **Все четыре блока токенов** (`:root`, `.dark`, `prefers-color-scheme`,
`@media print`) правятся согласованно; в печатном блоке фон возвращается к чистому белому.

`PAIRS` править не нужно: они заданы по именам токенов, а не по значениям, поэтому новый фон
проверяется тем же списком автоматически. Если какая-то пара упала — это и есть тот случай,
ради которого скрипт писался до смены цвета, а не после.

- [ ] **Шаг 4: Поля с подчёркиванием**

В `components/ui/num-field.tsx` заменить рамку на нижнюю границу, увеличить высоту и размер
шрифта ввода. Фокус остаётся видимым — `focus-visible` с кольцом акцента, иначе поле без рамки
теряет состояние фокуса, и клавиатурная навигация становится слепой.

- [ ] **Шаг 5: Проверить и снять базовую линию заново**

```bash
npm run check:contrast
npm run build
lsof -ti:3000 | xargs kill -9 2>/dev/null && npx playwright test
```
Ожидание: контраст проходит, сборка 0, e2e 4/4.

- [ ] **Шаг 6: Коммит**

```bash
git add app components scripts package.json
git commit -m "feat(ui): тонированный фон, поля с подчёркиванием, проверка контраста

check:contrast заведён ДО смены цветов и на них же снял базовую линию: смысл в том,
чтобы поймать регрессию, а не подтвердить улучшение. Фон перестал быть чистым белым —
под насыщенным синим он читался как отсутствие решения.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Задача 4: Ширина по назначению поверхности

**Files:**
- Modify: `app/globals.css` (утилиты-обёртки)
- Modify: `app/(app)/compare/[type]/page.tsx:77`
- Modify: `app/(app)/calculate/[solutionId]/page.tsx:54`
- Modify: `app/(app)/analyses/page.tsx:11`

**Interfaces:**
- Produces: два класса — `.surface-prose` (узкая колонка) и `.surface-data` (во всю ширину).

**Правило, а не число.** «Везде 100vw» неверно: вопрос во всю ширину монитора не читается.
Ширина выбирается по роли поверхности — текст и опрос узкие, данные и таблицы широкие.

- [ ] **Шаг 1: Завести утилиты**

```css
@layer components {
  /* Проза и опрос: строка длиннее ~75 знаков теряется при переходе на следующую. */
  .surface-prose {
    width: 100%;
    max-width: 42rem;
    margin-inline: auto;
    padding-inline: 1.5rem;
  }
  /* Данные: таблица сравнения и панели расчёта должны занимать монитор, но не липнуть к
     краям — поля остаются, ограничение снимается. */
  .surface-data {
    width: 100%;
    max-width: 96rem;
    margin-inline: auto;
    padding-inline: clamp(1.5rem, 4vw, 4rem);
  }
}
```

- [ ] **Шаг 2: Применить по назначению**

- `/compare/[type]` — `.surface-data` (таблица сравнения, сейчас `max-w-5xl`)
- `/calculate/[solutionId]` — `.surface-data` (панели и график, сейчас `max-w-3xl`)
- `/analyses` — `.surface-prose` (список, ему ширина не нужна)
- `/report/[analysisId]` — **не трогать**: он печатается на A4.

- [ ] **Шаг 3: Проверить на широком экране**

```bash
npm run build && npm run start &
```
Открыть `/calculate/...` при ширине окна 1440 и убедиться, что панель результатов и график
чувствительности используют ширину, а не жмутся в колонку. Затем сузить до 375px и убедиться,
что ничего не выезжает за край: `padding-inline` с `clamp` не должен схлопываться в ноль.

- [ ] **Шаг 4: Коммит**

```bash
git add app
git commit -m "feat(ui): ширина по назначению поверхности, а не одна на всё

max-w-3xl на калькуляторе оставлял две трети монитора пустыми, а таблицу сравнения
жал в колонку. Но «везде 100vw» — тоже не ответ: вопрос во всю ширину не читается.
Проза узкая, данные широкие, отчёт не тронут — он печатается на A4.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Задача 5: Перепроверить то, что уже было выверено

**Files:**
- Modify: `docs/data-provenance.md` не затрагивается; при находках — `app/globals.css`

**Почему это отдельная задача.** Палитра графиков, тёмная тема и светлая печать были выверены
инструментами, а не на глаз. Смена фона меняет знаменатель в каждом из этих расчётов. Пропустить
этот шаг — значит потерять уже оплаченную работу молча.

- [ ] **Шаг 1: Прогнать валидатор палитры графиков**

Загрузить скилл `dataviz` и прогнать его валидатор на `--chart-1..5` в обеих темах против
нового фона. Ожидание: ноль предупреждений — полоса светлоты, порог цветности, различимость при
цветовой слепоте (ΔE ≥ 8), при полном зрении (ΔE ≥ 15), контраст ≥ 3:1.

- [ ] **Шаг 2: Измерить контраст в браузере, а не в CSS**

Chrome отдаёт `lab()` для `oklch`, и попытка распарсить это как RGB даёт бессмысленные числа —
на этом уже обжигались. Мерить `getComputedStyle` и композитить полупрозрачные фоны по цепочке
предков вручную. Проверить пять страниц: `/onboarding`, `/compare`, `/calculate`, `/analyses`,
`/report` — в светлой и тёмной теме.

- [ ] **Шаг 3: Проверить печать**

Открыть `/report/...` с `.dark` на `<html>`, включить эмуляцию `print` и убедиться, что
`color-scheme` возвращается к `light`, а фон — к белому. `.report-block` ставит
`print-color-adjust: exact`, поэтому браузер послушно положит тёмный фон на бумагу, если мы
его там оставим.

- [ ] **Шаг 4: Полный гейт**

```bash
lsof -ti:3000 | xargs kill -9 2>/dev/null
npx tsc --noEmit && npx --yes vitest run < /dev/null && npm run lint -- --max-warnings=0 \
  && npm run build && npx playwright test && npm run check:contrast && npm run check:sources
```

- [ ] **Шаг 5: Коммит**

```bash
git add app docs
git commit -m "test(ui): перепроверить палитру графиков, тёмную тему и печать на новом фоне

Смена фона меняет знаменатель в каждом из этих расчётов. Всё это выверялось
инструментами, а не на глаз, и пропустить перепроверку — значит потерять уже
сделанную работу молча.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## После этого плана

План 3 — каркас подбора: route group, шаги в URL, `<ViewTransition>`, паритет-тест шага 4 и
шага 5. Он опирается на утилиты ширин и типографическую шкалу отсюда.
