# Fast deployment — GitHub → managed host

The 30–45 minute path from this laptop to a public URL. The full runbook, including the
security posture and the `npm audit` assessment, stays in [DEPLOY.md](./DEPLOY.md); this file
is the ordered checklist.

**Recommended stack: GitHub (code) + Neon (Postgres) + Vercel (hosting).** Why those three is
answered in §6.

---

## 0. What this app actually needs

Read this before choosing a host — it rules two options out.

| Requirement | Consequence |
|---|---|
| Every route is server-rendered (`ƒ` for all 10 in `next build`) | **Static hosting is impossible.** No GitHub Pages, no S3, no Netlify "static site". |
| Server Actions + Auth.js credentials login | Needs a real Node runtime, not an edge/static CDN. |
| Postgres via the Prisma **driver adapter** (`@prisma/adapter-pg`) | Needs a `DATABASE_URL` at runtime; needs a **pooled** URL on serverless. |
| `prisma migrate deploy` + `npm run db:seed` | The DB must be migrated *and* seeded, or the catalog is empty and every page 404s. |
| Two secrets | `DATABASE_URL`, `AUTH_SECRET`. That is the whole list. |

Node 20.9+ (the Docker image pins `node:20-alpine`; local dev is on 22).

---

## 1. Pre-flight: prove the tree is green (5 min)

```bash
cd ~/robotization-roi-platform
docker compose up -d                       # local DB on host port 5433
lsof -ti:3000 | xargs kill -9 2>/dev/null  # a stale dev server makes e2e test the OLD build
npx tsc --noEmit                    # 0 errors
npx --yes vitest run < /dev/null    # 238 passing / 24 files
npm run lint -- --max-warnings=0    # silent = pass
npm run build                       # 0 errors
npx playwright test                 # 4 passing
```

All five must be clean. `< /dev/null` on vitest is not optional — without it the runner waits
for stdin and looks hung.

## 2. Decide what you are deploying

The work lives on `refactor-pass`, 41 commits ahead of `master`, unmerged (the brief requires
sign-off before a merge). Pick one:

```bash
# (a) sign off and merge — deploy master
git checkout master && git merge --no-ff refactor-pass && git checkout refactor-pass

# (b) or leave master alone and point the host at the branch (Vercel: set the Production
#     Branch to refactor-pass in Settings → Git)
```

## 3. Push to GitHub **[needs your account]**

There is no remote configured yet.

```bash
gh repo create robotization-roi-platform --private --source=. --remote=origin
git push -u origin master          # and/or: git push -u origin refactor-pass
```

Nothing secret is in the tree — `.env*` is gitignored and `.env.example` holds only
placeholders. Confirm before pushing:

```bash
git ls-files | grep -E '^\.env' ; echo "expect only .env.example"
```

`.github/workflows/ci.yml` starts running the moment the remote exists — it has been inert
until now.

## 4. Provision Postgres **[needs your account]**

[neon.tech](https://neon.tech) → new project → **copy both connection strings**:

- the **pooled** one (host contains `-pooler`) → this becomes `DATABASE_URL` on the host;
- the **direct** one → used only for migrations, from your laptop.

They are not interchangeable. `@prisma/adapter-pg` opens a pool per serverless instance, so the
runtime needs the pooler; `prisma migrate deploy` takes advisory locks that a transaction-mode
pooler can drop, so migrations go over the direct URL.

Migrate and seed once, from your machine:

```bash
DATABASE_URL="<DIRECT url>" npx prisma migrate deploy
DATABASE_URL="<DIRECT url>" npm run db:seed
DATABASE_URL="<DIRECT url>" npx prisma migrate status   # expect "up to date"
```

The seed is idempotent — safe to re-run.

## 5. Deploy on Vercel **[needs your account]**

1. [vercel.com/new](https://vercel.com/new) → import the GitHub repo. Framework preset
   auto-detects as Next.js; **change nothing** in Build & Output Settings.
2. Environment Variables (Production + Preview):

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | the **pooled** Neon URL |
   | `AUTH_SECRET` | `openssl rand -base64 32` — generate a fresh one, don't reuse the dev value |

   `AUTH_URL` is not needed: `auth.ts` sets `trustHost: true` and Vercel supplies the host.
3. Deploy.

Three things that are already handled, so you don't have to configure them:

- `postinstall: prisma generate` runs on every install, so Vercel's dependency cache can't
  serve a stale Prisma client — the classic Vercel/Prisma failure.
- `output: "standalone"` in `next.config.ts` is for the Docker image. Vercel's builder produces
  its own output and ignores it. If a build ever objects, deleting that one line is the entire
  fix and nothing else depends on it except the Dockerfile.
- Security headers (CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy) ship
  from `next.config.ts`, not from host config, so they survive a host change.

**Do not** add `prisma migrate deploy` to the Build Command. It would run on every preview
deploy against the pooled URL — both of the things §4 says not to do. Migrations stay manual
and deliberate; there is one migration path and you own when it runs.

## 6. Or Netlify — read this first

Netlify works, with one honest caveat you should weigh before spending time on it: Next's own
deployment docs (`node_modules/next/dist/docs/01-app/01-getting-started/17-deploying.md`,
shipped with the version installed here) list **Vercel and Bun as verified adapters** that run
the full Next.js compatibility suite, and place Netlify under *"not built on the public Adapter
API and not verified by the Next.js team, so feature support and compatibility may vary."*
This app is Next **16.3.1** — new enough that the runtime lag is a real risk, not a theoretical
one.

If you deploy there anyway:

1. Netlify → Add new site → Import from GitHub.
2. Build command `npm run build`, publish directory `.next`; let Netlify install its Next.js
   runtime plugin (it auto-detects).
3. Same two environment variables as §5.
4. Smoke-test **login specifically** (§7 step 3). Auth.js in a Lambda-backed runtime is where
   an unverified adapter breaks first: cookie handling on Server Actions.

**GitHub Pages cannot host this app at all** — it serves static files only, and every route
here is server-rendered. GitHub's role in this stack is the git remote and CI.

## 7. Smoke-test the live URL (5 min)

Do all four; two of them exercise paths that only break in production.

1. `/` loads and the industry picker renders → env + DB reachable.
2. `/compare/warehouse` shows solutions → the **seed ran**. An empty table here means step 4
   was skipped or ran against a different database.
3. Sign up with a real address, then **log out and log back in** → `AUTH_SECRET` is set and
   cookies work over HTTPS.
4. Run a calculation → Сохранить расчёт → Открыть отчёт → print preview. The report must print
   **light** even if your OS is in dark mode, and the figures in the report must match the
   panel exactly.

## 8. Two chores, once, after the first deploy

```bash
# a) Verify the cited product figures before showing this to anyone
npm run check:sources     # non-zero if any citation is older than 180 days
```

`docs/data-provenance.md` promises every real figure is checked before it is shown; this is
that gate. Deliberately not in CI — it would turn the build red on a date rollover that no
commit caused.

**b) Schedule a prune of the rate-limit table.** One row accumulates per (email+IP) and per IP;
a stuffing burst against random addresses can add many:

```sql
DELETE FROM "RateLimit" WHERE "windowStart" < now() - interval '1 day';
```

Daily is plenty. Neon can run it from a scheduled query; a Vercel Cron hitting a tiny protected
route works too.

## 9. Rolling back

Vercel keeps every deployment: Deployments → the previous one → **Promote to Production**.
Instant, no rebuild. Note that this does **not** roll back the database — if a deploy included
a migration, roll the code back first, then decide about the schema separately. There is one
destructive migration in the history (`20260903172455_saved_analysis_solution_fk` deletes
orphaned rows before adding the FK); it is not reversible by re-running an older build.

---

### Cost, so there is no surprise

Neon free tier and Vercel Hobby carry this comfortably. Vercel Hobby forbids commercial use —
if this is shown to paying clients, that is the Pro plan, not a technicality to ignore.
