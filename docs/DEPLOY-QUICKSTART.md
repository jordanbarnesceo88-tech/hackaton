# Запуск и развёртывание: быстрый путь

> Упорядоченный путь от клона репозитория до работающего стенда (ТЗ §4.2.3, §6.2, §8.2.2).
> Основной путь — **Docker одной командой** (раздел 2): он проверяется в CI на каждый push.
> Без Docker — **локальный запуск** (раздел 3) и **проверка на чистом экземпляре** (раздел 4).
> Публичный стенд — **Vercel и новая база Neon** (раздел 6).
>
> Полный справочник (безопасность, `npm audit`, выкладка поверх базы прежней модели) —
> [DEPLOY.md](./DEPLOY.md).

---

## 1. Что нужно приложению

| Требование | Следствие |
|---|---|
| Все 43 маршрута серверные (`ƒ` в `next build`, по сборке CI на коммите `b112b35`) | статический хостинг невозможен: нужен Node.js-сервер |
| Серверные действия и вход Auth.js по паролю | нужна среда Node, не edge и не CDN |
| PostgreSQL через драйвер-адаптер Prisma (`@prisma/adapter-pg`) | `DATABASE_URL` при работе; на serverless — строка через пул соединений |
| `prisma migrate deploy` и `npm run db:seed` | без сева каталог, нормативы и демо-аккаунты пусты |
| Секреты | `DATABASE_URL`, `AUTH_SECRET`; по желанию `DEMO_USER_PASSWORD`, `DEMO_ADMIN_PASSWORD` (читает только сев), `ADMIN_API_TOKEN` |
| Node.js | 20.9 и новее (образ Docker — `node:20-alpine`) |

---

## 2. Путь A — Docker одной командой

Нужны Docker с Compose v2 (команда `docker compose`, есть в Docker Desktop) и доступ в
интернет на время первой сборки: `npm ci` и шрифты `next/font/google` скачиваются при сборке.

```bash
git clone <репозиторий> && cd <каталог>
docker compose up --build
```

Первая сборка идёт ориентировочно 5–10 минут, следующие быстрее за счёт кеша слоёв. Когда в логе
появится строка сервера Next.js о готовности, откройте http://localhost:3000.

Что происходит по порядку:

| Сервис | Что делает | Когда готов |
|---|---|---|
| `db` | Postgres 16, данные в томе `rrp_pgdata` | `pg_isready` отвечает по TCP |
| `migrate` | `prisma migrate deploy`, затем сев: справочники, каталог, параметры, нормативы, демо-аккаунты, демо-проект | завершился с кодом 0 |
| `app` | приложение Next.js (standalone) на порту 3000 | `GET /api/health` → 200 |

Демо-аккаунты:
- пользователь — `demo@demo.local` / `demo-user-2026`;
- администратор — `admin@demo.local` / `demo-admin-2026`.

Сев идемпотентен, поэтому повторный `docker compose up` безопасен: данные и созданные
проекты сохраняются в томе. Демо-проект `demo-warehouse` при каждом севе создаётся заново.

Проверка без браузера:

```bash
curl http://localhost:3000/api/health
# {"ok":true,"db":true,"modelVersion":"tz-1.0.0","simModelVersion":"sim-1.0.0"}
```

Переменные, которые можно задать в shell или в файле `.env` рядом с `docker-compose.yml`:

| Переменная | По умолчанию | Зачем |
|---|---|---|
| `AUTH_SECRET` | демонстрационное значение | Обязательно задать своё на стенде, доступном извне: `openssl rand -base64 32` |
| `DEMO_USER_PASSWORD`, `DEMO_ADMIN_PASSWORD` | `demo-user-2026`, `demo-admin-2026` | Пароли демо-аккаунтов, задаются при севе |
| `ADMIN_API_TOKEN` | не задан (вход по токену выключен) | Запись через API v1 заголовком `Authorization: Bearer …` |
| `APP_PORT`, `DB_PORT` | 3000, 5433 | Если эти порты на хосте заняты |

Частые ситуации:
- **Порт занят** (`bind: address already in use`): `APP_PORT=3001 docker compose up --build`,
  затем откройте http://localhost:3001. Для базы — `DB_PORT`.
- **Приложение не стартует**, `app` ждёт `migrate`: смотрите `docker compose logs migrate`.
  Ошибка миграции или сева останавливает запуск намеренно, чтобы не показывать пустой каталог.
- **После изменения кода** выполните `docker compose up --build`: без `--build` запустятся
  старые образы.
- **Начать с чистой базы**: `docker compose down -v` (удалит том с данными), затем
  `docker compose up --build`.
- **Вход при общем адресе.** В Docker все запросы из браузера хоста приходят с одного адреса
  шлюза, поэтому лимит попыток входа по IP — 50 за 15 минут — общий для всех вкладок и
  пользователей этой машины. Для демо-аккаунтов лимит по почте поднят до 100.
- `AUTH_URL` в compose не передаётся намеренно: адрес берётся из запроса (`trustHost`), и
  вход работает и по `localhost`, и по IP машины. HTTPS compose не настраивает; на
  публичном стенде поставьте перед приложением обратный прокси с TLS.

---

## 3. Путь B — локально без Docker

Нужны Node.js 20.9+ и PostgreSQL 16 (любой: локальный сервис, облачный). По умолчанию
`.env.example` смотрит на `localhost:5433`, пользователь `rrp`, база `robotization_roi`.

```bash
npm ci
cp .env.example .env          # затем впишите AUTH_SECRET: openssl rand -base64 32
                              # и при другой базе — свой DATABASE_URL
npx prisma migrate deploy     # 12 миграций, последняя — 20260924120000_tz_v2
npm run db:seed               # справочники v1 и v2, каталог, нормативы, демо-аккаунты, демо-проект
npm run build
npm start                     # http://localhost:3000
```

- `npm run db:seed` печатает отчёт синхронизации, итоговые числа демо-проекта и строку «изменений
  нет» или «изменено записей — N». Второй прогон в новом слое ничего не меняет, кроме
  пересоздания демо-проекта.
- `AUTH_SECRET` обязателен для `npm start`: без него Auth.js в production отдаёт 500.
- Для разработки вместо `build` и `start` — `npm run dev`.
- Никогда не выполняйте `prisma migrate reset` и `prisma db push` на базе с данными: первая
  удаляет все данные, вторая обходит историю миграций.

Демо-числа, которые должны совпасть с презентацией:

```bash
npx tsx scripts/print-demo-numbers.ts              # таблицы в консоль
npx tsx scripts/print-demo-numbers.ts --markdown   # то же, что docs/submission/demo-numbers.md
```

---

## 4. Проверка на чистом экземпляре без Docker

Если Docker недоступен, тот же путь проверяется на локальном Postgres (порт 5433, как в
`.env.example`):

```bash
npm run build
npm run check:fresh               # полный прогон
npm run check:fresh -- --dry-run  # только предпосылки, ничего не создаёт
```

Скрипт создаёт временную базу `rrp_fresh_<время>` и выполняет в ней миграции и сев. Затем
поднимает собранный сервер на `127.0.0.1:3100`, проверяет `/api/health`, `/` и `/demo`,
печатает отчёт и удаляет временную базу. Рабочую базу из `.env` он не меняет. Последняя строка
вывода — итог, код выхода 0 или 1. Скрипт отказывается работать с нелокальным `DATABASE_URL`
и перед удалением сверяет имя базы с шаблоном.

Для файла-доказательства запускайте из bash: в Windows PowerShell 5.1 оператор `>` пишет
UTF-16. Пример: `npx tsx scripts/fresh-instance-check.ts > docs/submission/fresh-instance-log.txt`.

В CI тот же путь в образах проходит задача `docker` (`.github/workflows/ci.yml`) на каждый push.

---

## 5. Проверка дерева перед выкладкой

```bash
npx tsc --noEmit --incremental false               # 0 ошибок
npx vitest run --project unit < /dev/null          # чистые модули
npx vitest run --project db < /dev/null            # тесты на настоящей базе (после миграций и сева)
npm run lint -- --max-warnings=0                   # тишина — значит, чисто
npm run build                                      # 43 маршрута, все ƒ
npx playwright install chromium                    # один раз
npm run test:e2e                                   # собирает и запускает приложение сам
```

`< /dev/null` у vitest обязателен: без него раннер ждёт ввода и выглядит зависшим. Перед e2e
остановите сервер на порту 3000 — иначе тесты пойдут против старой сборки.

Последний прогон CI (коммит `b112b35`, запуск 36136864124): Vitest — 102 файла, 1473 теста,
все зелёные; e2e — 10 тестов, все зелёные; задача `docker` — `/api/health` ответил через 5 с,
`/` и `/demo` — 200. Тесты нового пути на 1366×768 добавляются в волне W4.

---

## 6. Vercel и новая база Neon

Публичный стенд для жюри — отдельный проект Vercel с **новой, пустой** базой Neon.

> **Правила.**
> - **Не мигрировать базу прежней боевой версии.** На ней живут пользователи и расчёты
>   модели v1; выкладка поверх неё — отдельная процедура ([DEPLOY.md](./DEPLOY.md), §3) с
>   дампом, окном недоступности и проверками. Для стенда по ТЗ она не нужна.
> - **Никогда не выполнять `prisma migrate reset`** и `prisma db push` против облачной базы.
> - Миграции и сев — вручную и по прямой строке подключения, не в команде сборки.

### 6.1 База

Создайте базу через Vercel, чтобы строки подключения попали в проект сами (нужен Vercel CLI
v59 и новее — используйте `npx vercel@latest`):

```bash
vercel install neon --name <имя-базы> -e production -e preview
```

Первый запуск останавливается с `integration_terms_acceptance_required` и `verification_uri`:
примите условия в браузере один раз и повторите команду. Из переменных, которые появятся в
проекте, важны две:
- `DATABASE_URL` — **через пул** (хост содержит `-pooler`): на ней работает приложение;
- `DATABASE_URL_UNPOOLED` — **прямая**: по ней идут миграции и сев.

Они не взаимозаменяемы: `@prisma/adapter-pg` открывает пул на каждый экземпляр serverless,
поэтому приложению нужен пулер, а `prisma migrate deploy` берёт advisory-блокировку, которую
пулер в режиме транзакций может потерять.

### 6.2 Миграции и сев с вашей машины

```bash
vercel env pull .env.deploy --environment=production --yes
DATABASE_URL="<DATABASE_URL_UNPOOLED>" npx prisma migrate deploy
DATABASE_URL="<DATABASE_URL_UNPOOLED>" DEMO_USER_PASSWORD="<пароль>" DEMO_ADMIN_PASSWORD="<пароль>" npm run db:seed
DATABASE_URL="<DATABASE_URL_UNPOOLED>" npx prisma migrate status   # ожидается «up to date»
```

- Переменные — в `.env.deploy`, **не** в `.env.local`: Next загружает `.env.local` раньше
  `.env`, и облачные значения молча перенаправили бы локальные `npm run dev` и тесты (они
  создают и удаляют пользователей) в облачную базу.
- `npm run db:seed` на новой базе засевает справочники v1 и v2, каталог (188 продуктов),
  нормативы, параметры, демо-аккаунты и демо-проект `demo-warehouse`. Сев идемпотентен.
- Пароли демо-аккаунтов задайте свои и передайте жюри отдельно, не в репозитории.

### 6.3 Проект Vercel

1. Импортируйте репозиторий на vercel.com/new или выполните `vercel link --yes --project <имя>`
   и `vercel deploy --prod --yes`. Шаблон определится как Next.js; настройки сборки не меняйте.
2. Переменные окружения (Production и Preview):

   | Имя | Значение |
   |---|---|
   | `DATABASE_URL` | строка Neon **через пул** |
   | `AUTH_SECRET` | новое значение `openssl rand -base64 32`, не значение разработки |
   | `ADMIN_API_TOKEN` | по желанию, не короче 16 символов |

   `AUTH_URL` не нужен: в `auth.ts` стоит `trustHost: true`, адрес даёт Vercel.
3. Выкладка.

Что уже учтено:
- `postinstall: prisma generate` выполняется при каждой установке, поэтому кеш зависимостей
  Vercel не подсунет устаревший клиент Prisma.
- `output: "standalone"` включается только вне Vercel (`process.env.VERCEL ? undefined :
  "standalone"`): режим standalone ломает шаг Vercel после сборки, а образу Docker он нужен.
- Заголовки безопасности (CSP, HSTS, X-Frame-Options, X-Content-Type-Options,
  Referrer-Policy) отдаёт `next.config.ts`, поэтому они не зависят от хостинга.
- `exceljs` вынесен в `serverExternalPackages`.

**Не добавляйте** `prisma migrate deploy` в команду сборки: она выполнялась бы на каждой
preview-выкладке и через пулер.

### 6.4 Дымовая проверка стенда

1. `https://<стенд>/api/health` → `{"ok":true,"db":true,…}`.
2. `/demo` открывается, в шаге 6 — таблица сценариев, в шаге 7 — имитация с вердиктом.
3. `/catalog` показывает продукты, карточка `/catalog/ronavi-h1500` — характеристики с
   источниками.
4. Вход `demo@demo.local` → «Мои проекты» → «Склад организатора (демо)» → числа совпадают с
   [submission/demo-numbers.md](./submission/demo-numbers.md), раздел «Новый проект со
   сценариями по умолчанию» → «Отчёт (PDF)» → предпросмотр печати.
5. Выход, вход `admin@demo.local` → в шапке есть «Админка», `/admin` открывается.

### 6.5 Откат и регламент

- Vercel хранит все выкладки: Deployments → предыдущая → **Promote to Production**. База при
  этом не откатывается.
- Раз в сутки чистите таблицу лимитов:
  `DELETE FROM "RateLimit" WHERE "windowStart" < now() - interval '1 day';`
  (запланированный запрос Neon или Vercel Cron).
- Бесплатные тарифы Neon и Vercel Hobby выдерживают демонстрацию; Hobby запрещает
  коммерческое использование — для показа платящим клиентам нужен Pro.
