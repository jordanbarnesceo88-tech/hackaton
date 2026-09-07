# План 3 из 3: каркас подбора — шаги, состояние в URL, переходы

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Разложить подбор на шаги с «Далее» и «Назад», спросить параметры объекта **до**
сравнения и показать в сравнении реальный срок окупаемости под эти параметры.

**Architecture:** Route group `(wizard)` даёт общий layout, не меняя ни одного URL. Ответы
копятся в query-строке, поэтому обновление страницы ничего не теряет. Шаг 4 прогоняет движок по
всем применимым решениям на тех же входах, с которых стартует шаг 5, — это и есть условие
паритета.

**Tech Stack:** Next 16 App Router, React `<ViewTransition>` (работает без конфигурации),
Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-09-07-wizard-and-taxonomy-design.md` (раздел 1)

## Global Constraints

- **URL сохраняются:** `/compare/[type]`, `/calculate/[solutionId]`, `/report/[analysisId]`.
  На них ссылаются сохранённые расчёты и уже разосланные отчёты.
- **Query-строке не доверять.** Параметры проходят через `withParamDefaults()` и
  `clampAssumption()` — те же, что защищают путь сохранения. Второй путь валидации не заводить.
- **`lib/economics/**` и `lib/scene/**` не редактируются. Ни одно выходное число не меняется.**
- **`prefers-reduced-motion` отключает переходы полностью.** В репозитории есть рабочий приём
  (`useSyncExternalStore` в визуализации) — использовать его, а не CSS-only.
- **Ветка `wizard-taxonomy`**, один коммит на задачу, хвост
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Vitest — `npx --yes vitest run < /dev/null`; перед e2e убивать сервер на :3000.**

---

## Структура файлов

| Файл | Ответственность |
|---|---|
| `app/(wizard)/layout.tsx` | создание: прогресс, «Далее»/«Назад», переходы |
| `lib/wizard/steps.ts` | создание: описание шагов, порядок, разбор query |
| `lib/wizard/steps.test.ts` | создание: тесты разбора и валидации |
| `components/wizard/choice-tiles.tsx` | создание: плитки выбора с буквами и клавиатурой |
| `app/(wizard)/onboarding/page.tsx` | изменение: шаг 1 — только отрасль |
| `app/(wizard)/onboarding/facility/page.tsx` | создание: шаг 2 |
| `app/(wizard)/onboarding/params/page.tsx` | создание: шаг 3 |
| `app/(app)/compare/[type]/page.tsx` | перенос в `(wizard)` + ранжирование по ROI |
| `app/(app)/calculate/[solutionId]/page.tsx` | перенос в `(wizard)` + чтение параметров |
| `e2e/wizard.spec.ts` | создание: сквозной проход и паритет шагов 4 и 5 |

---

### Задача 1: Описание шагов и разбор состояния

**Files:**
- Create: `lib/wizard/steps.ts`, `lib/wizard/steps.test.ts`

**Interfaces:**
- Produces: `WIZARD_STEPS` (порядок и заголовки), `parseWizardParams(sp)` →
  `{ industry, facility, params, complete }`, `buildWizardQuery(state)` → строка.

- [ ] **Шаг 1: Написать падающий тест**

```ts
import { describe, it, expect } from "vitest";
import { parseWizardParams, buildWizardQuery, WIZARD_STEPS } from "./steps";

describe("parseWizardParams", () => {
  it("разбирает полный набор", () => {
    const s = parseWizardParams({ industry: "retail", facility: "warehouse", area: "1000", ops: "500", staff: "10" });
    expect(s.industry).toBe("retail");
    expect(s.facility).toBe("warehouse");
    expect(s.params).toEqual({ areaM2: 1000, opsPerDay: 500, staffCount: 10 });
    expect(s.complete).toBe(true);
  });

  it("мусор в числах не роняет разбор и не проникает дальше", () => {
    const s = parseWizardParams({ industry: "retail", facility: "warehouse", area: "не число", ops: "-5", staff: "1e9" });
    expect(Number.isFinite(s.params.areaM2)).toBe(true);
    expect(s.params.opsPerDay).toBeGreaterThan(0);
    expect(s.params.staffCount).toBeLessThan(1e9);
  });

  it("неполный набор не считается завершённым", () => {
    expect(parseWizardParams({ industry: "retail" }).complete).toBe(false);
  });

  it("сборка и разбор — обратные операции", () => {
    const state = { industry: "retail", facility: "warehouse", params: { areaM2: 1000, opsPerDay: 500, staffCount: 10 } };
    const back = parseWizardParams(Object.fromEntries(new URLSearchParams(buildWizardQuery(state))));
    expect(back.params).toEqual(state.params);
  });

  it("шаги перечислены по порядку и без дублей", () => {
    const keys = WIZARD_STEPS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys[0]).toBe("industry");
  });
});
```

- [ ] **Шаг 2: Запустить и убедиться, что падает**

Запуск: `npx --yes vitest run lib/wizard < /dev/null`
Ожидание: FAIL — модуля нет.

- [ ] **Шаг 3: Реализовать**

`lib/wizard/steps.ts` использует существующие `withParamDefaults` из
`lib/economics/assumptions` — свой путь валидации не заводится.

- [ ] **Шаг 4: Тест проходит**

Запуск: `npx --yes vitest run lib/wizard < /dev/null` → PASS.

- [ ] **Шаг 5: Коммит**

```bash
git add lib/wizard
git commit -m "feat(wizard): описание шагов и разбор состояния из query-строки

Ответы живут в URL, поэтому обновление страницы ничего не теряет, а ссылку на любой
шаг можно отправить. Числа проходят через withParamDefaults — тот же путь, что
защищает сохранение, а не второй.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Задача 2: Плитки выбора с клавиатурой

**Files:**
- Create: `components/wizard/choice-tiles.tsx`

**Interfaces:**
- Produces: `<ChoiceTiles items={[{value,label,hint?}]} name value onChange />`.

**Почему не радиокнопки.** С 12 отраслями и 47 типами объектов список радиокнопок — это
экран, по которому надо ползти глазами. Плитки с буквенными бейджами дают и цель для мыши, и
клавиатурный выбор одним нажатием.

- [ ] **Шаг 1: Реализовать**

Требования, каждое из которых проверяется на шаге 2:
- разметка — `role="radiogroup"` с `role="radio"` и `aria-checked` на плитках;
- стрелки перемещают выбор, буква (A, Б, В…) выбирает сразу, Enter подтверждает;
- видимый фокус — плитка без рамки теряет состояние фокуса, и клавиатура слепнет;
- буквенный бейдж скрыт от скринридера (`aria-hidden`): он подсказка для глаз, а озвученный
  превращает «Склад» в «А Склад».

- [ ] **Шаг 2: Проверить с клавиатуры в браузере**

Открыть шаг 1, пройти табом до группы, стрелками сменить выбор, нажать букву — выбор должен
переехать. Убедиться, что фокус видно на каждом шаге.

- [ ] **Шаг 3: Коммит**

```bash
git add components/wizard
git commit -m "feat(wizard): плитки выбора с буквами и клавиатурным управлением

Список из 47 радиокнопок — это экран, по которому ползут глазами. Буквенный бейдж
скрыт от скринридера: он подсказка для глаз, озвученный он превращает «Склад» в «А Склад».

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Задача 3: Каркас — route group и layout

**Files:**
- Create: `app/(wizard)/layout.tsx`
- Move: `app/(app)/compare`, `app/(app)/calculate` → `app/(wizard)/`

**Ключевое свойство:** группа `(wizard)` не влияет на URL. `/compare/warehouse` и
`/calculate/abc` остаются собой.

- [ ] **Шаг 1: Перенести маршруты и создать layout**

Layout показывает прогресс и кнопки **только когда в query-строке есть состояние подбора**.
Пришли из «Мои расчёты» прямо на `/calculate/…` — оболочки нет: вы не в опросе.

- [ ] **Шаг 2: Убедиться, что URL не изменились**

```bash
npm run build
```
Ожидание: в списке маршрутов те же пути, что и раньше — `/compare/[type]`,
`/calculate/[solutionId]`. Появление `/(wizard)/…` в URL означает ошибку в имени группы.

- [ ] **Шаг 3: Прогнать e2e — старые входы обязаны работать**

```bash
lsof -ti:3000 | xargs kill -9 2>/dev/null; npx playwright test
```
Ожидание: 4/4. Эти тесты ходят по прямым ссылкам и есть главная защита URL.

- [ ] **Шаг 4: Коммит**

```bash
git add app
git commit -m "feat(wizard): каркас как route group, URL не меняются

Группа (wizard) не влияет на пути, поэтому сохранённые расчёты и уже разосланные
отчёты продолжают открываться. Оболочка показывается только при наличии состояния
подбора в query: пришли из «Мои расчёты» — вы не в опросе.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Задача 4: Шаги 1–3

**Files:**
- Modify: `app/(wizard)/onboarding/page.tsx`
- Create: `app/(wizard)/onboarding/facility/page.tsx`, `app/(wizard)/onboarding/params/page.tsx`
- Delete: `components/onboarding-form.tsx` (заменяется тремя серверными страницами)

- [ ] **Шаг 1: Шаг 1 — отрасль**

Только отрасли, плитками. «Далее» ведёт на `/onboarding/facility?industry=…`.

- [ ] **Шаг 2: Шаг 2 — тип объекта**

Типы выбранной отрасли. Свободное название объекта показывается, только если тип
`isGeneric` — эта логика уже есть в старой форме, её надо перенести, а не изобрести заново.

- [ ] **Шаг 3: Шаг 3 — параметры**

Поля площади, операций в сутки и персонала, **предзаполненные типовыми параметрами** из
`FacilityExample` для выбранного типа объекта. Пустые поля здесь хуже приблизительных: с нуля
человек не знает, что вводить.

- [ ] **Шаг 4: Проверить обновление страницы на середине**

Дойти до шага 3, обновить страницу. Ожидание: все ответы на месте — они в URL.

- [ ] **Шаг 5: Коммит**

```bash
git add app components
git commit -m "feat(wizard): шаги отрасли, типа объекта и параметров

Шаг параметров стартует с типовых значений для выбранного типа объекта: пустые поля
хуже приблизительных — с нуля человек не знает, что вводить, и уходит.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Задача 5: Шаг 4 — сравнение с реальным ROI

**Files:**
- Modify: `app/(wizard)/compare/[type]/page.tsx`
- Create: `e2e/wizard.spec.ts`

**Interfaces:**
- Consumes: `parseWizardParams` из задачи 1.

**Суть изменения.** Сегодня сравнению нечем ранжировать, кроме «цены за единицу годовой
производительности» — абстракции, ничего не говорящей про конкретный объект. Получив параметры,
оно считает по каждому решению настоящий NPV и срок окупаемости.

- [ ] **Шаг 1: Написать паритет-тест ДО изменения страницы**

`e2e/wizard.spec.ts`: пройти подбор до сравнения, запомнить NPV первого решения, открыть его
расчёт, сверить. Числа обязаны совпасть **до** первой правки допущений — после неё они
расходятся законно.

- [ ] **Шаг 2: Запустить и убедиться, что падает**

Ожидание: FAIL — на шаге 4 ещё нет NPV.

- [ ] **Шаг 3: Считать и ранжировать**

Параметры из query + `DEFAULT_ASSUMPTIONS` из БД, без пользовательских правок — правки живут
на шаге 5. Это не деталь реализации, а условие паритета. Решения без параметров показывают
прежнюю нормированную цену, а не пустоту.

- [ ] **Шаг 4: Тест проходит**

Запуск: `npx playwright test e2e/wizard.spec.ts` → PASS.

- [ ] **Шаг 5: Проверить, что тест не вакуумный**

Внести дрейф в расчёт **только на стороне сравнения** и убедиться, что тест падает. Вернуть.
Паритет-тест, который зелен при расхождении, хуже отсутствующего.

- [ ] **Шаг 6: Коммит**

```bash
git add app e2e
git commit -m "feat(wizard): сравнение считает реальный ROI под параметры объекта

Раньше ранжировать было нечем, кроме цены за единицу абстрактной производительности.
Паритет-тест держит главное: срок окупаемости на шаге 4 и на шаге 5 — одно число, и
проверено, что тест падает при расхождении.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Задача 6: Переходы

**Files:**
- Modify: `app/(wizard)/layout.tsx`

- [ ] **Шаг 1: Обернуть содержимое в `<ViewTransition>`**

Направление берётся из порядка шагов: вперёд — сдвиг влево, назад — вправо.

- [ ] **Шаг 2: Отключить при `prefers-reduced-motion`**

Использовать существующий приём из `facility-visualization.tsx`
(`useSyncExternalStore`), а не CSS-only: анимация обязана не запускаться, а не проигрываться
незаметно.

- [ ] **Шаг 3: Полный гейт**

```bash
lsof -ti:3000 | xargs kill -9 2>/dev/null
npx tsc --noEmit && npx --yes vitest run < /dev/null && npm run lint -- --max-warnings=0 \
  && npm run build && npx playwright test && npm run check:contrast && npm run check:sources
```

- [ ] **Шаг 4: Коммит**

```bash
git add app
git commit -m "feat(wizard): направленные переходы между шагами

Полностью отключаются при prefers-reduced-motion — тем же приёмом, что уже
используется в визуализации: анимация не запускается, а не проигрывается незаметно.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
