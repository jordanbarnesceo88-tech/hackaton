# Разблокировка сева и предконкурсная безопасность — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Довести правку М-2 до конца, чтобы дерево собиралось, а чистый инстанс засевал каталог из 11 решений; закрыть утечку боевых секретов в Docker-образ и англоязычные страницы ошибок.

**Architecture:** Личность решения переезжает с пары `(категория, имя)` на глобально уникальный `slug`. Slug уже есть в схеме, в миграции и у 7 классов; недостаёт у 3 складских строк и 1 вендорской, и три вызова `solution.upsert` всё ещё ключуются по старой паре. Проверку сквозной уникальности берёт на себя тест в наборе `unit` — типы этого сделать не могут, потому что у трёх источников три независимых типа, а пространство имён slug'ов одно.

**Tech Stack:** Next.js 16 (App Router), React 19, Prisma 7 (driver adapter), PostgreSQL, Vitest (наборы `unit` / `db`), tsx.

**Spec:** `docs/audit/2026-09-14-audit.html` — сводный аудит от 2026-09-14, разделы «Блокер» и «Инфраструктура».

## Global Constraints

- **Числа модели не меняются.** Ни одна задача этого плана не должна сдвинуть ни один экономический показатель. Любое изменение выходных чисел требует отдельной спецификации и подписи владельца (прецедент A1–A3) — в этот план такие изменения не входят.
- **Slug'и берутся из миграции, а не придумываются.** Значения обязаны посимвольно совпадать с бэкфиллом в `prisma/migrations/20260913120000_solution_slug/migration.sql`. Расхождение оставит уже забэкфилленную строку сиротой, и сев заведёт рядом вторую — то есть ровно тот дефект М-2, который эта правка чинит.
- **Список бэкфилла в миграции не редактируется никогда.** Он описывает историю, а не текущее содержимое источников.
- **Локальный Postgres слушает порт 5433**, не 5432.
- **Vitest запускается как `npx --yes vitest run --project unit < /dev/null`** — без `< /dev/null` процесс висит.
- **Скрипты в `scripts/` используют ОТНОСИТЕЛЬНЫЕ импорты** — `tsx` не резолвит `@/`.
- **Slug'и `warehouse`, `airport`, `medical`, `other` не переименовываются** — `SavedAnalysis.facilityTypeSlug` это строка, а не внешний ключ.
- **Комментарии и тексты — на русском**, в тон существующим: объясняют «почему», а не «что».

---

## Структура файлов

| Файл | Ответственность | Действие |
|---|---|---|
| `scripts/seed-data/seed-data.test.ts` | Целостность посевных данных между модулями | Дополнить одним тестом |
| `scripts/parse-sources/warehouse-real.ts` | 3 складские строки с ценами из источников | Добавить `slug` в тип и в 3 записи |
| `scripts/seed-data/vendor-solutions.ts` | 1 вендорская строка | Добавить `slug` в 1 запись |
| `scripts/seed.ts` | Сев каталога, 3 вызова `solution.upsert` | Перевести ключ upsert'а на `slug` |
| `docs/DEPLOY.md` | Рантбук выкатки | Исправить утверждение про 10 миграций |
| `.dockerignore` | Что не попадает в build-контекст | Привести к виду `.vercelignore` |
| `app/not-found.tsx` | Страница 404 | Создать |
| `app/error.tsx` | Граница ошибки | Создать |
| `.gitignore` | Неотслеживаемые артефакты | Добавить 2 пути |

---

### Task 1: Slug во всех трёх источниках сева

**Files:**
- Test: `scripts/seed-data/seed-data.test.ts` (дополнить, ~строка 76 — после теста «slug'и типов объектов, категорий и отраслей уникальны»)
- Modify: `scripts/parse-sources/warehouse-real.ts:15-17` (тип), `:38`, `:60`, `:82` (записи)
- Modify: `scripts/seed-data/vendor-solutions.ts:49` (единственная запись)

**Interfaces:**
- Consumes: ничего от предыдущих задач.
- Produces: `CuratedSolution.slug: string` и заполненное поле `slug` у всех 11 посевных решений. Task 2 читает `s.slug`, `c.slug`, `sol.slug` в `scripts/seed.ts`.

Тестовый файл уже импортирует все три источника (строки 5–7) — новых импортов не нужно.

- [ ] **Step 1: Написать падающий тест**

Добавить в `scripts/seed-data/seed-data.test.ts` внутрь `describe("целостность посевных данных", ...)`, сразу после теста «slug'и типов объектов, категорий и отраслей уникальны»:

```ts
  // М-2: личность решения — это slug, а не пара (категория, имя). Сев ключует upsert по нему,
  // а миграция 20260913120000_solution_slug кладёт на колонку NOT NULL + UNIQUE. Источников
  // три, тип у каждого свой, и компилятор не знает, что их slug'и делят ОДНО пространство
  // имён: пропуск в одном источнике роняет сев на чистой базе с P2011, уже записав часть
  // каталога, — сев не в транзакции. Поэтому проверка здесь, а не в типах.
  //
  // Значения обязаны совпадать с бэкфиллом миграции. Разошедшийся slug оставит забэкфилленную
  // строку сиротой и заведёт рядом вторую — тот самый дефект, который М-2 и чинит.
  it("slug'и решений уникальны СКВОЗЬ все три источника", () => {
    const all = [
      ...SOLUTION_CLASSES.map((s) => ({ slug: s.slug, name: s.name, src: "solution-classes" })),
      ...WAREHOUSE_REAL.map((s) => ({ slug: s.slug, name: s.name, src: "warehouse-real" })),
      ...VENDOR_SOLUTIONS.map((s) => ({ slug: s.slug, name: s.name, src: "vendor-solutions" })),
    ];

    expect(all, "решений в источниках должно быть 11").toHaveLength(11);

    for (const s of all) {
      expect(s.slug, `${s.src}: «${s.name}» без slug'а`).toBeTruthy();
      expect(s.slug, `${s.src}: «${s.name}» — slug не в kebab-case`).toMatch(
        /^[a-z0-9]+(-[a-z0-9]+)*$/
      );
    }

    const slugs = all.map((s) => s.slug);
    const dupes = [...new Set(slugs.filter((s, i) => slugs.indexOf(s) !== i))];
    expect(dupes, `дубли slug'ов: ${dupes.join(", ")}`).toHaveLength(0);
  });
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

```bash
npx --yes vitest run --project unit scripts/seed-data/seed-data.test.ts < /dev/null
```

Ожидается: FAIL. Четыре падения вида `warehouse-real: «HaiPick A42T» без slug'а` и `vendor-solutions: «Gausium Scrubber 75» без slug'а` — у 7 классов slug уже есть, у остальных четырёх строк поле `undefined`.

- [ ] **Step 3: Добавить `slug` в тип складских решений**

В `scripts/parse-sources/warehouse-real.ts` в `export type CuratedSolution = {` первым полем, перед `categorySlug`:

```ts
export type CuratedSolution = {
  /**
   * Идентичность строки в базе (М-2). Ключ upsert'а — он, а не имя: переименование в этом
   * файле обновит существующую строку, а не заведёт вторую, которую держит живой сохранённый
   * расчёт и которой после этого некому обновлять цену.
   *
   * Значение обязано совпадать с бэкфиллом в
   * prisma/migrations/20260913120000_solution_slug/migration.sql — иначе забэкфилленная строка
   * останется сиротой, а сев заведёт рядом вторую.
   */
  slug: string;
  categorySlug: "amr" | "asrs";
  name: string;
```

- [ ] **Step 4: Проставить slug'и трём складским записям**

Значения взяты из бэкфилла миграции, строки 34–37. Добавить `slug` первым полем каждого объекта:

```ts
    slug: "haipick-a42t",
    categorySlug: "amr",
    name: "HaiPick A42T",
```

```ts
    slug: "exotec-skypod-station",
    categorySlug: "asrs",
    name: "Exotec Skypod (станция)",
```

```ts
    slug: "autostore-port",
    categorySlug: "asrs",
    name: "AutoStore (порт)",
```

- [ ] **Step 5: Проставить slug вендорской записи**

В `scripts/seed-data/vendor-solutions.ts` в единственном объекте `VENDOR_SOLUTIONS` первым полем, перед `categorySlug`:

```ts
    slug: "gausium-scrubber-75",
    categorySlug: "class-cleaning",
    name: "Gausium Scrubber 75",
```

- [ ] **Step 6: Запустить тест и убедиться, что он проходит**

```bash
npx --yes vitest run --project unit scripts/seed-data/seed-data.test.ts < /dev/null
```

Ожидается: PASS.

- [ ] **Step 7: Убедиться, что ошибка типов ушла**

```bash
npx tsc --noEmit
```

Ожидается: пусто, код выхода 0. До этой задачи здесь была ровно одна ошибка — `TS2741: Property 'slug' is missing` в `scripts/seed-data/vendor-solutions.ts:50`. Если появились ДРУГИЕ ошибки про `slug` в `scripts/seed.ts` — это ожидаемо после `prisma generate` в Task 2, но сейчас клиент ещё старый, и их быть не должно.

- [ ] **Step 8: Прогнать весь набор unit**

```bash
npx --yes vitest run --project unit < /dev/null
```

Ожидается: PASS, 423 теста в 35 файлах (было 422 + один новый).

- [ ] **Step 9: Коммит**

```bash
git add scripts/seed-data/seed-data.test.ts scripts/parse-sources/warehouse-real.ts scripts/seed-data/vendor-solutions.ts
git commit -m "fix(seed): slug у всех 11 решений + тест сквозной уникальности

Тип VendorSolutionSeed требовал slug, а данные его не отдавали — дерево не
собиралось. У складских строк slug'а не было ни в типе, ни в записях.
Значения взяты из бэкфилла миграции 20260913120000_solution_slug.

Тест, который обещал doc-комментарий в типе, до сих пор не существовал.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BvkKanhEU6iQNLykBDLDMT"
```

---

### Task 2: Upsert по slug'у

**Files:**
- Modify: `scripts/seed.ts:243-247` (вендорские), `:277-281` (классы), `:307-311` (складские)
- Regenerate: `node_modules/.prisma/client` через `prisma generate`

**Interfaces:**
- Consumes: `sol.slug`, `c.slug`, `s.slug` из Task 1.
- Produces: сев, переживающий переименование строки в источнике. Task 3 это проверяет на чистой базе.

Сгенерированный клиент датирован 11 сентября, схема правлена 13-го: в `SolutionCreateInput` поля `slug` нет. Пока клиент не перегенерирован, любая попытка передать `slug` — ошибка типов, поэтому `prisma generate` идёт первым шагом.

- [ ] **Step 1: Перегенерировать клиент Prisma**

```bash
npx prisma generate
```

Ожидается: `Generated Prisma Client`.

- [ ] **Step 2: Убедиться, что клиент узнал про slug**

```bash
grep -c 'slug' node_modules/.prisma/client/index.d.ts
```

Ожидается: число заметно больше нуля. Точнее — проверить, что `slug` появился среди полей `Solution`:

```bash
grep -n 'SolutionWhereUniqueInput' node_modules/.prisma/client/index.d.ts | head -3
```

Ожидается: тип существует и принимает `slug`.

- [ ] **Step 3: Перевести вендорский upsert на slug**

В `scripts/seed.ts` заменить (около строки 243):

```ts
    await prisma.solution.upsert({
      where: { solutionCategoryId_name: { solutionCategoryId: category.id, name: sol.name } },
      update: data,
      create: { ...data, name: sol.name, solutionCategoryId: category.id },
    });
```

на:

```ts
    // Ключ — slug, а не пара (категория, имя): переименование строки в источнике должно
    // обновлять существующую запись, а не заводить вторую (М-2). В `update` slug не входит
    // намеренно — он и есть ключ, переписывать его собой незачем.
    await prisma.solution.upsert({
      where: { slug: sol.slug },
      update: data,
      create: { ...data, slug: sol.slug, name: sol.name, solutionCategoryId: category.id },
    });
```

- [ ] **Step 4: Перевести upsert классов на slug**

Заменить (около строки 277):

```ts
    await prisma.solution.upsert({
      where: { solutionCategoryId_name: { solutionCategoryId: category.id, name: c.name } },
      update: data,
      create: { ...data, name: c.name, solutionCategoryId: category.id },
    });
```

на:

```ts
    await prisma.solution.upsert({
      where: { slug: c.slug },
      update: data,
      create: { ...data, slug: c.slug, name: c.name, solutionCategoryId: category.id },
    });
```

- [ ] **Step 5: Перевести складской upsert на slug**

Заменить (около строки 307):

```ts
      await prisma.solution.upsert({
        where: { solutionCategoryId_name: { solutionCategoryId: category.id, name: s.name } },
        update: data,
        create: { name: s.name, solutionCategoryId: category.id, ...data },
      });
```

на:

```ts
      await prisma.solution.upsert({
        where: { slug: s.slug },
        update: data,
        create: { slug: s.slug, name: s.name, solutionCategoryId: category.id, ...data },
      });
```

- [ ] **Step 6: Проверить, что старый ключ больше нигде не используется для решений**

```bash
grep -n 'solutionCategoryId_name' scripts/seed.ts
```

Ожидается: пусто. Составной уникальный индекс `@@unique([solutionCategoryId, name])` в схеме ОСТАЁТСЯ — он больше не ключ upsert'а, но не даёт двум визуально одинаковым строкам встать рядом в одной категории.

- [ ] **Step 7: Типы и сборка**

```bash
npx tsc --noEmit && npm run build
```

Ожидается: обе команды с кодом 0. `npm run build` до этого плана падал.

- [ ] **Step 8: Коммит**

```bash
git add scripts/seed.ts prisma/schema.prisma prisma/migrations/20260913120000_solution_slug
git commit -m "fix(seed): upsert решений по slug'у, а не по паре (категория, имя)

Завершает М-2. Схема и миграция лежали незакоммиченными, три вызова upsert
ключевались по старой паре и не передавали slug в create — на чистой базе
это P2011 после применения NOT NULL.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BvkKanhEU6iQNLykBDLDMT"
```

---

### Task 3: Проверка на чистой базе и исправление рантбука

**Files:**
- Verify: весь путь `migrate deploy` → `db:seed` на пустой базе
- Modify: `docs/DEPLOY.md` §4d

**Interfaces:**
- Consumes: результат Task 1 и Task 2.
- Produces: доказательство, что дефект закрыт. Ничего программного дальше не потребляется.

Это единственный шаг, который проверяет собственно починенное. На существующей базе всё выглядит здоровым, потому что каждый upsert уходит в ветку `update`; дефект виден только на пустой.

- [ ] **Step 1: Вывести две строки подключения в переменные оболочки**

Все шаги задачи выполняются в ОДНОЙ сессии оболочки — переменные между шагами сохраняются. Рабочая строка берётся из `.env`, проверочная получается подменой имени базы на `rrp_clean_check`. Ни та, ни другая не печатаются: в них пароль.

```bash
BASE_URL="$(grep -m1 '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '"'"'"'"')"
CHECK_URL="$(printf '%s' "$BASE_URL" | sed -E 's#/[^/?]+(\?|$)#/rrp_clean_check\1#')"
printf 'порт: %s | база: %s\n' \
  "$(printf '%s' "$CHECK_URL" | sed -E 's#.*:([0-9]+)/.*#\1#')" \
  "$(printf '%s' "$CHECK_URL" | sed -E 's#.*/([^/?]+)(\?.*)?$#\1#')"
```

Ожидается: `порт: 5433 | база: rrp_clean_check`. Если порт не 5433 — остановиться и разобраться: план рассчитан на локальный Postgres, а не на Neon, и создавать базы в боевом кластере он не должен.

- [ ] **Step 2: Создать временную базу**

```bash
psql "$BASE_URL" -c 'CREATE DATABASE rrp_clean_check;'
```

- [ ] **Step 3: Применить миграции на пустую базу**

```bash
DATABASE_URL="$CHECK_URL" npx prisma migrate deploy
```

Ожидается: применяются **11** миграций, последняя — `20260913120000_solution_slug`.

- [ ] **Step 4: Засеять**

```bash
DATABASE_URL="$CHECK_URL" npm run db:seed
```

Ожидается: сев доходит до конца. До этого плана здесь было `P2011 NullConstraintViolation at scripts/seed.ts:243 (model Solution)`.

- [ ] **Step 5: Проверить, что решений действительно 11**

```bash
psql "$CHECK_URL" -c 'SELECT count(*) AS solutions FROM "Solution";'
psql "$CHECK_URL" -c 'SELECT slug FROM "Solution" WHERE slug LIKE '"'"'legacy-%'"'"';'
```

Ожидается: `solutions = 11`, и **ни одной** строки с префиксом `legacy-` — на чистой базе бэкфиллу нечего было не узнать, все slug'и пришли из источников сева. Появившийся `legacy-` означает, что какой-то slug в источниках разошёлся с бэкфиллом миграции.

- [ ] **Step 6: Удалить временную базу**

```bash
psql "$BASE_URL" -c 'DROP DATABASE rrp_clean_check;'
```

Удаление обязательно даже при провале предыдущих шагов — иначе следующий прогон упадёт на `CREATE DATABASE` с «уже существует» и будет выглядеть как новый дефект.

- [ ] **Step 7: Исправить утверждение в рантбуке**

В `docs/DEPLOY.md` §4d сейчас написано, что путь чистого инстанса проверен 2026-09-13 и «все 10 миграций применились». Миграций 11, и одиннадцатая этот путь ломала. Заменить на:

```markdown
Путь чистого инстанса проверен 2026-09-14: 11 миграций применяются, сев доходит до конца,
в каталоге 11 решений и ни одной строки с префиксом `legacy-`.

Проверка от 2026-09-13 относилась к дереву из 10 миграций и была верна для него.
Одиннадцатая (`20260913120000_solution_slug`) кладёт на `Solution.slug` NOT NULL, и до
завершения М-2 сев на чистой базе падал с `P2011`, записав часть каталога — сев не в
транзакции. Отсюда правило: **этот путь перепроверяется после каждой миграции, меняющей
обязательность колонки**, а не один раз.
```

- [ ] **Step 8: Коммит**

```bash
git add docs/DEPLOY.md
git commit -m "docs(deploy): путь чистого инстанса перепроверен на 11 миграциях

Запись от 13.09 описывала дерево из 10 миграций. Одиннадцатая ломала сев,
и рантбук утверждал обратное.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BvkKanhEU6iQNLykBDLDMT"
```

---

### Task 4: Боевые секреты не попадают в build-контекст Docker

**Files:**
- Modify: `.dockerignore`

**Interfaces:**
- Consumes: ничего.
- Produces: ничего программного.

`.dockerignore` исключает `.env`, но этот паттерн **не** покрывает `.env.local` и `.env.deploy`. В `.env.deploy` лежат `AUTH_SECRET`, `DATABASE_URL`, `PGPASSWORD`, `NEON_*` — боевые значения. `Dockerfile:14` делает `COPY . .`, то есть они запекаются в слой build-стадии. Финальный образ чист (стадия `runner` их не копирует), но любой запушенный или закешированный builder-образ несёт живые креды. В `.vercelignore` это сделано правильно — здесь просто не обновили следом.

- [ ] **Step 1: Убедиться, что дыра существует**

```bash
docker build --target builder -t rrp-leak-check . >/dev/null 2>&1 && \
docker run --rm --entrypoint sh rrp-leak-check -c 'ls -la /app/.env* 2>/dev/null || echo "нет env-файлов"'
```

Ожидается ДО правки: в списке присутствуют `.env.local` и/или `.env.deploy`.

Если Docker в этом окружении недоступен, проверка вырождается в чтение правил — `.dockerignore` содержит строку `.env` и не содержит `.env.*`; этого достаточно, шаг можно пропустить с пометкой.

- [ ] **Step 2: Исправить правила**

Заменить в `.dockerignore` строку `.env` на:

```
# Паттерн `.env` НЕ покрывает `.env.local` и `.env.deploy` — в последнем лежат боевые
# AUTH_SECRET, DATABASE_URL и NEON_*. `COPY . .` в Dockerfile запекал их в слой build-стадии:
# финальный образ чист, но запушенный или закешированный builder нёс живые креды.
# Форма повторяет .vercelignore, где это изначально сделано верно.
.env
.env.*
!.env.example
```

Если `.env.example` в репозитории нет — строку `!.env.example` не добавлять.

- [ ] **Step 3: Проверить, что дыра закрыта**

```bash
docker build --target builder -t rrp-leak-check . >/dev/null 2>&1 && \
docker run --rm --entrypoint sh rrp-leak-check -c 'ls -la /app/.env* 2>/dev/null || echo "нет env-файлов"'
docker rmi rrp-leak-check >/dev/null 2>&1 || true
```

Ожидается: `нет env-файлов`.

- [ ] **Step 4: Коммит**

```bash
git add .dockerignore
git commit -m "fix(docker): .env.local и .env.deploy не попадают в build-контекст

Паттерн .env их не покрывал, а COPY . . запекал в слой build-стадии боевые
AUTH_SECRET и креды Neon. .vercelignore это делал правильно с самого начала.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BvkKanhEU6iQNLykBDLDMT"
```

---

### Task 5: Русские страницы ошибок

**Files:**
- Create: `app/not-found.tsx`
- Create: `app/error.tsx`

**Interfaces:**
- Consumes: ничего.
- Produces: ничего программного.

Во всём `app/` нет ни одного `error.tsx`, `global-error.tsx` или `not-found.tsx`. Проверено запросом: `/calculate/bogus-id` отдаёт дефолт Next — английское `404 · This page could not be found` внутри `<html lang="ru">`, без ссылки назад. Скринридер зачитает английскую фразу в русском языковом контексте (WCAG 3.1.2). `notFound()` вызывается из `calculate/[solutionId]:47,54`, `compare/[type]:82`, `report/[analysisId]:27,30`.

Обе страницы верстаются в существующих классах: `surface-prose` задаёт ширину прозаической полосы, `text-muted-foreground` — приглушённый текст. Корневой layout уже даёт шапку и `<main>`, поэтому обёртку повторять не нужно.

- [ ] **Step 1: Создать `app/not-found.tsx`**

```tsx
import Link from "next/link";

export const metadata = { title: "Страница не найдена — Платформа оценки роботизации" };

/**
 * 404 на русском. До неё Next отдавал свою дефолтную страницу — английское
 * «This page could not be found» внутри <html lang="ru">, без единой ссылки назад.
 * Скринридер зачитывал английскую фразу в русском языковом контексте (WCAG 3.1.2).
 *
 * `notFound()` достижим из трёх мест: решения с несуществующим id, типа объекта вне
 * таксономии и чужого сохранённого расчёта, — поэтому ссылок здесь две, а не одна:
 * попавший сюда человек чаще всего шёл либо в каталог, либо к своим расчётам.
 */
export default function NotFound() {
  return (
    <div className="surface-prose flex flex-col gap-6 py-16">
      <h1>Страница не найдена</h1>
      <p className="text-muted-foreground">
        Такой страницы нет. Обычно это значит, что ссылка устарела: решение убрали из каталога,
        расчёт удалили или адрес набран с опечаткой.
      </p>
      <div className="flex flex-wrap gap-4">
        <Link href="/" className="underline underline-offset-4">
          На главную
        </Link>
        <Link href="/analyses" className="underline underline-offset-4">
          Мои расчёты
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Создать `app/error.tsx`**

```tsx
"use client";

import Link from "next/link";

/**
 * Граница ошибки верхнего уровня. Без неё необработанное исключение — например, недоступный
 * Postgres на любом запросе из lib/db/queries.ts — показывало английское «Application error»
 * без пути назад и без возможности повторить.
 *
 * Текст ошибки наружу не выводится: в сообщении Prisma встречается строка подключения.
 * `digest` показан намеренно — это единственное, что человек может назвать в обращении,
 * и по нему запись находится в логах сервера.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="surface-prose flex flex-col gap-6 py-16">
      <h1>Что-то сломалось</h1>
      <p className="text-muted-foreground">
        Страница не открылась. Расчёты и сохранённые данные при этом не пострадали — попробуйте
        ещё раз, а если повторится, откройте главную и начните заново.
      </p>
      {error.digest ? (
        <p className="text-muted-foreground font-mono text-sm">Код обращения: {error.digest}</p>
      ) : null}
      <div className="flex flex-wrap gap-4">
        <button type="button" onClick={reset} className="underline underline-offset-4">
          Попробовать ещё раз
        </button>
        <Link href="/" className="underline underline-offset-4">
          На главную
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Собрать и поднять приложение**

```bash
lsof -ti:3000 | xargs kill -9 2>/dev/null || true
npm run build && npm run start &
sleep 5
```

- [ ] **Step 4: Проверить 404 вживую**

```bash
curl -s http://localhost:3000/calculate/bogus-id | grep -o 'Страница не найдена\|This page could not be found'
```

Ожидается: `Страница не найдена`. До правки здесь было `This page could not be found`.

- [ ] **Step 5: Остановить сервер и прогнать линтер**

```bash
lsof -ti:3000 | xargs kill -9 2>/dev/null || true
npm run lint -- --max-warnings=0
```

Ожидается: код 0.

- [ ] **Step 6: Коммит**

```bash
git add app/not-found.tsx app/error.tsx
git commit -m "feat(ui): русские страницы 404 и ошибки

Дефолт Next отдавал английский текст внутри <html lang=\"ru\"> без пути назад.
notFound() достижим из трёх роутов. Текст исключения наружу не выводится —
в сообщениях Prisma встречается строка подключения.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BvkKanhEU6iQNLykBDLDMT"
```

---

### Task 6: Крупные неотслеживаемые файлы в `.gitignore`

**Files:**
- Modify: `.gitignore`

**Interfaces:**
- Consumes: ничего.
- Produces: ничего программного.

`Dataset/` (4,9 МБ — `robots.json` и `robots.json.gz`) и `prototype-design/` (396 КБ) не отслеживаются и при этом не игнорируются: первый же `git add -A` заберёт 5,3 МБ в историю навсегда. У файла уже есть прецедент ровно такого рода — комментарий про `tmp-vr.mjs` в хвосте.

`prototype-design/BCB_Platform_demo.html` — демо-страница чужой платформы. Она нужна локально как референс редизайна, но её место в истории репозитория перед конкурсом — вопрос не технический, и решать его владельцу. Игнорирование оставляет файл на диске и не принимает это решение за него.

- [ ] **Step 1: Убедиться, что оба пути сейчас не игнорируются**

```bash
git check-ignore -v Dataset/robots.json prototype-design/BCB_Platform_demo.html; echo "код выхода: $?"
```

Ожидается: пустой вывод, код выхода 1 — то есть не игнорируется ни один.

- [ ] **Step 2: Добавить правила**

Дописать в конец `.gitignore`:

```
# Датасет поставщиков: 1257 позиций с made-in-china.com, 4,9 МБ в двух видах. Провенанс для
# подпроектов B/D рыночной модели, но в истории репозитория ему делать нечего — он растёт и
# перезаписывается целиком.
/Dataset/

# Демо чужой платформы, используется локально как референс редизайна. Не коммитить:
# происхождение чужое, и вопрос это не технический.
/prototype-design/
```

- [ ] **Step 3: Проверить, что правила сработали и файлы на месте**

```bash
git check-ignore -v Dataset/robots.json prototype-design/BCB_Platform_demo.html
ls -la Dataset prototype-design | head -6
git status --porcelain | grep -E 'Dataset|prototype-design' || echo "оба вне git — верно"
```

Ожидается: `check-ignore` называет обе новые строки, файлы на диске остались, `git status` их не показывает.

- [ ] **Step 4: Коммит**

```bash
git add .gitignore
git commit -m "chore: игнорировать Dataset/ и prototype-design/

5,3 МБ неотслеживаемых файлов, которые забрал бы первый же git add -A.
Прецедент уже был — см. комментарий про tmp-vr.mjs выше по файлу.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BvkKanhEU6iQNLykBDLDMT"
```

---

## Финальная проверка после всех задач

- [ ] **Полный прогон**

```bash
npx tsc --noEmit
npm run lint -- --max-warnings=0
npx --yes vitest run --project unit < /dev/null
npx --yes vitest run --project db < /dev/null
npm run build
npm run check:sources
npm run check:contrast
```

Ожидается: все семь с кодом 0. Ориентиры: 423 юнит-теста в 35 файлах, 39 тестов БД в 4 файлах, источники 14/14, контраст 24/24.

- [ ] **E2E против свежей сборки, а не против висящего сервера**

```bash
lsof -ti:3000 | xargs kill -9 2>/dev/null || true
npx playwright test
```

Ожидается: 10/10. Убийство процесса на :3000 обязательно — `reuseExistingServer: !process.env.CI` заставляет Playwright молча переиспользовать то, что уже поднято, и именно поэтому зелёный прогон до этого плана сертифицировал дерево, которое не собиралось.

---

## Что в этот план намеренно НЕ входит

- **Всё, что меняет числа модели**: обоснование OPEX, показ концов диапазонов вместо середин, предупреждение у пресета «Москва», два недостающих рычага в диаграмме чувствительности, растаможка, флаг `economical` на нежизнеспособных результатах. По правилу проекта каждое из этих изменений требует отдельной спецификации и подписи владельца.
- **Три конкурсных текстовых риска**: выдуманный инцидент на `/methodology`, обещание «каждая цена — диапазон со ссылкой» на лендинге, отсутствие баннера на `docs/AUDIT.md`. Формулировки здесь — решение владельца: заменить рассказ о несуществовавшем инциденте может только тот, кто знает, как было на самом деле.
- **Редизайн** — отложен владельцем. Спецификация лежит в `docs/design/PROTOTYPE-DESIGN-SYSTEM.md`.
- **Выкатка ветки** — решение владельца; до неё судья видит старую модель.
