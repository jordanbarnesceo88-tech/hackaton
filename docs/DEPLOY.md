# Deployment Runbook

> Deploying for the first time? Follow [DEPLOY-QUICKSTART.md](./DEPLOY-QUICKSTART.md) — the
> ordered GitHub → Neon → Vercel path, with the pooled/direct URL split and the smoke tests.
> This file is the reference behind it: security posture, rate limiting, `npm audit`.

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

## 3. Migrate + seed (once, against the managed DB)
```bash
DATABASE_URL="<DIRECT url>" npx prisma migrate deploy
DATABASE_URL="<DIRECT url>" npm run db:seed
DATABASE_URL="<DIRECT url>" npx prisma migrate status   # expect "up to date"
```
Both are idempotent (the seed upserts, and skips pruning any demo row a saved analysis
references). Keep this manual: putting `migrate deploy` in a host build command runs it on every
preview deploy, over the pooled URL.

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
