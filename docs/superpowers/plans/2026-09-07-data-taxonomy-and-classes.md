# План 1 из 3: данные — таксономия, классы решений, разворот категорий

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Расширить таксономию до ~12 отраслей / ~45 типов объектов, добавить ~12 классов
решений с честными диапазонами, и развернуть связь категорий так, чтобы рост был линейным.

**Architecture:** `SolutionCategory` перестаёт принадлежать одному типу объекта и становится
глобальным каталогом видов решений; применимость выражается join-таблицей
`FacilityTypeCategory`. Класс решения — это строка `Solution` с `isClass = true`,
`priceEstimated = true` и диапазонами цены и производительности. Движок `lib/economics`
не трогается: класс проходит через тот же `toSolutionCapacity()`, что и вендорская модель.

**Tech Stack:** Prisma 7 (driver adapter `@prisma/adapter-pg`), Postgres 16, Vitest, tsx.

**Spec:** `docs/superpowers/specs/2026-09-07-wizard-and-taxonomy-design.md`

## Global Constraints

- **Ни одно выходное число экономики не меняется.** Если тест в `lib/economics/**` или
  `lib/scene/**` приходится подкрутить — **остановиться и доложить**: значит план залез в модель.
- **Тесты в `lib/analyses/actions.test.ts` изменятся законно, и только они.** Задача 3 меняет
  механизм проверки типа объекта при сохранении, поэтому её тесты переписываются осознанно.
  Это единственное место в плане, где правка существующего теста ожидаема.
- **`lib/economics/**` не редактируется в этом плане вообще.**
- **URL сохраняются:** `/compare/[type]`, `/calculate/[solutionId]`, `/report/[analysisId]`.
- **Скрипты, запускаемые через tsx (`scripts/**`), используют ОТНОСИТЕЛЬНЫЕ импорты**, не `@/`.
  Алиас `@/` там не резолвится.
- **Локальная БД на порту 5433** (docker compose), не 5432.
- **Vitest запускать как `npx --yes vitest run < /dev/null`** — без `< /dev/null` раннер ждёт
  stdin и выглядит зависшим.
- **Перед e2e убивать сервер на :3000** (`lsof -ti:3000 | xargs kill -9`), иначе Playwright
  переиспользует его и тестирует старую сборку.
- **Никаких выдуманных спек и цен.** Классы решений — только диапазоны из открытых источников,
  каждый с `sourceUrl` и `lastVerified`. Конкретные вендорские модели в этом плане не
  добавляются.
- **Ветка `wizard-taxonomy`. Никогда не коммитить в master.** Один коммит на задачу.
- Хвост коммита: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

---

## Поправки, найденные при исполнении

Записаны по ходу работы, чтобы следующий исполнитель не наступил на то же.

**Задачи 1–4 не могут быть зелёными по отдельности и едут одним коммитом.** Изменение схемы
ломает `getCatalogForFacilityType`, `getSolutionForCalc`, страницу расчёта, отчёт, сохранение
анализа и `scripts/seed.ts` **в тот же момент** — между задачей 1 и задачей 4 дерево не
компилируется вообще. Декомпозиция на четыре ревьюируемых куска была слишком мелкой для
изменения такой формы: ревьюер не может принять одну задачу и отклонить соседнюю, если ни одна
из них по отдельности не собирается. Адаптация сева (задача 6) по той же причине частично
переехала сюда: без неё не проходит `tsc`.

**`orderBy: { order: "asc" }` — это не порядок.** Поле `order` по умолчанию нулевое у всех
строк, поэтому сортировка категорий стала недетерминированной, каталог перетасовывался между
прогонами, и e2e-тест переключения решений упал: он берёт первое решение первой категории и
рассчитывает попасть в AS/RS, где есть соседи. Правильно —
`orderBy: [{ order: "asc" }, { category: { name: "asc" } }]`: имя как вторичный ключ
восстанавливает прежний порядок и оставляет место явному.

**Проверка миграции на копии боевой базы (задача 1, шаг 7) выполнена не через ветку Neon.**
Создание ветки требует консоли владельца. Вместо этого боевая база проверена на чтение: 8
категорий, 13 решений, 0 сохранённых анализов, 0 повторяющихся slug'ов — то есть она в точности
повторяет локальную, и локальный прогон её покрывает. **Как только в боевой базе появятся живые
анализы, проверка через ветку Neon становится обязательной** и её нельзя пропускать снова.

---

## Структура файлов

| Файл | Ответственность |
|---|---|
| `prisma/schema.prisma` | изменение: категория глобальная, join-таблица, поля класса |
| `prisma/migrations/*_global_categories/migration.sql` | создание: миграция, сохраняющая данные |
| `lib/db/queries.ts` | изменение: выборка решений через join |
| `lib/db/queries.test.ts` | изменение: тесты нового пути |
| `lib/analyses/actions.ts` | изменение: `facilityTypeSlug` валидируется, а не выводится |
| `app/(app)/report/[analysisId]/page.tsx` | изменение: тип объекта из сохранённого анализа |
| `app/(app)/calculate/[solutionId]/page.tsx` | изменение: тип объекта из URL |
| `scripts/seed.ts` | изменение: становится оркестратором |
| `scripts/seed-data/taxonomy.ts` | создание: отрасли и типы объектов |
| `scripts/seed-data/categories.ts` | создание: глобальный каталог видов решений |
| `scripts/seed-data/vendor-solutions.ts` | создание: существующие 13 вендорских решений |
| `scripts/seed-data/solution-classes.ts` | создание: классы с диапазонами и источниками |
| `scripts/seed-data/applicability.ts` | создание: какой вид решения к какому объекту |
| `scripts/seed-data/facility-params.ts` | создание: типовые параметры на тип объекта |
| `docs/data-provenance.md` | изменение: раздел про классы |
| `scripts/check-sources.ts` | изменение: покрытие классов |

---

### Задача 1: Схема — глобальные категории и join-таблица

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_global_categories/migration.sql`
- Test: `lib/db/queries.test.ts`

**Interfaces:**
- Produces: модель `FacilityTypeCategory { facilityTypeId, categoryId, order }`;
  `SolutionCategory.slug` становится глобально уникальным; у `FacilityType` появляется
  отношение `categories: FacilityTypeCategory[]`.

- [ ] **Шаг 1: Написать падающий тест**

В `lib/db/queries.test.ts` добавить:

```ts
describe("глобальные категории", () => {
  it("одна категория применима к нескольким типам объектов", async () => {
    const links = await prisma.facilityTypeCategory.findMany({
      where: { category: { slug: "amr" } },
      select: { facilityTypeId: true },
    });
    expect(links.length).toBeGreaterThan(0);
  });
});
```

Наверху файла добавить `import { prisma } from "./client";`, если его там ещё нет.

- [ ] **Шаг 2: Запустить тест и убедиться, что он падает**

Запуск: `npx --yes vitest run lib/db/queries.test.ts < /dev/null`
Ожидание: FAIL — `prisma.facilityTypeCategory` не существует.

- [ ] **Шаг 3: Изменить схему**

В `prisma/schema.prisma` заменить модель `SolutionCategory` и поправить `FacilityType`:

```prisma
model FacilityType {
  id               String                 @id @default(cuid())
  slug             String                 @unique
  name             String
  isGeneric        Boolean                @default(false)
  industryId       String
  industry         Industry               @relation(fields: [industryId], references: [id])
  categories       FacilityTypeCategory[]
  facilityExamples FacilityExample[]
}

model SolutionCategory {
  id            String                 @id @default(cuid())
  // Раньше slug был уникален внутри типа объекта, потому что категория ему принадлежала.
  // Теперь категория — глобальный каталог видов решений, применимость выражается join'ом.
  slug          String                 @unique
  name          String
  description   String
  solutions     Solution[]
  facilityTypes FacilityTypeCategory[]
}

model FacilityTypeCategory {
  facilityTypeId String
  facilityType   FacilityType     @relation(fields: [facilityTypeId], references: [id], onDelete: Cascade)
  categoryId     String
  category       SolutionCategory @relation(fields: [categoryId], references: [id], onDelete: Cascade)
  order          Int              @default(0)

  @@id([facilityTypeId, categoryId])
  @@index([categoryId])
}
```

- [ ] **Шаг 4: Написать миграцию вручную**

Создать `prisma/migrations/20260907120000_global_categories/migration.sql`. **Не генерировать
через `migrate dev`** — автогенерация удалит колонку вместе с данными о применимости.

```sql
CREATE TABLE "FacilityTypeCategory" (
  "facilityTypeId" TEXT NOT NULL,
  "categoryId" TEXT NOT NULL,
  "order" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "FacilityTypeCategory_pkey" PRIMARY KEY ("facilityTypeId","categoryId")
);

-- Канонической категорией для slug считаем строку с наименьшим id.
CREATE TEMP TABLE canon AS
  SELECT slug, MIN(id) AS canonical_id FROM "SolutionCategory" GROUP BY slug;

-- Слияние категорий может столкнуть два решения с одинаковым именем в одну категорию,
-- а на Solution висит @@unique([solutionCategoryId, name]). Проверяем ДО изменений:
-- лучше остановить деплой, чем молча потерять строку.
DO $$
DECLARE conflicts INT;
BEGIN
  SELECT count(*) INTO conflicts FROM (
    SELECT c.canonical_id, s.name
    FROM "Solution" s
    JOIN "SolutionCategory" sc ON sc.id = s."solutionCategoryId"
    JOIN canon c ON c.slug = sc.slug
    GROUP BY c.canonical_id, s.name
    HAVING count(*) > 1
  ) x;
  IF conflicts > 0 THEN
    RAISE EXCEPTION 'Слияние категорий даёт % конфликтов (категория, имя решения). Разрешите вручную до миграции.', conflicts;
  END IF;
END $$;

-- Применимость переносится из старой колонки.
INSERT INTO "FacilityTypeCategory" ("facilityTypeId","categoryId")
  SELECT DISTINCT sc."facilityTypeId", c.canonical_id
  FROM "SolutionCategory" sc
  JOIN canon c ON c.slug = sc.slug;

-- Решения переезжают на канонические категории.
UPDATE "Solution" s
  SET "solutionCategoryId" = c.canonical_id
  FROM "SolutionCategory" sc
  JOIN canon c ON c.slug = sc.slug
  WHERE s."solutionCategoryId" = sc.id AND sc.id <> c.canonical_id;

DELETE FROM "SolutionCategory" sc
  USING canon c
  WHERE c.slug = sc.slug AND sc.id <> c.canonical_id;

ALTER TABLE "SolutionCategory" DROP CONSTRAINT "SolutionCategory_facilityTypeId_fkey";
DROP INDEX "SolutionCategory_facilityTypeId_slug_key";
ALTER TABLE "SolutionCategory" DROP COLUMN "facilityTypeId";
CREATE UNIQUE INDEX "SolutionCategory_slug_key" ON "SolutionCategory"("slug");

ALTER TABLE "FacilityTypeCategory"
  ADD CONSTRAINT "FacilityTypeCategory_facilityTypeId_fkey"
  FOREIGN KEY ("facilityTypeId") REFERENCES "FacilityType"("id") ON DELETE CASCADE;
ALTER TABLE "FacilityTypeCategory"
  ADD CONSTRAINT "FacilityTypeCategory_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "SolutionCategory"("id") ON DELETE CASCADE;
CREATE INDEX "FacilityTypeCategory_categoryId_idx" ON "FacilityTypeCategory"("categoryId");
```

- [ ] **Шаг 5: Применить и проверить, что данные уцелели**

```bash
npx prisma migrate deploy
npx prisma generate
```

Ожидание: `All migrations have been successfully applied.` Затем проверить, что 8 категорий
на месте и у каждой ровно одна связь (на текущих данных пересечений slug'ов нет, поэтому
слияние — no-op):

```bash
npx prisma studio   # или SQL: SELECT count(*) FROM "SolutionCategory"; -- ожидается 8
```

- [ ] **Шаг 6: Запустить тест — он должен пройти**

Запуск: `npx --yes vitest run lib/db/queries.test.ts < /dev/null`
Ожидание: PASS.

- [ ] **Шаг 7: Проверить миграцию на копии боевой базы**

Спека требует этого явно, и не зря: пустая локальная база не содержит строк, которые миграция
двигает. Боевая база — Neon, подключена к развёрнутому приложению; её прямая (непулинговая)
строка подключения лежит в `.env.deploy` как `DATABASE_URL_UNPOOLED`.

**Не прогонять миграцию по боевой базе напрямую.** Сделать ветку базы в Neon
(Dashboard → Branches → Create branch) — это копия данных за секунды — и применить миграцию
к ней:

```bash
DATABASE_URL="<строка ветки Neon>" npx prisma migrate deploy
DATABASE_URL="<строка ветки Neon>" npx prisma migrate status
```

Ожидание: `All migrations have been successfully applied.` без `RAISE EXCEPTION`. Если
исключение сработало — значит в боевых данных есть конфликт имён решений внутри сливаемой
категории; разрешить его отдельной миграцией данных **до** этой, а не ослаблять проверку.
После проверки ветку Neon удалить.

- [ ] **Шаг 8: Коммит**

```bash
git add prisma/schema.prisma prisma/migrations lib/db/queries.test.ts
git commit -m "feat(db): категории становятся глобальными, применимость — через join

SolutionCategory принадлежала одному типу объекта, поэтому при 45 типах категорию
пришлось бы завести 45 раз, а каждый класс решения продублировать в каждую.
Миграция сохраняет применимость в FacilityTypeCategory и останавливается с явной
ошибкой, если слияние категорий столкнёт два решения с одинаковым именем.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Задача 2: Выборка решений для типа объекта через join

**Files:**
- Modify: `lib/db/queries.ts`
- Modify: `lib/db/queries.test.ts`
- Modify: `app/(app)/compare/[type]/page.tsx`

**Interfaces:**
- Consumes: `FacilityTypeCategory` из задачи 1.
- Produces: `getCatalogForFacilityType(slug)` возвращает объект той же формы, что и раньше —
  `{ id, slug, name, industry, solutionCategories: Array<{ id, slug, name, description, solutions: Solution[] }> }`.
  Форма сохраняется намеренно, чтобы страница сравнения не переписывалась.

- [ ] **Шаг 1: Написать падающий тест**

В `lib/db/queries.test.ts`, внутрь `describe("getCatalogForFacilityType")`:

```ts
it("отдаёт категории через join и сохраняет прежнюю форму ответа", async () => {
  const catalog = await getCatalogForFacilityType("warehouse");
  expect(catalog).not.toBeNull();
  expect(catalog!.industry.name).toBeTruthy();
  const slugs = catalog!.solutionCategories.map((c) => c.slug);
  expect(slugs).toContain("amr");
  const amr = catalog!.solutionCategories.find((c) => c.slug === "amr")!;
  expect(amr.solutions.length).toBeGreaterThan(0);
  expect(amr.solutions[0]!.name).toBeTruthy();
});
```

- [ ] **Шаг 2: Запустить и убедиться, что падает**

Запуск: `npx --yes vitest run lib/db/queries.test.ts < /dev/null`
Ожидание: FAIL — `solutionCategories` больше не существует как отношение.

- [ ] **Шаг 3: Переписать запрос**

В `lib/db/queries.ts` заменить `getCatalogForFacilityType`:

```ts
export async function getCatalogForFacilityType(facilityTypeSlug: string) {
  const facilityType = await prisma.facilityType.findUnique({
    where: { slug: facilityTypeSlug },
    include: {
      industry: true,
      categories: {
        orderBy: { order: "asc" },
        include: {
          category: {
            include: { solutions: { orderBy: { name: "asc" } } },
          },
        },
      },
    },
  });
  if (!facilityType) return null;

  // Форма ответа намеренно совпадает с прежней: страница сравнения читает
  // `solutionCategories`, и менять её в этом плане нечего — она переписывается в плане 3.
  const { categories, ...rest } = facilityType;
  return {
    ...rest,
    solutionCategories: categories.map((link) => link.category),
  };
}
```

- [ ] **Шаг 4: Запустить — должно пройти**

Запуск: `npx --yes vitest run lib/db/queries.test.ts < /dev/null`
Ожидание: PASS.

- [ ] **Шаг 5: Прогнать весь набор — ничего не должно сломаться**

Запуск: `npx --yes vitest run < /dev/null && npx tsc --noEmit`
Ожидание: 238+ тестов зелёные, 0 ошибок типов.

- [ ] **Шаг 6: Коммит**

```bash
git add lib/db/queries.ts lib/db/queries.test.ts
git commit -m "feat(db): каталог типа объекта собирается через join категорий

Форма ответа сохранена намеренно — страница сравнения читает solutionCategories и
переписывается отдельным планом.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Задача 3: `facilityTypeSlug` при сохранении — валидировать, а не выводить

**Files:**
- Modify: `lib/db/queries.ts` (новая функция `getSolutionApplicability`)
- Modify: `lib/analyses/actions.ts:36-40`
- Modify: `lib/analyses/actions.test.ts`

**Interfaces:**
- Produces: `getSolutionApplicability(solutionId): Promise<string[]>` — slug'и типов объектов,
  к которым применимо решение (через категорию решения и join).

**Почему это отдельная задача.** Сейчас `lib/analyses/actions.ts:38` делает
`const facilityTypeSlug = solution.solutionCategory.facilityType.slug` — то есть **выводит**
тип объекта из решения и намеренно игнорирует то, что прислал клиент. Это защита от подмены,
и в CHANGELOG она зафиксирована как таковая. После разворота у решения нет одного типа
объекта, и наивная правка («взять из запроса») молча превратит защиту в доверие к клиенту.
Правильная замена — не выводить, а **проверять принадлежность к множеству применимых**.

- [ ] **Шаг 1: Написать падающий тест**

В `lib/analyses/actions.test.ts`:

Файл уже устроен так: хелпер называется `payload(over)`, id решения лежит в переменной
`solutionId`, а `saveAnalysisAction` принимает **один** аргумент. Использовать это, не заводя
новых хелперов:

```ts
it("отклоняет тип объекта, к которому решение неприменимо", async () => {
  const res = await saveAnalysisAction(payload({ facilityTypeSlug: "attacker-supplied" }));
  expect(res.ok).toBe(false);
});

it("принимает любой применимый тип объекта, а не только один", async () => {
  const slugs = await getSolutionApplicability(solutionId);
  expect(slugs.length).toBeGreaterThan(0);
  const res = await saveAnalysisAction(payload({ facilityTypeSlug: slugs[0]! }));
  expect(res.ok).toBe(true);
});
```

**Три существующих места в этом файле сломаются, и это ожидаемо:**

1. Строка 30, `realSlug = sol.solutionCategory.facilityType.slug` — после задачи 1 такого пути
   нет. Заменить на `realSlug = (await getSolutionApplicability(sol.id))[0]!`.
2. Дефолт хелпера `payload()` — `facilityTypeSlug: "whatever-the-client-claims"`. По новому
   правилу он отклоняется, из-за чего падают **все** тесты, использующие дефолт. Заменить
   дефолт на `realSlug`.
3. Тест `"derives facilityTypeSlug from the solution, ignoring the client's claim"` проверяет
   именно тот механизм, который мы заменяем. **Переписать, а не удалить** — свойство «клиенту
   не верим» обязано остаться под тестом, меняется только способ его обеспечения.

- [ ] **Шаг 2: Запустить и убедиться, что падает**

Запуск: `npx --yes vitest run lib/analyses/actions.test.ts < /dev/null`
Ожидание: FAIL — `getSolutionApplicability` не существует.

- [ ] **Шаг 3: Добавить запрос**

В `lib/db/queries.ts`:

```ts
/**
 * Типы объектов, к которым применимо решение: через его категорию и join применимости.
 * Заменяет прежний вывод facilityTypeSlug напрямую из решения — после разворота категорий
 * у решения нет одного типа объекта, но множество допустимых остаётся проверяемым, и
 * заявленное клиентом значение по-прежнему не принимается на веру.
 */
export async function getSolutionApplicability(solutionId: string): Promise<string[]> {
  const rows = await prisma.facilityTypeCategory.findMany({
    where: { category: { solutions: { some: { id: solutionId } } } },
    select: { facilityType: { select: { slug: true } } },
  });
  return rows.map((r) => r.facilityType.slug);
}
```

- [ ] **Шаг 4: Заменить вывод на проверку**

В `lib/analyses/actions.ts` заменить строку вывода `facilityTypeSlug`:

```ts
// Раньше здесь slug ВЫВОДИЛСЯ из решения, чтобы не верить клиенту. Категория больше не
// принадлежит одному типу объекта, поэтому вывести неоткуда — но верить клиенту по-прежнему
// нельзя. Проверяем принадлежность к множеству применимых.
const applicable = await getSolutionApplicability(input.solutionId);
const claimed = String(input.facilityTypeSlug ?? "");
if (!applicable.includes(claimed)) {
  return { ok: false, error: "Решение неприменимо к указанному типу объекта" };
}
const facilityTypeSlug = claimed;
```

Импорт `getSolutionApplicability` добавить в существующую строку импорта из `@/lib/db/queries`.

- [ ] **Шаг 5: Запустить тесты**

Запуск: `npx --yes vitest run lib/analyses/actions.test.ts < /dev/null`
Ожидание: PASS, включая уже существовавший тест
«derives facilityTypeSlug from the solution, ignoring the client's claim» — если он теперь
проверяет неверное поведение, **переписать его под новое правило, а не удалять**: свойство
«клиенту не верим» сохраняется, меняется механизм.

- [ ] **Шаг 6: Коммит**

```bash
git add lib/db/queries.ts lib/analyses/actions.ts lib/analyses/actions.test.ts
git commit -m "fix(security): тип объекта при сохранении проверяется, а не выводится

Вывод facilityTypeSlug из решения был защитой от подмены. После разворота категорий
выводить неоткуда, но доверять клиенту нельзя: заявленный slug теперь обязан входить
в множество применимых к решению типов объектов.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Задача 4: Отчёт и страница расчёта — тип объекта из своего источника

**Files:**
- Modify: `app/(app)/report/[analysisId]/page.tsx:41`
- Modify: `app/(app)/calculate/[solutionId]/page.tsx:59-61`
- Modify: `lib/db/queries.ts` (`getSolutionForCalc`)
- Modify: `lib/db/queries.test.ts:52`

**Interfaces:**
- Produces: `getSolutionForCalc(id)` больше не включает `solutionCategory.facilityType`;
  включает только `solutionCategory: { id, slug, name }`.
- Produces: `getFacilityTypeBySlug(slug): Promise<{ slug, name, industry: { name } } | null>`.

- [ ] **Шаг 1: Написать падающий тест**

```ts
it("getFacilityTypeBySlug отдаёт название объекта и отрасли", async () => {
  const ft = await getFacilityTypeBySlug("warehouse");
  expect(ft).not.toBeNull();
  expect(ft!.name).toBeTruthy();
  expect(ft!.industry.name).toBeTruthy();
});
```

- [ ] **Шаг 2: Запустить и убедиться, что падает**

Запуск: `npx --yes vitest run lib/db/queries.test.ts < /dev/null`
Ожидание: FAIL — функции нет.

- [ ] **Шаг 3: Реализовать и снять устаревший include**

```ts
export async function getFacilityTypeBySlug(slug: string) {
  return prisma.facilityType.findUnique({
    where: { slug },
    select: { slug: true, name: true, industry: { select: { name: true } } },
  });
}
```

и в `getSolutionForCalc` заменить include на:

```ts
    include: { solutionCategory: { select: { id: true, slug: true, name: true } } },
```

- [ ] **Шаг 4: Починить потребителей**

В `app/(app)/report/[analysisId]/page.tsx` заменить `solution.solutionCategory.facilityType`
на данные, полученные по `saved.facilityTypeSlug` — он **уже хранится в сохранённом анализе**
и является правильным источником: отчёт обязан показывать тот объект, для которого расчёт
делался, а не тот, который применим сегодня.

```ts
const ft = await getFacilityTypeBySlug(saved.facilityTypeSlug);
```

В `app/(app)/calculate/[solutionId]/page.tsx` тип объекта берётся из query-строки
(`searchParams.facility`), с фолбэком на первый применимый, если параметра нет:

```ts
const applicable = await getSolutionApplicability(solutionId);
const facilitySlug = applicable.includes(String(searchParams.facility ?? ""))
  ? String(searchParams.facility)
  : applicable[0];
const facilityType = facilitySlug ? await getFacilityTypeBySlug(facilitySlug) : null;
```

Поправить `lib/db/queries.test.ts:52`, где проверялось
`sol!.solutionCategory.facilityType.slug`.

- [ ] **Шаг 5: Прогнать всё**

Запуск: `npx --yes vitest run < /dev/null && npx tsc --noEmit && npm run build`
Ожидание: тесты зелёные, 0 ошибок типов, сборка проходит.

- [ ] **Шаг 6: Коммит**

```bash
git add app lib
git commit -m "fix: тип объекта берётся из сохранённого анализа и из URL, не из решения

Отчёт обязан показывать объект, для которого расчёт делался, — он хранится в самом
анализе. Страница расчёта берёт объект из query-строки и проверяет применимость.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Задача 5: Поля класса решения

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_solution_class_fields/migration.sql`
- Test: `lib/db/queries.test.ts`

**Interfaces:**
- Produces: `Solution.isClass: boolean`, `Solution.capacityLow: number | null`,
  `Solution.capacityHigh: number | null`.

- [ ] **Шаг 1: Написать падающий тест**

```ts
it("класс решения помечен и несёт диапазон производительности", async () => {
  const cls = await prisma.solution.findFirst({ where: { isClass: true } });
  if (cls) {
    expect(cls.priceEstimated).toBe(true);
    expect(cls.capacityLow).not.toBeNull();
    expect(cls.capacityHigh).not.toBeNull();
    expect(cls.capacityPerUnit).toBeGreaterThanOrEqual(cls.capacityLow!);
    expect(cls.capacityPerUnit).toBeLessThanOrEqual(cls.capacityHigh!);
  }
});
```

- [ ] **Шаг 2: Запустить и убедиться, что падает**

Запуск: `npx --yes vitest run lib/db/queries.test.ts < /dev/null`
Ожидание: FAIL — поля `isClass` не существует.

- [ ] **Шаг 3: Добавить поля**

В `prisma/schema.prisma`, в модель `Solution`, рядом с ценовым диапазоном:

```prisma
  // Класс решения, а не конкретная модель: обобщённый вид техники с диапазонами вместо
  // точных значений. Интерфейс обязан говорить об этом явно и не выдавать класс за продукт.
  isClass      Boolean @default(false)
  capacityLow  Float?
  capacityHigh Float?
```

- [ ] **Шаг 4: Сгенерировать миграцию**

```bash
npx prisma migrate dev --name solution_class_fields --create-only
npx prisma migrate deploy
npx prisma generate
```

Здесь автогенерация безопасна: добавляются nullable-колонки и boolean с default, данные не
двигаются.

- [ ] **Шаг 5: Запустить тест**

Запуск: `npx --yes vitest run lib/db/queries.test.ts < /dev/null`
Ожидание: PASS (тест проходит вхолостую, пока классов нет — наполнение в задаче 8).

- [ ] **Шаг 6: Коммит**

```bash
git add prisma
git commit -m "feat(db): поля класса решения — isClass и диапазон производительности

Зеркально уже существующему ценовому диапазону: середина лежит в capacityPerUnit,
поэтому движок принимает класс тем же toSolutionCapacity(), что и вендорскую модель.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Задача 6: Разбить seed на модули (чистый рефактор)

**Files:**
- Create: `scripts/seed-data/taxonomy.ts`, `scripts/seed-data/categories.ts`,
  `scripts/seed-data/applicability.ts`, `scripts/seed-data/vendor-solutions.ts`
- Modify: `scripts/seed.ts`

**Interfaces:**
- Produces: `INDUSTRIES: IndustrySeed[]` (отрасли + типы объектов, без категорий);
  `CATEGORIES: CategorySeed[]` (`{ slug, name, description }`, глобальные);
  `APPLICABILITY: Array<{ facilityType: string; categories: string[] }>`;
  `SOLUTIONS: Array<SolutionSeed & { categorySlug: string }>`.

**Данные в этой задаче не меняются** — те же 4 отрасли, 4 типа, 8 категорий, 13 решений,
просто разложенные по новой форме. Это гарантирует, что следующий шаг (наполнение) не
смешается с рефакторингом.

- [ ] **Шаг 1: Написать тест на неизменность результата сева**

Создать `scripts/seed-data/seed-data.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { INDUSTRIES } from "./taxonomy";
import { CATEGORIES } from "./categories";
import { APPLICABILITY } from "./applicability";

describe("целостность посевных данных", () => {
  it("каждая связь применимости ссылается на существующие тип объекта и категорию", () => {
    const types = new Set(INDUSTRIES.flatMap((i) => i.facilityTypes.map((f) => f.slug)));
    const cats = new Set(CATEGORIES.map((c) => c.slug));
    for (const link of APPLICABILITY) {
      expect(types.has(link.facilityType), `нет типа объекта ${link.facilityType}`).toBe(true);
      for (const c of link.categories) {
        expect(cats.has(c), `нет категории ${c}`).toBe(true);
      }
    }
  });

  it("slug'и типов объектов и категорий уникальны", () => {
    const types = INDUSTRIES.flatMap((i) => i.facilityTypes.map((f) => f.slug));
    expect(new Set(types).size).toBe(types.length);
    const cats = CATEGORIES.map((c) => c.slug);
    expect(new Set(cats).size).toBe(cats.length);
  });
});
```

- [ ] **Шаг 2: Запустить и убедиться, что падает**

Запуск: `npx --yes vitest run scripts/seed-data < /dev/null`
Ожидание: FAIL — модулей нет.

- [ ] **Шаг 3: Разложить существующие данные по модулям**

Перенести из `scripts/seed.ts` без изменения значений. **Импорты внутри `scripts/` —
относительные** (`./taxonomy`, не `@/scripts/...`): алиас `@/` под tsx не резолвится.

- [ ] **Шаг 4: Переписать `seed.ts` как оркестратор**

Порядок операций: отрасли → типы объектов → категории → связи применимости → решения.
Все upsert'ы, как сейчас; блок удаления устаревших решений с проверкой `savedAnalyses`
сохранить как есть — он защищает от падения на FK `onDelete: Restrict`.

- [ ] **Шаг 5: Прогнать сев и убедиться, что итог не изменился**

```bash
npm run db:seed
```
Ожидание: `Seeded 4 industries, 4 facility types, 8 solution categories, 13 solutions, 14 assumptions.`
— ровно те же числа, что и до рефакторинга.

- [ ] **Шаг 6: Прогнать весь набор**

Запуск: `npx --yes vitest run < /dev/null`
Ожидание: все зелёные.

- [ ] **Шаг 7: Коммит**

```bash
git add scripts
git commit -m "refactor(seed): разложить посевные данные по модулям

Данные не менялись — те же 4 отрасли, 4 типа, 8 категорий, 13 решений в новой форме,
чтобы наполнение следующим шагом не смешалось с рефакторингом.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Задача 7: Таксономия — ~12 отраслей и ~45 типов объектов

**Files:**
- Modify: `scripts/seed-data/taxonomy.ts`
- Create: `scripts/seed-data/facility-params.ts`
- Modify: `scripts/seed-data/seed-data.test.ts`

**Interfaces:**
- Consumes: `IndustrySeed` из задачи 6.
- Produces: `TYPICAL_PARAMS: Record<string, { areaM2: number; opsPerDay: number; staffCount: number }>`
  — ключ равен slug'у типа объекта; попадает в `FacilityExample.params`.

**Это самая трудоёмкая задача плана, и её нельзя генерировать пачкой.** Каждый тип объекта
несёт решение о единицах измерения и о том, каким базисом (`PER_HOUR_FLOW`, `PER_DAY_FLOW`,
`CONCURRENT_STOCK`) описывается его нагрузка. Ошибка здесь портит сортировку в сравнении, и
заметить её по зелёным тестам невозможно.

- [ ] **Шаг 1: Написать тест на полноту**

```ts
it("у каждого типа объекта есть типовые параметры", () => {
  const types = INDUSTRIES.flatMap((i) => i.facilityTypes.map((f) => f.slug));
  for (const t of types) {
    const p = TYPICAL_PARAMS[t];
    expect(p, `нет типовых параметров для ${t}`).toBeDefined();
    expect(p!.areaM2).toBeGreaterThan(0);
    expect(p!.opsPerDay).toBeGreaterThan(0);
    expect(p!.staffCount).toBeGreaterThan(0);
  }
});

it("отраслей около двенадцати, типов объектов около сорока пяти", () => {
  expect(INDUSTRIES.length).toBeGreaterThanOrEqual(10);
  const types = INDUSTRIES.flatMap((i) => i.facilityTypes);
  expect(types.length).toBeGreaterThanOrEqual(40);
});
```

- [ ] **Шаг 2: Запустить и убедиться, что падает**

Запуск: `npx --yes vitest run scripts/seed-data < /dev/null`
Ожидание: FAIL — отраслей 4, типовых параметров нет.

- [ ] **Шаг 3: Наполнить таксономию**

Двенадцать отраслей: торговля и e-commerce; дискретное производство; пищевое производство;
фармацевтика; логистика и 3PL; транспортные узлы; здравоохранение; сельское хозяйство;
горнодобыча; строительство; коммунальное хозяйство; гостеприимство. Для каждой — 3–5 типов
объектов плюс один обобщённый с `isGeneric = true`.

**Каждый тип объекта записывается со своим базисом и единицей измерения** — это решение, а не
метаданные: от базиса зависит, как движок считает потребность, и ошибка здесь тихо портит
сортировку в сравнении. Форма записи, полностью раскрытая на первой отрасли как образец:

```ts
export const INDUSTRIES: IndustrySeed[] = [
  {
    slug: "retail",
    name: "Торговля и e-commerce",
    facilityTypes: [
      // basis/unit описывают НАГРУЗКУ объекта, а не решение: «сколько работы в сутки».
      { slug: "warehouse",        name: "Склад",                    isGeneric: false, basis: "PER_DAY_FLOW",     unit: "заказов/сутки" },
      { slug: "fulfillment",      name: "Фулфилмент-центр",         isGeneric: false, basis: "PER_DAY_FLOW",     unit: "отправлений/сутки" },
      { slug: "darkstore",        name: "Дарксторе",                isGeneric: false, basis: "PER_DAY_FLOW",     unit: "сборок/сутки" },
      { slug: "cold-storage",     name: "Холодильный склад",        isGeneric: false, basis: "CONCURRENT_STOCK", unit: "паллетомест" },
      { slug: "retail-generic",   name: "Другой объект торговли",   isGeneric: true,  basis: "PER_DAY_FLOW",     unit: "операций/сутки" },
    ],
  },
  // остальные одиннадцать отраслей — в этой же форме
];
```

`CONCURRENT_STOCK` ставится только там, где нагрузка описывается **запасом**, а не потоком
(хранение, парковка, палаты). Если сомневаетесь между потоком и запасом — это поток.

Существующие четыре отрасли и их типы **сохраняются со своими slug'ами** (`warehouse`,
`airport`, `medical`, `other` и их отрасли): на них ссылаются сохранённые анализы через
`SavedAnalysis.facilityTypeSlug`, а это строка, а не внешний ключ, — переименование осиротит
чужие сохранённые расчёты молча.

- [ ] **Шаг 4: Записать типовые параметры и посеять их в `FacilityExample`**

В `scripts/seed.ts`, после создания типов объектов:

```ts
for (const [slug, params] of Object.entries(TYPICAL_PARAMS)) {
  const ft = await prisma.facilityType.findUnique({ where: { slug } });
  if (!ft) continue;
  const existing = await prisma.facilityExample.findFirst({
    where: { facilityTypeId: ft.id, name: "Типовой объект" },
  });
  if (existing) {
    await prisma.facilityExample.update({ where: { id: existing.id }, data: { params } });
  } else {
    await prisma.facilityExample.create({
      data: { name: "Типовой объект", facilityTypeId: ft.id, params },
    });
  }
}
```

- [ ] **Шаг 5: Прогнать сев и тесты**

```bash
npm run db:seed && npx --yes vitest run < /dev/null
```
Ожидание: счётчики выросли до ~12 отраслей и ~45 типов; все тесты зелёные.

- [ ] **Шаг 6: Коммит**

```bash
git add scripts
git commit -m "feat(data): таксономия расширена до ~12 отраслей и ~45 типов объектов

У каждого типа объекта есть типовые параметры в FacilityExample — шаг ввода
параметров получает осмысленные значения по умолчанию вместо пустых полей.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Задача 8: ~12 классов решений с диапазонами и источниками

**Files:**
- Create: `scripts/seed-data/solution-classes.ts`
- Modify: `scripts/seed.ts`
- Modify: `scripts/seed-data/seed-data.test.ts`

**Interfaces:**
- Produces: `SOLUTION_CLASSES: Array<{ slug, name, categorySlug, capacityLow, capacityHigh,
  capacityUnit, capacityBasis, priceLowUsd, priceHighUsd, maintenanceUsdYear, energyUsdYear,
  licensingUsdYear, sourceUrl, lastVerified }>`.

- [ ] **Шаг 1: Написать тест на достоверность**

```ts
it("у каждого класса есть диапазоны, источник и дата проверки", () => {
  for (const c of SOLUTION_CLASSES) {
    expect(c.priceLowUsd, `${c.slug}: нет нижней границы цены`).toBeGreaterThan(0);
    expect(c.priceHighUsd).toBeGreaterThan(c.priceLowUsd);
    expect(c.capacityLow).toBeGreaterThan(0);
    expect(c.capacityHigh).toBeGreaterThan(c.capacityLow);
    expect(c.sourceUrl, `${c.slug}: нет источника`).toMatch(/^https?:\/\//);
    expect(new Date(c.lastVerified).getTime()).toBeGreaterThan(0);
  }
});
```

- [ ] **Шаг 2: Запустить и убедиться, что падает**

Запуск: `npx --yes vitest run scripts/seed-data < /dev/null`
Ожидание: FAIL — модуля нет.

- [ ] **Шаг 3: Собрать диапазоны из открытых источников**

Классы-кандидаты: AMR-транспортировка; AGV-тягач; AS/RS шаттловое хранение; робот-паллетайзер;
сортировочный робот; кобот сборки; кобот упаковки; пик-энд-плейс; ИИ-инспекция качества;
робот-уборщик; робот дезинфекции; сервисный робот доставки.

**Правила, которые нельзя нарушать:** диапазон, а не точка; `sourceUrl` на страницу, где
диапазон реально указан; `lastVerified` — дата, когда исполнитель эту страницу открывал;
`priceEstimated = true` и `isClass = true` у всех; `vendor` — не имя вендора.
Если для класса не нашлось источника с диапазоном — **класс не заводится**, а не заводится
с выдуманными числами.

- [ ] **Шаг 4: Посеять классы**

Середина диапазона идёт в `priceUsd` и `capacityPerUnit` — та же конвенция, что уже
применяется к CAPEX «по середине диапазона»:

```ts
for (const c of SOLUTION_CLASSES) {
  const category = await prisma.solutionCategory.findUnique({ where: { slug: c.categorySlug } });
  if (!category) throw new Error(`Нет категории ${c.categorySlug} для класса ${c.slug}`);
  await prisma.solution.upsert({
    where: { solutionCategoryId_name: { solutionCategoryId: category.id, name: c.name } },
    update: { /* те же поля, что в create */ },
    create: {
      name: c.name,
      vendor: "—",
      isClass: true,
      solutionCategoryId: category.id,
      priceEstimated: true,
      priceLowUsd: c.priceLowUsd,
      priceHighUsd: c.priceHighUsd,
      priceUsd: (c.priceLowUsd + c.priceHighUsd) / 2,
      priceBasis: "середина диапазона по открытым источникам",
      capacityLow: c.capacityLow,
      capacityHigh: c.capacityHigh,
      capacityPerUnit: (c.capacityLow + c.capacityHigh) / 2,
      capacityUnit: c.capacityUnit,
      capacityBasis: c.capacityBasis,
      maintenanceUsdYear: c.maintenanceUsdYear,
      energyUsdYear: c.energyUsdYear,
      licensingUsdYear: c.licensingUsdYear,
      specs: {},
      source: SolutionSource.SEED,
      sourceUrl: c.sourceUrl,
      lastVerified: new Date(c.lastVerified),
    },
  });
}
```

- [ ] **Шаг 5: Прогнать сев и тесты**

```bash
npm run db:seed && npx --yes vitest run < /dev/null
```
Ожидание: тесты зелёные, включая тест из задачи 5, который теперь проверяет реальные строки.

- [ ] **Шаг 6: Коммит**

```bash
git add scripts
git commit -m "feat(data): классы решений с диапазонами и проверяемыми источниками

Диапазон честнее точки: он и есть признание неопределённости. Класс — строка Solution
с isClass и priceEstimated, поэтому движок принимает её без изменений.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Задача 9: Применимость, провенанс и проверка источников

**Files:**
- Modify: `scripts/seed-data/applicability.ts`
- Modify: `docs/data-provenance.md`
- Modify: `scripts/check-sources.ts`

- [ ] **Шаг 1: Написать тест на отсутствие пустых веток**

В `scripts/seed-data/seed-data.test.ts`:

```ts
it("у каждого типа объекта есть хотя бы одна применимая категория", () => {
  const types = INDUSTRIES.flatMap((i) => i.facilityTypes.map((f) => f.slug));
  const covered = new Set(APPLICABILITY.map((a) => a.facilityType));
  const uncovered = types.filter((t) => !covered.has(t));
  expect(uncovered, `типы объектов без решений: ${uncovered.join(", ")}`).toEqual([]);
});
```

Это и есть тест, который держит главное обещание расширения: **ни одна новая ветка не ведёт
в пустой экран.**

- [ ] **Шаг 2: Запустить и убедиться, что падает**

Запуск: `npx --yes vitest run scripts/seed-data < /dev/null`
Ожидание: FAIL со списком непокрытых типов объектов.

- [ ] **Шаг 3: Заполнить матрицу применимости**

Каждому типу объекта — список категорий, реально к нему применимых. Не «все ко всем»:
паллетайзер неприменим к больничной палате, и такая связь врёт пользователю.

- [ ] **Шаг 4: Расширить провенанс и проверку источников**

В `docs/data-provenance.md` добавить раздел «Классы решений» с таблицей: класс, диапазон
цены, диапазон производительности, источник, дата проверки.

В `scripts/check-sources.ts` включить в проверку строки с `isClass = true` — тот же порог
180 дней, тот же формат отчёта.

- [ ] **Шаг 5: Полный гейт**

```bash
lsof -ti:3000 | xargs kill -9 2>/dev/null
npx tsc --noEmit
npx --yes vitest run < /dev/null
npm run lint -- --max-warnings=0
npm run build
npx playwright test
npm run check:sources
```
Ожидание: всё зелёное; `check:sources` перечисляет и классы.

- [ ] **Шаг 6: Коммит**

```bash
git add scripts docs
git commit -m "feat(data): матрица применимости, провенанс классов, проверка источников

Тест держит главное обещание расширения: ни один тип объекта не ведёт в пустой экран.
check:sources теперь следит и за источниками классов с тем же порогом 180 дней.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## После этого плана

| | Тема |
|---|---|
| План 2 | Визуальный язык: типографика, палитра, правило ширин, повторная валидация палитры графиков и тёмной темы |
| План 3 | Каркас подбора: route group, шаги в URL, переходы, паритет-тест шага 4 и шага 5 |
