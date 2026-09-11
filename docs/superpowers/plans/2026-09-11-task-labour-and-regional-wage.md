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

- **МЕНЯЕТ ВЫХОДНЫЕ ЧИСЛА.** Задачи 5 и 6 меняют результат расчёта. Обе требуют подписи
  владельца до мержа, как A1–A3.
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

Запись `⟦ЗАДАЧА-1: …⟧` встречается в задачах 2 и 6. Это **не пропуск в плане**, а гейт: число
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
| `lib/economics/calculate.ts` | *(правка)* `displacedFte = taskFte × coverage` |
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

- [ ] **Шаг 3: Гейт**

Показать собранную таблицу владельцу и получить подпись до перехода к задаче 5. Числа входят в
каждый расчёт продукта; заводить их без подтверждения нельзя.

- [ ] **Шаг 4: Коммит**

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

- [ ] **Шаг 7: Запустить тесты и сев**

```bash
npx --yes vitest run scripts/seed-data < /dev/null    # ожидается PASS
npm run db:seed                                        # ожидается без ошибок
```

- [ ] **Шаг 8: Коммит**

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

### Задача 4: `taskFte` и `taskStaffing` проходят границу сохранения

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

### Задача 5: Движок считает замещение от заявленной занятости — **МЕНЯЕТ ЧИСЛА**

**Файлы:**
- Изменить: `lib/economics/types.ts` (reason `"staffing_required"`)
- Изменить: `lib/economics/calculate.ts:23-90` (`baseEconomics`)
- Изменить: `lib/economics/normalize.ts:74-77` (комментарий к `workerOutputPerYear`)
- Изменить: `lib/economics/calculate.test.ts`
- Изменить: `lib/economics/workload-streams.test.ts`

**Интерфейсы:**
- Потребляет: `resolveTaskFte` (задача 3), `FacilityParams.taskStaffing` (задача 4),
  `SolutionCategory.workerOutputPerYear` (задача 2).
- Производит: `EconomicsResult` с новым вариантом `reason: "staffing_required"`.

**Эта задача меняет выходные числа и требует подписи владельца до мержа.**

- [ ] **Шаг 1: Написать падающий тест на воспроизведение бага**

В `lib/economics/calculate.test.ts`:

```ts
describe("замещение считается от занятости задачи, а не от всего штата", () => {
  // Воспроизведение: пищевое производство 7000 м², 15 000 операций/сутки, 80 человек,
  // паллетайзер за $12 143 при 600 коробок/час. До этой задачи движок возвращал
  // окупаемость 0,026 года — одиннадцать дней — потому что displacedFte упирался в 80.
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
    // способом получить любой желаемый NPV. Парк из одной машины вместо двух.
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
Ожидается: FAIL — четвёртый аргумент не существует.

- [ ] **Шаг 3: Добавить типизированный отказ**

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

- [ ] **Шаг 4: Изменить `baseEconomics`**

В `lib/economics/calculate.ts` добавить четвёртый обязательный параметр и заменить вывод
предела замещения:

```ts
export function baseEconomics(
  cap: SolutionCapacity,
  params: FacilityParams,
  a: AssumptionValues,
  // ОБЯЗАТЕЛЬНЫЙ параметр, и по той же причине, по которой обязателен stream у demandPerYear:
  // значение по умолчанию «ради совместимости» спрятало бы пропуск на половине вызовов.
  // null — занятость неизвестна, считать нельзя.
  taskFte: number | null
): BaseEconomics | null {
```

Внутри, вместо блока `perWorker` / `maxDisplaceableFte`:

```ts
  // Предел замещения больше не выводится из спроса. Он выводился делением спроса на одно
  // глобальное число на все задачи — 12 500 операций в год, то есть 6 операций в час.
  // Для отбора заказов правдоподобно; для укладки коробок человек делает 200–400 в час,
  // и ошибка в пятьдесят раз давала «паллетайзер замещает весь пищевой комбинат».
  //
  // Теперь занятость называет владелец объекта, а покрытие её масштабирует: парк, который
  // закрывает половину работы, освобождает половину людей.
  if (taskFte === null || !Number.isFinite(taskFte) || taskFte < 0) return null;
  const displacedFte = Math.max(0, Math.min(params.staffCount, taskFte * coverage));
```

Убрать из проверки вырожденности `!(perWorker > 0)` и сам вызов `workerOutputPerYear`.

В `computeEconomics` — пробросить параметр и различить два отказа:

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
  // …остальное без изменений
```

- [ ] **Шаг 5: Пометить `workerOutputPerYear` как больше не участвующий в расчёте**

В `lib/economics/normalize.ts:74-77` заменить комментарий:

```ts
/**
 * Сколько работы ЭТОГО потока делает один человек за год.
 *
 * БОЛЬШЕ НЕ ДЕЛИТЕЛЬ ПРЕДЕЛА ЗАМЕЩЕНИЯ. Движок его не читает: замещение считается от
 * занятости, названной владельцем объекта (resolveTaskFte). Функция осталась только для
 * ПРЕДЗАПОЛНЕНИЯ поля занятости в визарде, где её значение видно и его можно поправить.
 * Если она снова появится в calculate.ts — это регрессия, ради которой писался весь
 * подпроект A.
 */
```

- [ ] **Шаг 6: Обновить все вызовы**

Компилятор перечислит их сам. Девять не-тестовых мест:
`lib/economics/sensitivity.ts`, `lib/economics/recommend.ts`, `lib/economics/breakeven.ts`,
`app/(wizard)/compare/[type]/page.tsx` (2), `app/(wizard)/calculate/[solutionId]/page.tsx`,
`app/(app)/report/[analysisId]/page.tsx`, `components/economics-calculator.tsx`.

В каждом — разрешить занятость через `resolveTaskFte` перед вызовом:

```ts
const taskFte = resolveTaskFte({
  declared: params.taskStaffing?.[category.slug],
  demandPerYear: demandPerYear(params, a, category.workloadStream),
  workerOutputPerYear: category.workerOutputPerYear ?? null,
  staffCount: params.staffCount,
});
```

- [ ] **Шаг 7: Прогнать весь набор тестов**

```bash
npx tsc --noEmit
npx --yes vitest run < /dev/null
```
Ожидается: компиляция чистая; тесты, завязанные на старые числа, падают — **это ожидаемо**,
задача меняет числа. Обновить ожидания в них, сверив каждое новое число вручную, а не
подгоняя под вывод.

- [ ] **Шаг 8: Проверка мутацией**

Заменить `taskFte * coverage` на `taskFte` и убедиться, что падает тест «половина парка
замещает вдвое меньше людей». Вернуть.

- [ ] **Шаг 9: Записать в CHANGELOG и закоммитить**

Запись обязана содержать: старое число (0,026 года), новое, и почему разница — это
исправление, а не регрессия.

```bash
git add lib/ CHANGELOG.md
git commit -m "fix(economics): замещение считается от занятости задачи (МЕНЯЕТ ЧИСЛА)"
```

---

### Задача 6: Региональная ставка труда — **МЕНЯЕТ ЧИСЛА**

**Файлы:**
- Изменить: `lib/economics/assumptions.ts:4` (`DEFAULT_ASSUMPTIONS.laborCostPerHourUsd`)
- Изменить: `scripts/seed.ts:31` (строка допущения)
- Изменить: `docs/data-provenance.md`

**Интерфейсы:**
- Потребляет: значение и ссылку из задачи 1.

**Меняет выходные числа, требует подписи.**

- [ ] **Шаг 1: Написать тест, фиксирующий связь ставки и источника**

В `lib/economics/assumptions.test.ts`:

```ts
it("ставка труда лежит в диапазоне, подтверждённом источником", () => {
  // Диапазон из docs/data-provenance.md. Тест существует, чтобы правка дефолта «на глаз»
  // не прошла молча: ставка — доминирующий рычаг всей модели, замена 15 на 6 сдвигает
  // медианную окупаемость в 2,4 раза по 39 комбинациям объект×задача.
  expect(DEFAULT_ASSUMPTIONS.laborCostPerHourUsd).toBeGreaterThanOrEqual(⟦ЗАДАЧА-1: нижняя граница⟧);
  expect(DEFAULT_ASSUMPTIONS.laborCostPerHourUsd).toBeLessThanOrEqual(⟦ЗАДАЧА-1: верхняя граница⟧);
});
```

- [ ] **Шаг 2: Запустить, убедиться что падает**

```bash
npx --yes vitest run lib/economics/assumptions < /dev/null
```
Ожидается: FAIL при значении 15.

- [ ] **Шаг 3: Заменить дефолт**

В `lib/economics/assumptions.ts` и `scripts/seed.ts` — значение из задачи 1, с комментарием,
называющим источник и дату. В `scripts/seed.ts` добавить `description` со ссылкой, чтобы она
была видна в панели допущений, а не только в коде.

- [ ] **Шаг 4: Пересев и полный прогон**

```bash
npm run db:seed
npx --yes vitest run < /dev/null
```
Тесты с зашитыми числами падут — обновить, сверяя вручную.

- [ ] **Шаг 5: Записать в CHANGELOG и закоммитить**

Приложить таблицу чувствительности из спеки: она показывает, что ставка — доминирующий
рычаг, и объясняет масштаб сдвига всех чисел.

```bash
git add lib/ scripts/ docs/ CHANGELOG.md
git commit -m "fix(economics): региональная ставка труда вместо западной (МЕНЯЕТ ЧИСЛА)"
```

---

### Задача 7: Шаг визарда «кто чем занят»

**Файлы:**
- Создать: `app/(wizard)/onboarding/staffing/page.tsx`
- Изменить: `lib/wizard/steps.ts`
- Изменить: `lib/wizard/steps.test.ts`
- Создать: `e2e/staffing.spec.ts`

**Интерфейсы:**
- Потребляет: `resolveTaskFte` (задача 3), `SolutionCategory.taskLabel` и норматив (задача 2).
- Производит: `taskStaffing` в query визарда и в сохранённых параметрах.

- [ ] **Шаг 1: Написать падающие тесты разбора шага**

В `lib/wizard/steps.test.ts`:

```ts
it("разбирает занятость по задачам из query", () => {
  const s = parseWizardParams(new URLSearchParams("staffing=class-palletizer:6,class-cleaning:4"));
  expect(s.taskStaffing).toEqual({ "class-palletizer": 6, "class-cleaning": 4 });
});

it("игнорирует негодные пары, а не роняет шаг", () => {
  const s = parseWizardParams(new URLSearchParams("staffing=a:6,b:,c:-1,:4,d:x"));
  expect(s.taskStaffing).toEqual({ a: 6 });
});

it("шаг занятости не считается пройденным, пока хотя бы одна задача не заполнена", () => {
  expect(parseWizardParams(new URLSearchParams("")).complete).toBe(false);
});
```

- [ ] **Шаг 2: Запустить, убедиться что падает**

```bash
npx --yes vitest run lib/wizard < /dev/null
```

- [ ] **Шаг 3: Реализовать разбор и шаг**

Добавить `"staffing"` в `WIZARD_STEPS` между `params` и `compare`, разбор `staffing=slug:n,slug:n`
в `parseWizardParams` и сборку в `buildWizardQuery`. Формат «слаг:число через запятую» выбран,
чтобы шаг оставался в query и работал прежний механизм «назад» без состояния на сервере.

- [ ] **Шаг 4: Реализовать экран**

`app/(wizard)/onboarding/staffing/page.tsx` — поле на каждую применимую к типу объекта задачу,
подписанное `taskLabel`. Предзаполнение через `resolveTaskFte` с `declared: undefined`; рядом с
предзаполненным полем — пометка «по нормативу» со ссылкой на источник. Поля без норматива —
пустые, с подсказкой «введите, иначе задача не будет посчитана». Внизу — остаток штата:
«остальные N человек — не роботизируем».

- [ ] **Шаг 5: e2e**

`e2e/staffing.spec.ts`: пройти визард до шага занятости, проверить что поле с нормативом
предзаполнено и помечено, поле без норматива пусто; изменить число, дойти до расчёта и
убедиться, что на экране расчёта видно именно введённое число, а не норматив.

```bash
lsof -ti:3000 | xargs kill -9
npx playwright test e2e/staffing.spec.ts
```

- [ ] **Шаг 6: Коммит**

```bash
git add app/ lib/wizard/ e2e/
git commit -m "feat(wizard): шаг «кто чем занят» с предзаполнением по нормативу"
```

---

### Задача 8: Старые расчёты, паритет и полный прогон

**Файлы:**
- Изменить: `lib/analyses/diverged.test.ts`
- Изменить: `e2e/auth-report.spec.ts` и `e2e/wizard.spec.ts` (паритет панели и отчёта живёт в них — отдельного `report-parity.spec.ts` в репозитории нет)
- Изменить: `CHANGELOG.md`

- [ ] **Шаг 1: Тест на расхождение старых расчётов**

`cap` и `params` — те же, что в блоке задачи 5; вынести их в общий хелпер теста, а не
дублировать.

```ts
it("расчёт, сохранённый до появления занятости по задачам, помечается как разошедшийся", () => {
  // Задачи 5 и 6 меняют числа, поэтому каждый сохранённый до них расчёт обязан показать
  // баннер «модель расчёта изменилась». Молчание здесь означало бы, что человек открывает
  // отчёт с числами, которых движок больше не производит.
  const stored = { economical: true, displacedFte: 80, discountedPaybackYears: 0.026 };
  const now = computeEconomics(cap, params, DEFAULT_ASSUMPTIONS, 6);
  expect(resultsDiverged(stored, now)).toBe(true);
});
```

- [ ] **Шаг 2: Расширить тест паритета панели и отчёта**

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
Все четыре обязаны быть зелёными.

- [ ] **Шаг 4: Запись в CHANGELOG**

Одна запись на весь подпроект: что было (одиннадцать дней), какие три слоя разобраны, какие
два починены, какой оставлен сознательно и почему.

- [ ] **Шаг 5: Гейт подписи**

Задачи 5 и 6 изменили выходные числа. Показать владельцу: старые и новые числа на одном
сценарии, таблицу чувствительности к ставке, источники из задачи 1. Мерж `--no-ff` только
после подписи.

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): подпроект A — занятость по задачам и региональная ставка"
```
