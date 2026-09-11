# Подпроект A: занятость по задачам и региональная ставка труда

> **Для агентов-исполнителей:** ОБЯЗАТЕЛЬНЫЙ СУБ-СКИЛЛ: используйте
> superpowers:subagent-driven-development (рекомендуется) или superpowers:executing-plans,
> чтобы выполнять план задача за задачей. Шаги помечены чекбоксами (`- [ ]`).

**Цель:** убрать из модели два допущения, которые дают окупаемость в одиннадцать дней —
глобальную выработку человека и западную ставку труда, — заменив первое на заявленную
человеком занятость по задаче, а второе на региональную ставку с источником.

**Архитектура:** предел замещения перестаёт выводиться из спроса и переходит в явный вход
расчёта. `displacedFte = taskFte × покрытие`, где `taskFte` человек называет сам, а норматив
выработки служит только предзаполнением поля и живёт на категории, а не в глобальных
допущениях. Спрос, парк и покрытие не меняются — эта половина модели уже проверена.

**Стек:** Next 16 App Router, React 19, Prisma 7 (driver adapter), Vitest, Playwright,
Tailwind v4.

**Спека:** `docs/superpowers/specs/2026-09-11-market-driven-economics-design.md`

## Глобальные ограничения

Копируются из спеки и правил проекта. Требования каждой задачи неявно включают этот раздел.

- **МЕНЯЕТ ВЫХОДНЫЕ ЧИСЛА.** Числа меняют ровно две задачи — **6** (формула замещения) и **8**
  (ставка труда). Обе требуют подписи владельца до мержа, как A1–A3. Задача 5 намеренно НЕ
  меняет чисел: она только пробрасывает параметр, и её зелёный прогон без единой правки
  ожиданий — доказательство, что проброска ничего не сломала.
- **Никогда не коммитить в master.** Ветка `wizard-taxonomy` (текущая) или отдельная от неё.
  Мерж `--no-ff` только после ревью и подписи. Один коммит на задачу плюс запись в CHANGELOG.
- **Никогда не выдумывать цифру.** Норматив выработки и ставка труда заводятся только со
  ссылкой на опубликованный источник и датой проверки. Нет источника — поле пустое, и задача
  считается только после ввода человеком. Оценка без ссылки допустима **только** с явной
  пометкой в поле `description`, как у `areaPerCleanerPerYear` сейчас.
- **Сохранить инварианты безопасности:** гарантии no-op от `DEFAULT_ASSUMPTIONS`; backfill
  через `withAssumptionDefaults()` на каждом чтении `assumptions` сохранённого расчёта;
  типизированные `invalid_inputs` (движок никогда не отдаёт Infinity/NaN); запросы, ограниченные
  `userId` (граница IDOR).
- **Окружение:** локальный Postgres на порту **5433**; тесты — `npx --yes vitest run < /dev/null`
  (перенаправление обязательно); перед Playwright убить процесс на :3000
  (`lsof -ti:3000 | xargs kill -9`), иначе тестируется устаревшая сборка; скрипты под `scripts/`
  используют ОТНОСИТЕЛЬНЫЕ импорты (`tsx` не резолвит `@/`).
- **Трейлер коммита:** `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

## Одна намеренная незаполненность

Запись `⟦ЗАДАЧА-1: …⟧` встречается в задачах 2 и 8. Это **не пропуск в плане**, а гейт: число
приходит из сбора источников в задаче 1 и не может быть известно раньше. Подставить сюда
правдоподобную цифру означало бы нарушить главное правило проекта — никогда не выдумывать
значение, которое выглядит как проверенное. Исполнитель, дошедший до `⟦…⟧` без выполненной
задачи 1, обязан остановиться, а не угадать.

## Структура файлов

| файл | ответственность |
|---|---|
| `docs/data-provenance.md` | *(правка)* таблица источников ставки труда и нормативов |
| `lib/economics/task-labour.ts` | **новый** — `resolveTaskFte`, единственное место, где норматив превращается в число |
| `lib/economics/task-labour.test.ts` | **новый** |
| `lib/economics/types.ts` | *(правка)* `FacilityParams.taskStaffing`, новая причина `"staffing_required"` |
| `lib/economics/assumptions.ts` | *(правка)* `withParamDefaults` переносит `taskStaffing` |
| `lib/economics/calculate.ts` | *(правка)* четвёртый аргумент `taskFte`, `displacedFte = taskFte × coverage` |
| `lib/economics/sensitivity.ts` | *(правка)* убрать рычаги с нулевым размахом, добавить занятость |
| `components/calculator/assumptions-panel.tsx` | *(правка)* убрать поля, которые больше ни на что не влияют |
| `lib/economics/normalize.ts` | *(правка)* `workerOutputPerYear` помечается как «только для предзаполнения» |
| `lib/analyses/validate.ts` | *(правка)* `validateParams` переносит новые поля |
| `prisma/schema.prisma` | *(правка)* `SolutionCategory` прибавляет три колонки |
| `prisma/migrations/*/migration.sql` | **новая** миграция, написанная руками |
| `scripts/seed-data/categories.ts` | *(правка)* `taskLabel`, норматив, ссылка |
| `app/(wizard)/onboarding/staffing/page.tsx` | **новый** — шаг «кто чем занят» |
| `lib/wizard/steps.ts` | *(правка)* новый шаг в `WIZARD_STEPS`, разбор `taskStaffing` из query |

`lib/economics/task-labour.ts` выделен отдельным файлом намеренно: разрешение занятости — это
одно решение с тремя входами и тремя исходами, его надо тестировать изолированно, и оно будет
переиспользовано подпроектом B (распределение считает `taskFte` один раз на задачу, а не на
каждый листинг).

## Порядок и зависимости

```
1 сбор источников ─┬─→ 2 категория ─┐
                   │                 ├─→ 6 формула (ЧИСЛА) ─→ 7 торнадо ─→ 8 ставка (ЧИСЛА) ─→ 9 визард ─→ 10 прогон
3 resolveTaskFte ──┤   4 граница ────┤
                   │   5 проброска ──┘
```

Задачи 1, 3, 4 не пересекаются по файлам и могут идти параллельно. Задача 5 обязана быть
зелёной до задачи 6 — иначе полсотни падений смешают «обязано было измениться» со «сломали».
Задача 8 обязана идти отдельным коммитом после 6 по той же причине.

---

### Задача 1: Собрать ставку труда и нормативы выработки

**Файлы:**
- Изменить: `docs/data-provenance.md`

**Интерфейсы:**
- Производит: таблицу «показатель — значение — источник — дата», на которую опираются задачи 5 и 6.

Это задача сбора данных, а не кода. Она первая, потому что задачи 5 и 6 без неё заведут
выдуманные числа, а это прямо запрещено правилами проекта.

- [ ] **Шаг 1: Собрать ставку труда**

Нужна почасовая или месячная стоимость складского/производственного рабочего с работодательскими
отчислениями, с публикацией и датой. Приемлемые источники: официальная статистика по труду,
публичные обзоры зарплат кадровых агентств, отраслевые отчёты. Записать **диапазон**, а не одну
точку: регион и отрасль дают разброс, и диапазон честнее.

Записать в `docs/data-provenance.md` строкой вида:

```markdown
| Стоимость труда, склад/производство | $X–Y/час с отчислениями | <URL> | 2026-09-11 |
```

- [ ] **Шаг 2: Собрать нормативы выработки человека по задачам**

По каждой задаче — сколько единиц работы делает один человек за час:

| задача | единица | статус |
|---|---|---|
| паллетирование | коробок/час | искать |
| уборка | м²/час | есть, помечено «порядок величины» |
| отбор заказов | отборов/час | искать |
| инспекция качества | деталей/час | искать |
| сортировка | посылок/час | искать |
| доставка | доставок/смена | искать |

Источники: промышленно-инженерные нормативы, эргономические исследования, отраслевые справочники
производительности. **Ненайденный норматив — нормальный результат:** поле остаётся пустым, и по
решению Р-2 спеки задача считается только после ввода человеком.

- [ ] **Шаг 3: Зафиксировать, по каким задачам норматива НЕТ**

Отдельным списком, до начала задачи 2. От него зависит и задача 2 (какие категории заводятся
без норматива), и задача 7 (экран из предзаполненных полей выглядит иначе, чем экран из пустых),
и то, сколько задач окажется пустыми на экране сравнения. Узнавать это после вёрстки — поздно.

- [ ] **Шаг 4: Гейт**

Показать собранную таблицу и список ненайденного владельцу, получить подпись до перехода к
задаче 2. Числа входят в
каждый расчёт продукта; заводить их без подтверждения нельзя.

- [ ] **Шаг 5: Коммит**

```bash
git add docs/data-provenance.md
git commit -m "docs(data): источники ставки труда и нормативов выработки по задачам"
```

---

### Задача 2: Категория получает название-задачу и норматив выработки

**Файлы:**
- Изменить: `prisma/schema.prisma`
- Создать: `prisma/migrations/<timestamp>_category_task_labour/migration.sql`
- Изменить: `scripts/seed-data/categories.ts`
- Изменить: `scripts/seed-data/seed-data.test.ts`

**Интерфейсы:**
- Производит: `SolutionCategory.taskLabel: string`, `workerOutputPerYear: Float?`,
  `workerOutputSourceUrl: String?` — читаются задачами 3 и 7.

- [ ] **Шаг 1: Написать падающий тест на целостность посевных данных**

В `scripts/seed-data/seed-data.test.ts`, в блок `describe("целостность посевных данных")`:

```ts
it("у каждой категории есть название-задача, и оно не совпадает с названием вида техники", () => {
  for (const c of CATEGORIES) {
    expect(c.taskLabel, `${c.slug}: нет taskLabel`).toBeTruthy();
    // Название задачи описывает работу, а не железо: человек ищет «паллетирование», а не
    // «роботы-паллетайзеры». Совпадение с name означает, что поле заполнили копированием.
    expect(c.taskLabel, `${c.slug}: taskLabel скопирован из name`).not.toBe(c.name);
  }
});

it("норматив выработки заводится только вместе со ссылкой", () => {
  // То же правило двух концов, что у классов и вендорских строк: число без источника
  // неотличимо от выдуманного, а норматив входит в КАЖДЫЙ расчёт этой задачи.
  for (const c of CATEGORIES) {
    if (c.workerOutputPerYear === undefined) continue;
    expect(c.workerOutputPerYear, `${c.slug}: норматив должен быть положительным`).toBeGreaterThan(0);
    expect(c.workerOutputSourceUrl, `${c.slug}: норматив без источника`).toMatch(/^https:\/\//);
  }
});
```

- [ ] **Шаг 2: Запустить, убедиться что падает**

```bash
npx --yes vitest run scripts/seed-data < /dev/null
```
Ожидается: FAIL, `taskLabel` не существует на типе.

- [ ] **Шаг 3: Расширить схему**

В `prisma/schema.prisma`, в `model SolutionCategory` после `workloadStream`:

```prisma
  /// Название работы, а не вида техники: человек выбирает «Паллетирование коробок», а не
  /// «Роботы-паллетайзеры». Экран сравнения сравнивает задачи, и это его язык.
  taskLabel      String                 @default("")

  /// Сколько единиц работы ЭТОЙ задачи делает один человек за год. Используется ТОЛЬКО для
  /// предзаполнения поля занятости в визарде — движок его не читает. Nullable: норматива может
  /// не быть, и тогда человек вводит занятость сам (решение Р-2 спеки).
  workerOutputPerYear     Float?
  /// Источник норматива. Без него норматив не заводится — правило двух концов.
  workerOutputSourceUrl   String?
```

- [ ] **Шаг 4: Написать миграцию руками**

`prisma/migrations/<timestamp>_category_task_labour/migration.sql`:

```sql
-- Три колонки на SolutionCategory. taskLabel с DEFAULT '' и NOT NULL, чтобы существующие
-- строки не потребовали backfill в той же транзакции; сев проставит настоящие значения.
-- Норматив nullable по смыслу: его отсутствие — это инструкция «спроси у человека», а не
-- пропущенные данные.
ALTER TABLE "SolutionCategory" ADD COLUMN "taskLabel" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SolutionCategory" ADD COLUMN "workerOutputPerYear" DOUBLE PRECISION;
ALTER TABLE "SolutionCategory" ADD COLUMN "workerOutputSourceUrl" TEXT;
```

Применить и сгенерировать клиент:

```bash
npx prisma migrate dev --name category_task_labour
```

- [ ] **Шаг 5: Заполнить посевные данные**

В `scripts/seed-data/categories.ts` добавить в тип поля и заполнить по каждой категории.
Пример для двух (остальные — по тому же образцу, `taskLabel` обязателен у всех, норматив только
там, где задача 1 нашла источник):

Сначала расширить `CategorySeed` (файл использует `WorkloadStream` из `@prisma/client`, а не
строковые литералы — сохранить этот стиль):

```ts
export type CategorySeed = {
  slug: string;
  name: string;
  description: string;
  workloadStream: WorkloadStream;
  taskLabel: string;
  workerOutputPerYear?: number;
  workerOutputSourceUrl?: string;
};
```

Затем заполнить. Пример двух строк; `taskLabel` обязателен у всех пятнадцати категорий,
норматив — только там, где задача 1 нашла источник:

```ts
{
  "slug": "class-palletizer",
  "name": "Роботы-паллетайзеры",
  "description": "…",
  workloadStream: WorkloadStream.OPERATION_FLOW,
  taskLabel: "Паллетирование коробок",
  workerOutputPerYear: ⟦ЗАДАЧА-1: коробок/год⟧,
  workerOutputSourceUrl: "⟦ЗАДАЧА-1: URL⟧",
},
{
  "slug": "class-cleaning",
  "name": "Роботы-уборщики",
  "description": "…",
  workloadStream: WorkloadStream.FLOOR_AREA,
  taskLabel: "Уборка полов",
  // Норматива со ссылкой нет: нынешние 600 000 м²/год помечены «порядок величины, а не
  // цитата». По правилу двух концов поле остаётся пустым, и занятость вводит человек.
},
```

- [ ] **Шаг 6: Прокинуть поля через сев**

В `scripts/seed.ts`, в upsert категорий, добавить три поля в `create` и `update`.

- [ ] **Шаг 7: Добавить проверку присутствия в конец сева**

Тест из шага 1 проверяет посевные данные, а не базу. Пустой `taskLabel` в базе он не поймает.
В `scripts/seed.ts`, рядом с уже существующей проверкой присутствия решений (она появилась
после того, как складская чистка молча удаляла Gausium на каждом севе):

```ts
{
  const blank = await prisma.solutionCategory.findMany({
    where: { taskLabel: "" },
    select: { slug: true },
  });
  if (blank.length > 0) {
    throw new Error(
      `категории без названия-задачи после сева: ${blank.map((c) => c.slug).join(", ")}. ` +
        `DEFAULT '' в миграции существует ради существующих строк, а не ради посевных данных.`
    );
  }
}
```

- [ ] **Шаг 8: Запустить тесты и сев**

```bash
npx --yes vitest run scripts/seed-data < /dev/null    # ожидается PASS
npm run db:seed                                        # ожидается без ошибок
```

- [ ] **Шаг 9: Коммит**

```bash
git add prisma/ scripts/
git commit -m "feat(data): категория получает название-задачу и норматив выработки со ссылкой"
```

---

### Задача 3: `resolveTaskFte` — чистая функция разрешения занятости

**Файлы:**
- Создать: `lib/economics/task-labour.ts`
- Создать: `lib/economics/task-labour.test.ts`

**Интерфейсы:**
- Потребляет: ничего из предыдущих задач (норматив передаётся аргументом).
- Производит: `resolveTaskFte(input: TaskLabourInput): number | null` — используется задачами 4,
  7 и подпроектом B.

- [ ] **Шаг 1: Написать падающие тесты**

`lib/economics/task-labour.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveTaskFte } from "./task-labour";

describe("resolveTaskFte", () => {
  it("заявленная человеком занятость побеждает норматив", () => {
    const fte = resolveTaskFte({ declared: 6, demandPerYear: 3_750_000, workerOutputPerYear: 600_000, staffCount: 80 });
    expect(fte).toBe(6);
  });

  it("без заявленной занятости считает по нормативу", () => {
    const fte = resolveTaskFte({ declared: undefined, demandPerYear: 3_750_000, workerOutputPerYear: 600_000, staffCount: 80 });
    expect(fte).toBeCloseTo(6.25, 5);
  });

  it("норматив не может дать больше людей, чем есть на объекте", () => {
    // Иначе задача «замещает» персонал, которого не существует — ровно тот абсурд, ради
    // которого весь подпроект и затеян.
    const fte = resolveTaskFte({ declared: undefined, demandPerYear: 3_750_000, workerOutputPerYear: 12_500, staffCount: 80 });
    expect(fte).toBe(80);
  });

  it("без заявленной занятости и без норматива возвращает null", () => {
    // null — это не ноль. Ноль означал бы «людей на задаче нет, экономить нечего»; null
    // означает «мы не знаем», и движок обязан отказаться считать, а не показать ноль.
    expect(resolveTaskFte({ declared: undefined, demandPerYear: 3_750_000, workerOutputPerYear: null, staffCount: 80 })).toBeNull();
  });

  it("заявленный ноль — это заявление, а не пропуск", () => {
    // Человек может честно сказать «этой задачей у нас никто не занят». Это ответ, и он
    // должен дать ноль экономии, а не откат к нормативу.
    expect(resolveTaskFte({ declared: 0, demandPerYear: 3_750_000, workerOutputPerYear: 600_000, staffCount: 80 })).toBe(0);
  });

  it("заявленная занятость ограничена штатом объекта", () => {
    expect(resolveTaskFte({ declared: 500, demandPerYear: 3_750_000, workerOutputPerYear: 600_000, staffCount: 80 })).toBe(80);
  });

  it("негодные числа не проходят в расчёт", () => {
    for (const bad of [NaN, Infinity, -1]) {
      expect(resolveTaskFte({ declared: bad, demandPerYear: 3_750_000, workerOutputPerYear: 600_000, staffCount: 80 })).toBeCloseTo(6.25, 5);
    }
    expect(resolveTaskFte({ declared: undefined, demandPerYear: 0, workerOutputPerYear: 600_000, staffCount: 80 })).toBe(0);
    expect(resolveTaskFte({ declared: undefined, demandPerYear: 3_750_000, workerOutputPerYear: 0, staffCount: 80 })).toBeNull();
  });
});
```

- [ ] **Шаг 2: Запустить, убедиться что падает**

```bash
npx --yes vitest run lib/economics/task-labour < /dev/null
```
Ожидается: FAIL, «Cannot find module './task-labour'».

- [ ] **Шаг 3: Реализовать**

`lib/economics/task-labour.ts`:

```ts
export type TaskLabourInput = {
  /** Сколько человек, по словам владельца объекта, занято этой задачей. */
  declared: number | undefined;
  /** Годовой объём работы ЭТОЙ задачи — из demandPerYear по потоку категории. */
  demandPerYear: number;
  /** Норматив выработки человека. null — норматива со ссылкой нет. */
  workerOutputPerYear: number | null;
  /** Весь штат объекта — жёсткий потолок. */
  staffCount: number;
};

/**
 * Сколько человек заняты задачей — единственное место, где этот вопрос решается.
 *
 * Появилась потому, что предел замещения выводился из спроса через одно глобальное число на
 * все задачи: 12 500 операций в год — это 6 операций в час, правдоподобно для отбора заказов
 * и ошибка в пятьдесят раз для укладки коробок. На пищевом производстве это давало «один
 * паллетайзер за $12 143 замещает весь штат комбината» и окупаемость в одиннадцать дней.
 *
 * Порядок источников: заявленное человеком → норматив → null. Владелец объекта знает свою
 * занятость точнее любого источника, поэтому его ответ первичен, а норматив служит
 * предзаполнением, которое видно и можно поправить.
 *
 * null — это НЕ ноль. Ноль означает «этой задачей никто не занят, экономить нечего»; null
 * означает «мы не знаем», и вызывающий обязан отказаться считать. Слить их значило бы
 * показать ноль экономии там, где ответа просто нет.
 */
export function resolveTaskFte(input: TaskLabourInput): number | null {
  const { declared, demandPerYear, workerOutputPerYear, staffCount } = input;
  const cap = Number.isFinite(staffCount) && staffCount > 0 ? staffCount : 0;

  if (typeof declared === "number" && Number.isFinite(declared) && declared >= 0) {
    return Math.min(cap, declared);
  }
  if (workerOutputPerYear === null || !(workerOutputPerYear > 0)) return null;
  if (!Number.isFinite(demandPerYear) || demandPerYear < 0) return null;
  return Math.min(cap, demandPerYear / workerOutputPerYear);
}
```

- [ ] **Шаг 4: Запустить тесты**

```bash
npx --yes vitest run lib/economics/task-labour < /dev/null
```
Ожидается: PASS, 7 тестов.

- [ ] **Шаг 5: Проверка мутацией**

Временно заменить `if (typeof declared === "number" ...)` на `if (false)` и убедиться, что
падает тест «заявленная человеком занятость побеждает норматив». Вернуть. Затем заменить
`return null` (ветка без норматива) на `return 0` и убедиться, что падает тест про null.
Вернуть. Тест, который не падает от снятия своей ветки, ничего не проверяет.

- [ ] **Шаг 6: Коммит**

```bash
git add lib/economics/task-labour.ts lib/economics/task-labour.test.ts
git commit -m "feat(economics): resolveTaskFte — занятость по задаче с приоритетом ответа человека"
```

---

### Задача 4: `taskStaffing` проходит границу сохранения

**Файлы:**
- Изменить: `lib/economics/types.ts`
- Изменить: `lib/economics/assumptions.ts:87-116` (`withParamDefaults`)
- Изменить: `lib/economics/assumptions.test.ts`
- Изменить: `lib/analyses/validate.ts`

**Интерфейсы:**
- Потребляет: ничего.
- Производит: `FacilityParams.taskFte?: number`, `FacilityParams.taskStaffing?: Record<string, number>`.

Эта задача существует отдельно, потому что уже кусало: `validateParams` молча выбрасывал
`quantityOverride` и `capexPerUnitUsdOverride`, и переопределения не доходили до отчёта, хотя
в коде выглядели проброшенными. Граница сохранения проверяется своим тестом.

- [ ] **Шаг 1: Написать падающие тесты**

В `lib/economics/assumptions.test.ts`, в `describe("withParamDefaults")`:

```ts
it("переносит заявленную занятость по задачам", () => {
  const v = withParamDefaults({ areaM2: 1, opsPerDay: 1, staffCount: 80, taskStaffing: { "class-palletizer": 6 } });
  expect(v.taskStaffing).toEqual({ "class-palletizer": 6 });
});

it("выбрасывает негодные значения занятости, а не чинит их", () => {
  // Как и у переопределений: негодное значение не переносится, расчёт возвращается к
  // нормативу, и пометка «задано вами» исчезает вместе с ним — экран не утверждает того,
  // чего движок не делает.
  const v = withParamDefaults({ areaM2: 1, opsPerDay: 1, staffCount: 80,
    taskStaffing: { a: 6, b: NaN, c: -1, d: "7" } });
  expect(v.taskStaffing).toEqual({ a: 6 });
});

it("не создаёт taskStaffing, когда его нет", () => {
  expect("taskStaffing" in withParamDefaults({ areaM2: 1, opsPerDay: 1, staffCount: 1 })).toBe(false);
});
```

В `lib/analyses/validate.test.ts` (файл существует):

```ts
it("validateParams доносит занятость по задачам до расчёта", () => {
  const r = validateParams({ areaM2: 1000, opsPerDay: 500, staffCount: 80, taskStaffing: { "class-palletizer": 6 } });
  expect(r.ok).toBe(true);
  expect(r.ok && r.value.taskStaffing).toEqual({ "class-palletizer": 6 });
});
```

- [ ] **Шаг 2: Запустить, убедиться что падает**

```bash
npx --yes vitest run lib/economics/assumptions lib/analyses < /dev/null
```
Ожидается: FAIL.

- [ ] **Шаг 3: Расширить тип**

В `lib/economics/types.ts`, в `FacilityParams` после `capexPerUnitUsdOverride`:

```ts
  /**
   * Сколько человек занято каждой задачей, по словам владельца объекта. Ключ — slug категории.
   *
   * Живёт в параметрах, а не отдельным объектом: это вход расчёта, его надо сохранять вместе
   * с ним, и withParamDefaults уже защищает этот путь. Отсутствие ключа — это ДРУГАЯ
   * инструкция, чем ноль: ноль значит «никто не занят», отсутствие — «спроси норматив».
   */
  taskStaffing?: Record<string, number>;
```

- [ ] **Шаг 4: Расширить `withParamDefaults`**

В `lib/economics/assumptions.ts`, перед `return out`:

```ts
  // Занятость по задачам — по той же логике, что переопределения: негодные значения не
  // переносятся, а не «чинятся». Пустой объект не создаётся: его отсутствие — инструкция
  // «считай по нормативу», и она должна пережить сериализацию в jsonb без изменения смысла.
  if (src.taskStaffing && typeof src.taskStaffing === "object" && !Array.isArray(src.taskStaffing)) {
    const clean: Record<string, number> = {};
    for (const [slug, v] of Object.entries(src.taskStaffing as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) clean[slug] = v;
    }
    if (Object.keys(clean).length > 0) out.taskStaffing = clean;
  }
```

- [ ] **Шаг 5: Прокинуть через `validateParams`**

В `lib/analyses/validate.ts` добавить `taskStaffing` в переносимые поля — тем же способом,
которым сейчас переносятся `quantityOverride` и `capexPerUnitUsdOverride`.

- [ ] **Шаг 6: Запустить тесты**

```bash
npx --yes vitest run lib/economics lib/analyses < /dev/null
```
Ожидается: PASS.

- [ ] **Шаг 7: Коммит**

```bash
git add lib/economics/ lib/analyses/
git commit -m "feat(economics): занятость по задачам проходит границу сохранения"
```

---

### Задача 5: Движок принимает занятость аргументом — **ЧИСЛА НЕ МЕНЯЮТСЯ**

**Файлы:**
- Изменить: `lib/economics/types.ts` (причина `"staffing_required"`)
- Изменить: `lib/economics/calculate.ts:23-90`
- Изменить: девять вызывающих (список ниже)
- Изменить: `lib/economics/sensitivity.test.ts`, `lib/economics/breakeven.test.ts`

**Интерфейсы:**
- Производит: `baseEconomics(cap, params, a, taskFte)`, `computeEconomics(cap, params, a, taskFte)`,
  `EconomicsResult` с вариантом `reason: "staffing_required"`.

Задача 5 разрезана надвое намеренно. Пятьдесят восемь `it()` в семи файлах зависят от чисел
движка (`calculate.test.ts` 22, `diverged.test.ts` 10, `overrides.test.ts` 7,
`workload-streams.test.ts` 6, `breakeven.test.ts` 5, `economics-rows.test.ts` 5,
`explanations.test.ts` 3). Менять сигнатуру и формулу одним коммитом означает получить
полсотни падений, среди которых не отличить «обязано было измениться» от «сломали».

Здесь меняется **только сигнатура**. Вызывающие передают `taskFte`, вычисленный СТАРОЙ
формулой. **Все 58 тестов обязаны остаться зелёными без единой правки ожиданий** — это и есть
доказательство, что проброска ничего не сломала.

- [ ] **Шаг 1: Добавить типизированный отказ**

В `lib/economics/types.ts`, в union `EconomicsResult`:

```ts
  // Занятость задачи не заявлена, и норматива со ссылкой у категории нет. Это не вырожденный
  // ввод, а отсутствующий ответ: показать ноль экономии значило бы утверждать, что задачей
  // никто не занят. Отдельная причина, а не invalid_inputs, потому что экран обязан сказать
  // человеку, что именно от него требуется.
  | {
      economical: false;
      reason: "staffing_required";
    };
```

- [ ] **Шаг 2: Добавить обязательный параметр**

В `lib/economics/calculate.ts`:

```ts
export function baseEconomics(
  cap: SolutionCapacity,
  params: FacilityParams,
  a: AssumptionValues,
  // ОБЯЗАТЕЛЬНЫЙ, и по той же причине, по которой обязателен stream у demandPerYear:
  // значение по умолчанию «ради совместимости» уже однажды спрятало пропуск на половине
  // вызовов, и парк для решения потока площади считался по потоку заказов. Без умолчания
  // компилятор перечисляет все девять мест сам.
  taskFte: number | null
): BaseEconomics | null {
```

Внутри, вместо `maxDisplaceableFte`:

```ts
  if (taskFte === null || !Number.isFinite(taskFte) || taskFte < 0) return null;
  const displacedFte = Math.max(0, Math.min(params.staffCount, taskFte * coverage));
```

В `computeEconomics` — параметр и различение двух отказов:

```ts
export function computeEconomics(
  cap: SolutionCapacity,
  params: FacilityParams,
  a: AssumptionValues,
  taskFte: number | null
): EconomicsResult {
  if (taskFte === null) return { economical: false, reason: "staffing_required" };
  const base = baseEconomics(cap, params, a, taskFte);
  if (base === null) return { economical: false, reason: "invalid_inputs" };
```

- [ ] **Шаг 3: Пробросить через девять вызывающих, СОХРАНИВ старое поведение**

В каждом — вычислить `taskFte` **старой формулой**, чтобы числа не изменились:

```ts
// ВРЕМЕННО, на один коммит: старая формула, вынесенная из движка наружу без изменения смысла.
// Задача 6 заменит её на resolveTaskFte. Здесь цель — доказать зелёным прогоном, что
// проброска параметра ничего не сломала.
const taskFte = Math.min(
  params.staffCount,
  demandPerYear(params, a, cap.workloadStream) / workerOutputPerYear(a, cap.workloadStream)
);
```

Точные места:

```
app/(app)/report/[analysisId]/page.tsx:63          computeEconomics
app/(wizard)/calculate/[solutionId]/page.tsx:82    computeEconomics
app/(wizard)/compare/[type]/page.tsx:102           computeEconomics
app/(wizard)/compare/[type]/page.tsx:114           computeEconomics
lib/economics/recommend.ts:45                      computeEconomics
lib/economics/sensitivity.ts:17                    baseEconomics
lib/economics/breakeven.ts:18                      baseEconomics
lib/economics/calculate.ts:96                      baseEconomics
components/economics-calculator.tsx:124            computeEconomics
```

- [ ] **Шаг 4: Тесты на двух вызывающих, которые зовут `baseEconomics` НАПРЯМУЮ**

`sensitivity.ts` и `breakeven.ts` минуют `computeEconomics`, значит отказа `staffing_required`
они не увидят — получат `null` и покажут пустую диаграмму без объяснения.

```ts
// sensitivity.test.ts
it("без занятости диаграмма не строится, а не показывает нули", () => {
  expect(npvForScenario(cap, params, DEFAULT_ASSUMPTIONS, null)).toBeNull();
});

// breakeven.test.ts
it("без занятости точка безубыточности не вычисляется", () => {
  expect(breakEvenLaborRateUsd(cap, params, DEFAULT_ASSUMPTIONS, null)).toBeNull();
});
```

- [ ] **Шаг 5: Прогон — ВСЕ 58 тестов зелёные БЕЗ правок ожиданий**

```bash
npx tsc --noEmit
npx --yes vitest run < /dev/null
```

**Если хоть одно ожидание пришлось изменить — проброска изменила поведение, и это ошибка
шага 3, а не повод править тест.** Найти и исправить, не трогая ожиданий.

- [ ] **Шаг 6: Коммит**

```bash
git add lib/ app/ components/
git commit -m "refactor(economics): занятость становится обязательным аргументом движка"
```

---

### Задача 6: Замещение считается от заявленной занятости — **МЕНЯЕТ ЧИСЛА**

**Файлы:**
- Изменить: девять вызывающих (временная формула → `resolveTaskFte`)
- Изменить: `lib/economics/normalize.ts:74-77` (комментарий)
- Изменить: тесты, чьи числа обязаны измениться

**Интерфейсы:**
- Потребляет: `resolveTaskFte` (задача 3), `taskStaffing` (задача 4), норматив категории (задача 2).

**Меняет выходные числа, требует подписи.** Всё, что не связано с заменой формулы, уже зелёное
после задачи 5 — поэтому каждое падение здесь обязано иметь объяснение «это число должно было
измениться».

- [ ] **Шаг 1: Написать падающий тест на воспроизведение бага**

В `lib/economics/calculate.test.ts`:

```ts
describe("замещение считается от занятости задачи, а не от всего штата", () => {
  // Воспроизведение: пищевое производство 7000 м², 15 000 операций/сутки, 80 человек,
  // паллетайзер за $12 143 при 600 коробок/час. До этой задачи движок давал окупаемость
  // 0,026 года — одиннадцать дней — потому что displacedFte упирался в 80.
  const params: FacilityParams = {
    areaM2: 7000, opsPerDay: 15000, staffCount: 80,
    taskStaffing: { "class-palletizer": 6 },
  };
  const cap: SolutionCapacity = {
    capacityPerUnit: 600, capacityBasis: "PER_HOUR_FLOW", workloadStream: "OPERATION_FLOW",
    priceUsd: 12143, maintenanceUsdYear: 971, energyUsdYear: 243, licensingUsdYear: 0,
  };

  it("замещает названных шесть человек, а не весь комбинат", () => {
    const r = baseEconomics(cap, params, DEFAULT_ASSUMPTIONS, 6);
    expect(r).not.toBeNull();
    expect(r!.displacedFte).toBeCloseTo(6, 5);
  });

  it("окупаемость перестаёт быть двузначным числом дней", () => {
    const r = computeEconomics(cap, params, DEFAULT_ASSUMPTIONS, 6);
    expect(r.economical).toBe(true);
    expect(r.economical && r.discountedPaybackYears).toBeGreaterThan(0.15);
  });

  it("половина парка замещает вдвое меньше людей", () => {
    // Покрытие обязано масштабировать замещение, иначе переопределение количества становится
    // способом получить любой желаемый NPV.
    const half = baseEconomics(cap, { ...params, quantityOverride: 1 }, DEFAULT_ASSUMPTIONS, 6);
    const full = baseEconomics(cap, params, DEFAULT_ASSUMPTIONS, 6);
    expect(half!.displacedFte).toBeLessThan(full!.displacedFte);
  });

  it("без занятости и без норматива расчёт отказывается считать", () => {
    const r = computeEconomics(cap, params, DEFAULT_ASSUMPTIONS, null);
    expect(r).toEqual({ economical: false, reason: "staffing_required" });
  });
});
```

- [ ] **Шаг 2: Запустить, убедиться что падает**

```bash
npx --yes vitest run lib/economics/calculate < /dev/null
```

- [ ] **Шаг 3: Заменить временную формулу на `resolveTaskFte`**

В каждом из девяти мест:

```ts
const taskFte = resolveTaskFte({
  declared: params.taskStaffing?.[category.slug],
  demandPerYear: demandPerYear(params, a, cap.workloadStream),
  workerOutputPerYear: category.workerOutputPerYear ?? null,
  staffCount: params.staffCount,
});
```

- [ ] **Шаг 4: Пометить `workerOutputPerYear` как выбывший из расчёта**

В `lib/economics/normalize.ts:74-77`:

```ts
/**
 * Сколько работы ЭТОГО потока делает один человек за год.
 *
 * БОЛЬШЕ НЕ ДЕЛИТЕЛЬ ПРЕДЕЛА ЗАМЕЩЕНИЯ. Движок его не читает: замещение считается от
 * занятости, названной владельцем объекта (resolveTaskFte). Осталась только для
 * ПРЕДЗАПОЛНЕНИЯ поля занятости в визарде, где значение видно и его можно поправить.
 * Появление этой функции в calculate.ts — регрессия, ради которой писался подпроект A.
 */
```

- [ ] **Шаг 5: Прогон и ревизия падений**

```bash
npx tsc --noEmit
npx --yes vitest run < /dev/null
```

По каждому падению записать одной строкой, почему число обязано было измениться. Падение без
объяснения — не «поправить ожидание», а «разобраться».

- [ ] **Шаг 6: Проверка мутацией**

Заменить `taskFte * coverage` на `taskFte` — обязан упасть тест «половина парка замещает вдвое
меньше людей». Вернуть.

- [ ] **Шаг 7: CHANGELOG и коммит**

Запись обязана содержать старое число (0,026 года), новое и почему разница — исправление.

```bash
git add lib/ app/ components/ CHANGELOG.md
git commit -m "fix(economics): замещение считается от занятости задачи (МЕНЯЕТ ЧИСЛА)"
```

---

### Задача 7: Торнадо и панель перестают показывать мёртвые рычаги

**Файлы:**
- Изменить: `lib/economics/sensitivity.ts:54-57`
- Изменить: `lib/economics/sensitivity.test.ts`
- Изменить: `components/calculator/assumptions-panel.tsx:22-23`
- Изменить: `components/calculator/tornado-chart.tsx` (новый тип ключа)

**Интерфейсы:**
- Производит: `SensitivityBar.key: keyof AssumptionValues | "taskFte"`.

`STREAM_KEYS` добавлял делители в диаграмму **именно как делители предела замещения** — так
написано в комментарии над ними. После задачи 6 движок их не читает, и перебор даст размах
ровно 0 ₽. В том же комментарии сказано, что это уже чинили однажды: диаграмма показывала
«Операций на сотрудника в год» с нулевым размахом на решении потока площади. **Без этой задачи
мы воспроизведём ту же поломку сразу для обоих потоков.**

- [ ] **Шаг 1: Написать тест-инвариант, которого не было**

```ts
it("ни один рычаг торнадо не имеет нулевого размаха", () => {
  // Рычаг с нулевым размахом — не рычаг. Диаграмма заявляет, что РАНЖИРУЕТ рычаги,
  // двигающие NPV; столбец нулевой длины означает, что она ранжирует не тот набор.
  // Этот инвариант поймал бы обе прошлые поломки — и ту, что чинили в STREAM_KEYS,
  // и ту, которую создаёт вынос делителя из движка.
  for (const stream of ["OPERATION_FLOW", "FLOOR_AREA"] as const) {
    const bars = sensitivityBars({ ...cap, workloadStream: stream }, params, DEFAULT_ASSUMPTIONS, 6);
    for (const b of bars) {
      expect(b.swing, `${stream}/${b.key}: рычаг не двигает NPV`).toBeGreaterThan(0);
    }
  }
});

it("занятость по задаче присутствует среди рычагов", () => {
  // Доминирующий рычаг модели. Диаграмма без него ранжирует всё, кроме самого сильного.
  const bars = sensitivityBars(cap, params, DEFAULT_ASSUMPTIONS, 6);
  expect(bars.map((b) => b.key)).toContain("taskFte");
});
```

- [ ] **Шаг 2: Запустить, убедиться что падает**

Ожидается два падения: нулевой размах у `opsPerWorkerPerYear` и отсутствие `taskFte`.

- [ ] **Шаг 3: Убрать мёртвые делители**

```ts
// Делители предела замещения отсюда убраны: после подпроекта A движок их не читает —
// замещение считается от занятости, названной человеком. cleaningsPerDay остаётся: он
// входит в demandPerYear и продолжает двигать покрытие, а значит и NPV.
const STREAM_KEYS: Record<WorkloadStream, (keyof AssumptionValues)[]> = {
  OPERATION_FLOW: [],
  FLOOR_AREA: ["cleaningsPerDay"],
};
```

- [ ] **Шаг 4: Добавить занятость рычагом**

Расширить `SensitivityBar.key` до `keyof AssumptionValues | "taskFte"` и перебирать `taskFte`
±25% наравне с процентными допущениями. Подпись — «Занято на задаче, человек».

- [ ] **Шаг 5: Убрать мёртвые поля из панели допущений**

`components/calculator/assumptions-panel.tsx:22-23` — либо снять оба ключа, либо подписать
«используется только для предзаполнения». Редактируемое поле, которое ни на что не влияет, —
это контрол, который лжёт.

- [ ] **Шаг 6: Прогон и коммит**

```bash
npx --yes vitest run lib/economics components < /dev/null
git add lib/ components/
git commit -m "fix(sensitivity): убрать рычаги с нулевым размахом, добавить занятость"
```

---

### Задача 8: Региональная ставка труда — **МЕНЯЕТ ЧИСЛА**

**Файлы:**
- Изменить: `lib/economics/assumptions.ts:4`
- Изменить: `scripts/seed.ts:31`
- Изменить: `docs/data-provenance.md`

**Выполняется строго ПОСЛЕ задачи 6 и отдельным коммитом.** Если менять формулу и ставку
вместе, причины падения тестов не разделить: обе двигают одни и те же числа.

- [ ] **Шаг 1: Тест, фиксирующий связь ставки и источника**

```ts
it("ставка труда лежит в диапазоне, подтверждённом источником", () => {
  // Тест существует, чтобы правка дефолта «на глаз» не прошла молча: ставка —
  // доминирующий рычаг, замена 15 на 6 сдвигает медианную окупаемость в 2,4 раза
  // по 39 комбинациям объект×задача.
  expect(DEFAULT_ASSUMPTIONS.laborCostPerHourUsd).toBeGreaterThanOrEqual(⟦ЗАДАЧА-1: нижняя граница⟧);
  expect(DEFAULT_ASSUMPTIONS.laborCostPerHourUsd).toBeLessThanOrEqual(⟦ЗАДАЧА-1: верхняя граница⟧);
});
```

- [ ] **Шаг 2: Запустить, убедиться что падает при значении 15**

- [ ] **Шаг 3: Заменить дефолт**

В `lib/economics/assumptions.ts` и `scripts/seed.ts` — значение из задачи 1, с комментарием,
называющим источник и дату. В `scripts/seed.ts` добавить `description` со ссылкой, чтобы она
была видна в панели допущений, а не только в коде.

- [ ] **Шаг 4: Пересев и полный прогон**

```bash
npm run db:seed
npx --yes vitest run < /dev/null
```

- [ ] **Шаг 5: CHANGELOG и коммит**

Приложить таблицу чувствительности из спеки.

```bash
git add lib/ scripts/ docs/ CHANGELOG.md
git commit -m "fix(economics): региональная ставка труда вместо западной (МЕНЯЕТ ЧИСЛА)"
```

---

### Задача 9: Шаг визарда «кто чем занят»

**Файлы:**
- Создать: `app/(wizard)/onboarding/staffing/page.tsx`
- Изменить: `lib/wizard/steps.ts`, `lib/wizard/steps.test.ts`
- Создать: `e2e/staffing.spec.ts`

**Зависит от результата задачи 1.** Если нормативов не нашлось, экран состоит из пустых полей,
и его текст другой: не «проверьте подставленное», а «заполните». Знать до вёрстки.

- [ ] **Шаг 1: Падающие тесты разбора**

```ts
it("разбирает занятость по задачам из query", () => {
  const s = parseWizardParams(new URLSearchParams("staffing=class-palletizer:6,class-cleaning:4"));
  expect(s.taskStaffing).toEqual({ "class-palletizer": 6, "class-cleaning": 4 });
});

it("игнорирует негодные пары, а не роняет шаг", () => {
  const s = parseWizardParams(new URLSearchParams("staffing=a:6,b:,c:-1,:4,d:x"));
  expect(s.taskStaffing).toEqual({ a: 6 });
});

it("предзаполнение совпадает с тем, что получит движок", () => {
  // Экран берёт норматив с категории, движок получает taskFte от вызывающего. Если они
  // разойдутся, человек увидит «по нормативу 6,25», а посчитается другое — и никакой
  // другой тест этого не заметит.
  const shown = prefillTaskFte(category, params, DEFAULT_ASSUMPTIONS);
  const used = resolveTaskFte({
    declared: undefined,
    demandPerYear: demandPerYear(params, DEFAULT_ASSUMPTIONS, category.workloadStream),
    workerOutputPerYear: category.workerOutputPerYear ?? null,
    staffCount: params.staffCount,
  });
  expect(shown).toBe(used);
});
```

- [ ] **Шаг 2: Запустить, убедиться что падает**

- [ ] **Шаг 3: Реализовать разбор**

Добавить `"staffing"` в `WIZARD_STEPS` между `params` и `compare`, разбор
`staffing=slug:n,slug:n` в `parseWizardParams`, сборку в `buildWizardQuery`. Формат выбран,
чтобы шаг жил в query и работал прежний механизм «назад» без состояния на сервере.

- [ ] **Шаг 4: Реализовать экран**

Поле на каждую применимую к типу объекта задачу, подписанное `taskLabel`. Предзаполненные —
с пометкой «по нормативу» и ссылкой на источник. Поля без норматива — пустые, с подсказкой
«введите, иначе задача не будет посчитана». Внизу остаток: «остальные N человек — не
роботизируем».

- [ ] **Шаг 5: e2e**

```bash
lsof -ti:3000 | xargs kill -9
npx playwright test e2e/staffing.spec.ts
```

Проверить: поле с нормативом предзаполнено и помечено, поле без норматива пусто; изменённое
число доходит до экрана расчёта.

- [ ] **Шаг 6: Коммит**

```bash
git add app/ lib/wizard/ e2e/
git commit -m "feat(wizard): шаг «кто чем занят» с предзаполнением по нормативу"
```

---

### Задача 10: Старые расчёты, паритет и полный прогон

**Файлы:**
- Изменить: `lib/analyses/diverged.test.ts`
- Изменить: `e2e/auth-report.spec.ts` и `e2e/wizard.spec.ts` (паритет живёт в них —
  отдельного `report-parity.spec.ts` в репозитории нет)
- Изменить: `CHANGELOG.md`

- [ ] **Шаг 1: Тест на расхождение старых расчётов**

`cap` и `params` — те же, что в задаче 6; вынести в общий хелпер, а не дублировать.

```ts
it("расчёт, сохранённый до появления занятости по задачам, помечается как разошедшийся", () => {
  const stored = { economical: true, displacedFte: 80, discountedPaybackYears: 0.026 };
  expect(resultsDiverged(stored, computeEconomics(cap, params, DEFAULT_ASSUMPTIONS, 6))).toBe(true);
});

it("расчёт, ставший неисчислимым без занятости, тоже помечается", () => {
  // Держится на двух ветках resultsDiverged сразу: сравнении economical (true → false) и
  // сравнении reason. Ни одна из них не писалась под этот случай.
  const stored = { economical: true, displacedFte: 80, discountedPaybackYears: 0.026 };
  expect(resultsDiverged(stored, computeEconomics(cap, params, DEFAULT_ASSUMPTIONS, null))).toBe(true);
});
```

- [ ] **Шаг 2: Расширить паритет панели и отчёта**

Занятость по задаче и число замещённых людей обязаны совпадать на экране расчёта и в отчёте.
Без этого тест продолжит проходить, перестав что-либо гарантировать.

- [ ] **Шаг 3: Полный прогон**

```bash
npx tsc --noEmit
npx --yes vitest run < /dev/null
lsof -ti:3000 | xargs kill -9
npx playwright test
npm run check:sources
```

Все четыре обязаны быть зелёными. **Прочитать вывод целиком, а не последнюю строку** — в этом
проекте уже коммитили с двумя падающими e2e, увидев «4 passed» и пропустив строку выше.

- [ ] **Шаг 4: Запись в CHANGELOG**

Одна запись на весь подпроект: что было (одиннадцать дней), какие три слоя разобраны, какие
два починены, какой оставлен сознательно и почему.

- [ ] **Шаг 5: Гейт подписи**

Задачи 6 и 8 изменили выходные числа. Показать владельцу: старые и новые числа на одном
сценарии, таблицу чувствительности к ставке, источники из задачи 1. Мерж `--no-ff` только
после подписи.

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): подпроект A — занятость по задачам и региональная ставка"
```
