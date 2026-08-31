# Design: End-to-End Tests (Playwright) + CI

> Status: approved via brainstorming 2026-08-31. Backlog #7 ("it's real and robust"). Adds
> Playwright E2E over the full 4-step flow (incl. auth → save → report) and a ready-to-run
> GitHub Actions CI workflow (unit + E2E against a Postgres service). Additive test infra — no
> product-logic changes (at most a couple of `data-testid`s if a text anchor is ambiguous).

## Goal & context

The app has 106 unit tests but **zero E2E coverage and no CI** — for a product where the UI *is*
the deliverable, the 4-step flow rests on manual smoke. This adds:
1. **Playwright E2E** exercising onboarding → compare → calculate (hero/results/recommendation/
   sensitivity) → signup → save → report — everything built this session.
2. **A GitHub Actions workflow** that runs unit + E2E on push/PR against a Postgres service.

### Constraints surfaced by exploration
- **No git remote / no `.github/workflows`.** CI can't run *for real* until the repo is pushed to
  GitHub. Decision: **write a complete, ready-to-run `ci.yml`** — inert until a remote exists,
  green the moment one does. Stated honestly in the workflow header + README.
- **Playwright not installed** → new devDependency (`@playwright/test`) + **Chromium only** (lean
  install; cross-browser out of scope).
- **Vitest default glob catches `*.spec.ts`** → vitest must **exclude `e2e/`**, or it will try to
  run Playwright specs as unit tests (they import `@playwright/test`, not vitest — hard failure).

## Tooling & configuration

- `@playwright/test` devDependency; `npx playwright install chromium` (with-deps in CI).
- **`playwright.config.ts`:** `testDir: "e2e"`, `baseURL: "http://localhost:3000"`, Chromium
  project, retries: 1 in CI / 0 locally, and a **`webServer`** block:
  `command: "npm run build && npm run start"`, `url: baseURL`, `reuseExistingServer: !process.env.CI`,
  generous `timeout`. So one command works locally and in CI.
- **`package.json` script:** `"test:e2e": "playwright test"`.
- **`vitest.config.mts`:** add `test.exclude: [...configDefaults.exclude, "e2e/**"]` (import
  `configDefaults` from `vitest/config`) so `npm test` (unit) never touches Playwright specs.
- **DB:** E2E runs against the seeded Postgres (local: 5433 docker-compose; CI: `postgres:16`
  service). The run assumes migrate + seed have happened (CI does them; locally the dev DB is
  already seeded).

## E2E specs (`e2e/`)

Selectors prefer role/text (`getByRole`, `getByText`) — the Russian UI gives stable, readable
text anchors. Add a minimal `data-testid` only where text is ambiguous (YAGNI).

1. **`flow.spec.ts` — anonymous 4-step happy path**
   - `/onboarding`: select «Торговля» → «Склад» → click «Перейти к сравнению решений».
   - `/compare/warehouse`: assert a **real product** (one of HaiPick / Exotec / AutoStore), the
     **«оценка»** price marker, and an **«открытый источник»** provenance link are present.
   - Click a «Рассчитать» link → `/calculate/[id]`.
   - Assert the **hero band** (text «Окупается за» or «Не окупается»), the **results panel**
     («CAPEX»), and the **sensitivity** heading («Чувствительность NPV») render.

2. **`switch.spec.ts` — in-place recommendation switch**
   - Go to a calculate page for a warehouse `asrs` solution (Exotec/AutoStore — guaranteed ≥2
     siblings). Assert the **recommendation panel** («Рекомендация для вашего объекта») lists ≥2.
   - Capture the current URL; click «Сделать основным» on a non-selected row.
   - Assert the header/results reflect the newly selected solution **and the URL is unchanged**
     (in-place, no navigation).

3. **`auth-report.spec.ts` — signup → save → report**
   - `/signup`: register a **unique** email (`e2e+${Date.now()}@example.com`), password ≥8.
   - Navigate to a calculate page → click «Сохранить расчёт» → assert «Сохранено» and the
     **«Открыть отчёт»** link appears.
   - Follow the link → `/report/[id]`: assert «Отчёт ROI», a hero/economics figure, and the
     disclaimer «не оферта» render (the printable one-pager).

## CI workflow (`.github/workflows/ci.yml`)

`on: [push, pull_request]`, single Ubuntu job:
- `services: postgres:16` (user `rrp` / pass `rrp_dev_password` / db `robotization_roi`) on 5432,
  with a `pg_isready` health check.
- Steps: checkout → `actions/setup-node@v4` (node 20, `cache: npm`) → `npm ci` →
  `npx prisma migrate deploy` → `npm run db:seed` → `npm run build` → `npx vitest run` →
  `npx playwright install --with-deps chromium` → `npm run test:e2e`.
- On failure: `actions/upload-artifact` the `playwright-report/`.
- Env: `DATABASE_URL=postgresql://rrp:rrp_dev_password@localhost:5432/robotization_roi`,
  `AUTH_SECRET` a throwaway CI constant, `CI: true`.
- Header comment: "Runs once this repo has a GitHub remote; until then run `npm run test:e2e`
  locally."

## Edge cases & flake-avoidance
- **No fixed sleeps** — rely on Playwright auto-waiting on role/text locators; `webServer` waits
  for a 200 before tests start.
- **Determinism:** unique per-run signup email (no cleanup, no collision); assert on the real
  seeded products by **vendor/marker**, never a hardcoded price (prices are estimates that drift).
- **Switch test** uses a warehouse `asrs` solution (Exotec + AutoStore ⇒ ≥2 siblings guaranteed).
- **Report test** follows the save-returned link rather than guessing a URL.
- Chromium only; retries 1 in CI to absorb rare cold-start jitter.

## "Done"
- `npm run test:e2e` green **locally** against the seeded DB (run it as the acceptance check).
- `npm test` (unit) still green (106); `npm run build` exit 0.
- `ci.yml` committed and YAML-valid; README/DEPLOY note that CI activates on adding a remote.
- No product-logic change (only test infra + config + at most minor `data-testid`s).

## Out of scope
- Cross-browser (Firefox/WebKit); visual-regression snapshots; actually connecting a GitHub
  remote (needs the user's account); seeding a dedicated test DB separate from dev.
