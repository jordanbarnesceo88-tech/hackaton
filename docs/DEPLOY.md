# Deployment Runbook

> **Выкатываете в ПУСТОЙ инстанс, впервые?** [DEPLOY-QUICKSTART.md](./DEPLOY-QUICKSTART.md) —
> упорядоченный путь GitHub → Neon → Vercel с разделением pooled/direct и дымовыми проверками.
>
> **Выкатываете поверх боевой, где уже есть пользователи?** Шаг 3 этого файла и только он.
> Quickstart писался под чистую базу и про чистку сева, слияние категорий и окно недоступности
> не знает. Приложение A — что сев делает с чужими данными, приложение B — М-2.

The app is deploy-ready. Steps marked **[needs your account]** require your own
Postgres/hosting credentials and are not automatable.

## 1. Provision a managed Postgres  **[needs your account]**
Use Neon or Vercel Postgres. Copy **both** connection strings — they are not interchangeable:
the **pooled** one (host contains `-pooler`) is what the app runs on, and the **direct** one is
what migrations run over. `@prisma/adapter-pg` opens a pool per serverless instance, so the
runtime needs the pooler; `prisma migrate deploy` takes advisory locks that a transaction-mode
pooler can drop, so migrations must not go through it.

## 2. Environment variables
Set on the host (Vercel project settings, or the Docker runtime):
- `DATABASE_URL` — the pooled Postgres URL from step 1.
- `AUTH_SECRET` — generate once: `openssl rand -base64 32`.
- `AUTH_URL` — your production URL (e.g. `https://example.com`) if not auto-detected.

## 3. Миграция + сев на боевую, где УЖЕ ЕСТЬ данные

> Если база пустая (первый деплой в чистый инстанс) — достаточно шагов 3.5 и 3.6, всё
> остальное проверяет то, чего там нет. `npm run preflight:deploy` сам скажет «проверять
> нечего».

Ни `prisma migrate deploy`, ни `npm run db:seed` НИКОГДА не бежали по боевой с живыми
пользователями. Оба необратимы, ни один не в транзакции, и оба удаляют строки. Порядок ниже
пронумерован затем, чтобы его можно было исполнить под давлением, не восстанавливая контекст.

**Держать это ручным.** `migrate deploy` в build command хоста побежит на каждом preview-деплое
и по пулу.

### 3.1 Взять ПРЯМУЮ строку подключения
Не pooled. `migrate deploy` берёт advisory lock, транзакционный пул его роняет — миграция
зависает или падает на середине. Preflight проверяет это первым пунктом и предупредит.

```bash
export PGDIRECT="postgresql://…@…неpooler…/…"   # direct, из шага 1
```

### 3.2 Прогнать preflight — он ТОЛЬКО ЧИТАЕТ
```bash
DATABASE_URL="$PGDIRECT" npm run preflight:deploy
```
Ненулевой выход = есть пункты `[СТОП]`. **Разобрать каждый до продолжения.** Что он показывает:

| Пункт | Почему остановиться |
|---|---|
| Застрявшие миграции | `migrate deploy` откажется бежать (P3009) и деплой упадёт, не сделав ничего |
| `global_categories` даёт конфликты имён | Миграция бросает `RAISE EXCEPTION` и откатывается: деплоя не будет |
| `saved_analysis_solution_fk` удалит N расчётов | Удаление защитимо, но решение принимает владелец, а не миграция |
| Чистка сева удалит N решений | **Единственное необратимое действие сева.** Список печатается поимённо |
| Сев создаст N дубликатов | М-2: имя есть в источнике, но строка лежит в другой категории |
| Сев перепишет N значений допущений | Каждое участвует в каждом расчёте — все числа на экране изменятся |
| Категории есть в базе, но нет в источнике | Останутся с пустым названием-задачей на экране сравнения |

### 3.3 Снять дамп
```bash
pg_dump --no-owner --no-acl --format=custom "$PGDIRECT" > backup-$(date +%F-%H%M).dump
ls -lh backup-*.dump   # не ноль байт
```
**Отката миграций нет.** `prisma migrate deploy` не умеет down, а `global_categories` удаляет
колонку. Единственный откат — восстановление из этого дампа.

### 3.4 Закрыть трафик или объявить окно
Совместимой точки между старой и новой схемой НЕ СУЩЕСТВУЕТ, и это не осторожность, а факт:
`global_categories` делает `DROP COLUMN "SolutionCategory"."facilityTypeId"`, а старая сборка
читает именно её. Значит:

* **Старая сборка + новая схема** (миграция прошла, промоут ещё нет) → 500 на каждом экране
  визарда: колонки нет.
* **Новая сборка + старая схема** (промоут прошёл, миграция ещё нет) → 500 там же: нет таблицы
  `FacilityTypeCategory`, нет `taskLabel`, нет `workloadStream`.
* **Между `migrate deploy` и `db:seed`** схема новая, а данные старые: у всех категорий
  `taskLabel = ''` (экран сравнения задач показывает безымянные строки), поток нагрузки у всех
  `OPERATION_FLOW` кроме двух slug'ов, которые проставляет сама миграция, а **ставка труда в
  базе остаётся старой** — то есть все числа в этом окне неверны, но выглядят обычно.

Vercel отдаёт трафик всё это время. Поэтому:

```bash
vercel deploy --prod --skip-domain     # собрать, НЕ переключая домен
# …шаги 3.5–3.8…
vercel promote <deployment-url>        # переключить домен, когда база готова
```
Если такой возможности нет — объявить окно и увести домен на страницу-заглушку. Молча выкатить
поверх живого трафика нельзя: это несколько минут пятисоток и, что хуже, окно, в котором
показываются правдоподобные неверные числа.

### 3.5 Миграции
```bash
DATABASE_URL="$PGDIRECT" npx prisma migrate deploy
DATABASE_URL="$PGDIRECT" npx prisma migrate status   # ждём "up to date"
```

### 3.6 Сев
```bash
DATABASE_URL="$PGDIRECT" npm run db:seed 2>&1 | tee seed-$(date +%F-%H%M).log
```
**Читать весь вывод, а не только код возврата.** Сев печатает `УДАЛЯЕТСЯ …` до удаления,
`ДУБЛИКАТ: …` про М-2, `оставлено «…»` про замороженные строки и предупреждения про категории
и связи, которых нет в источнике. Код возврата про них молчит.

Если сев остановился на предохранителе (`чистка хочет удалить N решений — больше порога 10`):
**ничего не удалено, всё остальное посеяно.** Сверить список и повторить один раз с:

| Переменная | Что делает |
|---|---|
| `SEED_PRUNE=force` | Удалить всё из списка |
| `SEED_PRUNE=off` | Не удалять ничего (строки останутся в каталоге) |
| `SEED_PRUNE_LIMIT=N` | Сдвинуть порог |
| `SEED_KEEP_ASSUMPTION_VALUES=1` | Обновить подписи и обоснования допущений, **значения не трогать** |

Сев идемпотентен: повторный запуск не задваивает строки и не роняет чужие данные.

### 3.7 Preflight ещё раз
```bash
DATABASE_URL="$PGDIRECT" npm run preflight:deploy
```
Теперь всё, кроме «Пользовательские данные в базе», обязано быть `[OK]`. Оставшийся `[СТОП]`
означает, что сев чего-то не доделал.

### 3.8 Промоут и дымовая проверка
Переключить домен, затем на боевом URL:
1. Главная → выбор отрасли → тип объекта → экран занятости показывает **названия задач**, а не
   пустые строки.
2. Сравнение решений: у каждой строки есть цена и подпись происхождения.
3. Открыть расчёт: панель допущений показывает **ставку труда 6,7** и обоснование под каждым
   из шестнадцати полей.
4. Войти существующим пользователем и открыть уже сохранённый расчёт — он должен открыться,
   а не отдать 404.
5. `/methodology` считается на запросе — открыть и убедиться, что цитаты живы.

## 4a. Deploy on Vercel  **[needs your account]**
Connect the GitHub repo, set the env vars from step 2, deploy. The build runs
`prisma generate` (via the build) automatically.

## 4b. Or deploy with Docker
```bash
docker build -t rrp .
docker run -p 3000:3000 -e DATABASE_URL="<pooled url>" -e AUTH_SECRET="<secret>" rrp
```

## 4c. Check the cited figures are still current  **[before any live demo]**
```bash
npm run check:sources      # ГЕЙТ: ненулевой выход, если протухла цитата, обязанная быть верной
npm run report:snapshots   # отчёт: возраст рыночных снимков, никогда не падает
```
`docs/data-provenance.md` promises every real figure is verified before it is shown. Проверок
теперь ДВЕ, потому что одно правило на всё было неверным (З-3).

**Гейт** покрывает цитаты, обязанные быть верными СЕГОДНЯ: страницы производителей со
характеристиками и все заявления о производительности. Такая страница действительно протухает —
модель снимают с производства, характеристики переписывают. Гейт падает и тогда, когда дату
проверки нельзя прочитать в ЛЮБОЙ из двух корзин: снимок без читаемой даты — это не снимок,
а число без происхождения, и освобождения он лишается. Порог 180 дней, переопределяется
`MAX_SOURCE_AGE_DAYS`.

**Отчёт** покрывает рыночные снимки — наблюдения цены на конкретную дату. Такая цитата не
«устаревает»: $95 880 девятого числа остаются правдой про девятое число. У неё есть дата, и
показать надо возраст, а не приговор. Отчёт выходит нулём всегда.

Ни то, ни другое не входит в CI намеренно — тест, падающий от смены даты, красит сборку за то,
чего не делал ни один коммит. Живой вывод обеих проверок виден на `/methodology`: страница
считает его на запросе, а не на сборке, иначе она застыла бы на дне деплоя и утверждала
«13 дней» полгода — соврав ровно там, где доказывает обратное.

## 4d. Путь «чистый инстанс» проверен целиком  **[справочно]**

Путь чистого инстанса проверен 2026-09-14: 11 миграций применяются, сев доходит до конца,
в каталоге 11 решений и ни одной строки с префиксом `legacy-`.

Проверка от 2026-09-13 относилась к дереву из 10 миграций и была верна для него.
Одиннадцатая (`20260913120000_solution_slug`) кладёт на `Solution.slug` NOT NULL, и до
завершения М-2 сев на чистой базе падал с `P2011`, записав часть каталога — сев не в
транзакции. Отсюда правило: **этот путь перепроверяется после каждой миграции, меняющей
обязательность колонки**, а не один раз.

| шаг | результат |
|---|---|
| `preflight:deploy` против пустой базы | не падает, сообщает «база ещё не развёрнута», пропускает проверки, которым нужны данные |
| `prisma migrate deploy` | все 11 миграций применились |
| `npx tsx scripts/seed.ts` | 12 отраслей, 47 типов, 15 категорий, 11 решений, 16 допущений |
| повторный сев | те же числа, дубликатов ноль (проверено запросом по `(категория, имя)` и `(тип, имя)`) |
| `preflight:deploy` после сева | все проверки `[OK]` |

Предохранитель чистки проверен отдельно на настоящей устаревшей строке: `SEED_PRUNE_LIMIT=0` —
ошибка и строка жива; `SEED_PRUNE=off` — предупреждение и строка жива; обычный прогон — удалена,
список напечатан до удаления.

Это НЕ проверка боевого пути: боевая база населена и отстаёт, а здесь база была пуста. Боевой
путь проверяется только п. 3.2 — `preflight` против настоящей строки подключения.

## 5. Security hardening before real production traffic  **[required before public launch]**
The auth code is correct for the current stage (bcrypt passwords, JWT sessions, strictly
user-scoped saved analyses — no cross-user access), but a few hardening steps are deliberately
deferred to deploy time because they need production infrastructure or config:
- **Rate-limit login & signup.** DONE — a DB-backed fixed-window limiter (`lib/auth/rate-limit.ts`,
  `RateLimit` table) throttles signup (5 / IP / 15 min, in `lib/auth/actions.ts`) and login
  (10 / email+IP / 15 min, in `auth.ts`'s `authorize`). Because it's Postgres-backed it works on
  both a single Docker instance and serverless/multi-instance — no Upstash/Redis needed. A per-IP
  login cap (50 / 15 min) backstops the per-account cap against password-spray. IP is read from
  `X-Forwarded-For`. **Your proxy MUST overwrite (not append) the inbound `X-Forwarded-For`** —
  else a client can spoof the leftmost hop and rotate it to bypass the limiter. Vercel handles
  this; nginx: use `proxy_set_header X-Forwarded-For $remote_addr;` (overwrite), NOT
  `$proxy_add_x_forwarded_for` (append); Cloudflare/most CDNs overwrite by default. The limiter
  fails open on a DB error (never locks users out on an infra hiccup). **Prune old rows** on a
  schedule (one row per key accumulates; login attempts with random emails/IPs can add many):
  `DELETE FROM "RateLimit" WHERE "windowStart" < now() - interval '1 day'` via a daily cron.
- **Security headers.** DONE — `next.config.ts` `headers()` sets CSP, HSTS, X-Frame-Options,
  X-Content-Type-Options, and Referrer-Policy on all routes (audit SEC1). The CSP still allows
  `'unsafe-inline'` scripts for Next's inline hydration bootstrap; tighten to nonce-based CSP
  when convenient.
- **(Optional) Email verification** on signup, if any future feature (password reset,
  notifications) will trust email ownership. Not needed for the current feature set.

## 6. Known `npm audit` findings — assessed, not actionable

`npm audit` reports **4 high-severity findings**, which are **two distinct advisories** counted
across the packages they affect. Both are reachable only through the Prisma CLI and neither is
exploitable here; check this list before spending time on them again:

| Advisory | Package | Why it does not apply |
|---|---|---|
| [GHSA-3f6p-5ww8-9rcr](https://github.com/advisories/GHSA-3f6p-5ww8-9rcr) | `mysql2` | Auth-plugin downgrade leaking plaintext credentials — to a **MySQL** server. `datasource db` is `postgresql`, the runtime driver is `@prisma/adapter-pg`, and no source file references mysql. The driver is never loaded. |
| [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx) | `deepmerge-ts` | Stack exhaustion on recursive object graphs, in Prisma's own tooling. Not reachable from application code. |

Both arrive via `prisma`, which is a **devDependency** — it is not installed in the runtime
image (the Dockerfile's runner stage copies only `.next/standalone`).

**Do not run `npm audit fix --force`.** It resolves these by downgrading `prisma` to 6.19.3,
which is a major version behind `@prisma/client@7` and would break the driver-adapter setup
this app depends on — `new PrismaClient()` without an adapter throws under Prisma 7. The fix is
worse than the finding. Re-check when Prisma ships a release that drops these transitives.

## Notes
- The Prisma pg driver adapter (`lib/db/client.ts`) uses a connection pool — use a **pooled**
  `DATABASE_URL` in serverless environments.
- Local dev DB stays on host port 5433 (docker-compose); production uses the managed DB.

---

## Приложение A. Что `npm run db:seed` делает с НЕПУСТОЙ базой

Справочник к шагу 3.6. Составлен разбором `scripts/seed.ts` строка за строкой; каждая строка
таблицы — про то, что произойдёт с данными, которые уже лежат в боевой.

| Таблица | Как пишется | Что бывает с чужими строками |
|---|---|---|
| `Assumption` | upsert по `key` | **Значение перезаписывается.** Это и есть смысл выката (ставка труда 15 → 6,7), но правку оператора он снесёт: `SEED_KEEP_ASSUMPTION_VALUES=1` сохраняет значения. Ключи, которых нет в модели, НЕ удаляются и НЕ читаются движком — сев про них предупреждает |
| `Industry`, `FacilityType` | upsert по `slug` | Лишние остаются навсегда. Безвредно: `SavedAnalysis.facilityTypeSlug` — строка, а не FK |
| `FacilityExample` | findMany + updateMany/create по `(facilityTypeId, «Типовой объект»)` | Идемпотентно. Уникального индекса на паре нет, поэтому если старый сев когда-то делал безусловный `create`, дублей может быть несколько: сев обновляет **все** и предупреждает. Визард читает одну из них `take: 1` без сортировки — лишние надо удалить руками |
| `SolutionCategory` | upsert по `slug` | Категории, которой нет в источнике, сев **не трогает и не удаляет**. После миграции у неё `taskLabel = ''` и поток `OPERATION_FLOW` — на экране безымянная задача с, возможно, неверным потоком. Сев про каждую предупреждает |
| `FacilityTypeCategory` | upsert по паре | Связи, которой больше нет в `APPLICABILITY`, сев **не удаляет** — только предупреждает. Каждая такая связь показывает задачу на объекте, к которому источник её не относит |
| `Solution` | upsert по `(solutionCategoryId, name)` | **Переименование в источнике заводит вторую строку** — это М-2, приложение B. Смена категории — то же самое |
| `Solution` (чистка) | `deleteMany` | Удаляет `source ∈ (SEED, PARSED)`, чьего **имени** нет ни в одном источнике. `ORGANIZER` не трогает — проверено по условию. Строку, на которую ссылается сохранённый расчёт, не трогает (FK `Restrict`, попытка уронила бы весь сев) |
| `User`, `SavedAnalysis`, `RateLimit` | не пишутся | Сев их не касается вообще |

**Что чистка НЕ защищает.** Защита ровно одна — `savedAnalyses > 0`, и других ссылок на
`Solution` в схеме нет, так что от падения по FK она полна. Но:

* Строка, спасённая ссылкой, остаётся в каталоге **навсегда и без обновлений**: цена и
  производительность в ней заморожены на дате последнего сева, который её знал, а на экране она
  неотличима от актуальной.
* Между `findMany` (счёт ссылок) и `deleteMany` есть окно. Если в него влезет сохранение
  расчёта на удаляемое решение, `deleteMany` упадёт по FK и **уронит сев целиком** — теперь уже
  после того, как всё остальное записано, потому что чистка стоит последней. Вероятность мала,
  но она ровно поэтому и есть причина закрывать трафик на шаге 3.4.
* Сев **не транзакционен**. Падение на середине оставляет базу частично обновлённой. Все шаги
  до чистки идемпотентны, поэтому лечение — повторный запуск; чистка стоит последней именно
  затем, чтобы «повторный запуск» всегда оставался достаточным лечением.

## Приложение B. М-2 — стабильный `slug` у решения (СПРОЕКТИРОВАНО, НЕ ПРИМЕНЕНО)

Личность решения сейчас — пара «категория + имя»: `upsert` идёт по
`solutionCategoryId_name`. Отсюда всё поведение из приложения A: переименование в источнике
создаёт вторую строку, старую спасает от чистки сохранённый расчёт, обновлять её больше некому,
и обе стоят рядом в каталоге. Схема этот сценарий предвидела и закрыла ровно половину: тихое
удаление предотвращено (`onDelete: Restrict`), дубликат — нет.

**Схема этой ветки НЕ меняется** — миграция сюда не входит намеренно: выкат и без неё несёт
пять непроверенных миграций. Ниже — готовый проект на следующий заход.

### B.1 Схема
```prisma
model Solution {
  id   String @id @default(cuid())
  slug String @unique   // ← идентичность. Стабильна при переименовании И при смене категории
  name String           // ← обычное поле, свободно меняется
  ...
  @@unique([solutionCategoryId, name])   // ОСТАВИТЬ
}
```
`slug` глобально уникален, а не в пределах категории: решение, переехавшее в другую категорию,
обязано остаться собой — иначе М-2 просто переезжает в новую форму.

`@@unique([solutionCategoryId, name])` **сохраняется**: без него ничто не помешает двум
визуально одинаковым строкам в одной категории. Побочный эффект — обмен именами между двумя
решениями одной категории в одном прогоне сева упрётся в индекс; это лечится двумя коммитами и
встречается примерно никогда.

### B.2 Миграция (одна, с бэкфиллом)
```sql
-- 1. Сначала nullable: NOT NULL на живой таблице требует значения для каждой строки.
ALTER TABLE "Solution" ADD COLUMN "slug" TEXT;

-- 2. Бэкфилл по парам, известным источникам НА МОМЕНТ ЭТОГО КОММИТА. Список описывает
--    ИСТОРИЮ, а не текущие данные: после применения его не редактируют никогда, иначе
--    миграция начнёт означать не то, что сделала.
UPDATE "Solution" s SET "slug" = v.slug
FROM (VALUES
  ('class-amr-transport',   'AMR: транспортировка и подбор (класс)', 'class-amr-transport'),
  ('class-palletizer',      'Робот-паллетайзер (класс)',             'class-palletizer'),
  ('class-sorter',          'Сортировочный робот (класс)',           'class-sorter'),
  ('class-cleaning',        'Робот-уборщик промышленный (класс)',    'class-cleaning'),
  ('class-cobot-pickplace', 'Кобот: pick-and-place (класс)',         'class-cobot-pickplace'),
  ('class-service-delivery','Сервисный робот доставки (класс)',      'class-service-delivery'),
  ('class-ai-inspection',   'ИИ-инспекция качества (класс)',         'class-ai-inspection'),
  ('class-cleaning',        'Gausium Scrubber 75',                   'gausium-scrubber-75'),
  ('amr',                   'HaiPick A42T',                          'haipick-a42t'),
  ('asrs',                  'Exotec Skypod (станция)',               'exotec-skypod-station'),
  ('asrs',                  'AutoStore (порт)',                      'autostore-port')
) AS v(cat, nm, slug), "SolutionCategory" sc
WHERE sc.id = s."solutionCategoryId" AND sc.slug = v.cat AND s.name = v.nm;

-- 3. Всё остальное — строки организатора и замороженные переименованные — получает
--    заведомо неканонический, но стабильный и уникальный slug. Префикс виден глазом:
--    'legacy-' в каталоге означает «эту строку не обновляет ни один источник».
UPDATE "Solution" SET "slug" = 'legacy-' || "id" WHERE "slug" IS NULL;

-- 4. Теперь ограничения.
ALTER TABLE "Solution" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX "Solution_slug_key" ON "Solution"("slug");
```

Миграция обратно-совместима в одну сторону: старая сборка колонки не знает и продолжает
работать, поэтому её **можно** применить до промоута — в отличие от `global_categories`.

### B.3 Изменения в источниках и в севе
1. `VendorSolutionSeed` и `CuratedSolution` получают поле `slug: string`.
   `SolutionClassSeed` его **уже имеет** — сев просто его игнорирует; половина работы сделана.
2. Все три `upsert` переходят на `where: { slug }`, а `name` и `solutionCategoryId` переезжают
   из `create` в `update`. В этом весь смысл: переименование и переезд между категориями
   становятся ОБНОВЛЕНИЕМ существующей строки.
3. Чистка: `slug: { notIn: [...все slug'и источников] }` вместо `name: { notIn: … }`. Она
   перестаёт быть «по имени, без категории» — исчезает и класс ошибок из приложения A, и
   предупреждение `ДУБЛИКАТ:` в севе, и одноимённая проверка в preflight.
4. Итоговая проверка сверяет `slug`, а не пару `категория / имя`.
5. Тест в `seed-data.test.ts` на уникальность slug'ов классов **уже есть** — расширить его на
   все три источника разом.
6. Предохранитель чистки (`SEED_PRUNE_LIMIT`) остаётся: он защищает от неверного списка
   источников, а не от неверного ключа.

### B.4 Что этим НЕ чинится
Строка, переименованная **до** появления slug'а, уже разъехалась: бэкфилл найдёт её только под
старым именем и выдаст `legacy-<id>`, а сев заведёт рядом каноническую. Такие пары надо слить
руками. Найти их до миграции — пункт preflight «Сев СОЗДАСТ N дубликатов» и предупреждение
`ДУБЛИКАТ:` в логе сева; после слияния перенести `SavedAnalysis.solutionId` на выжившую строку
и удалить проигравшую.
