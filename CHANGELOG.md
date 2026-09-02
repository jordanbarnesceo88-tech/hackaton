# Changelog

All notable changes to this project are documented here.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Fixed
- **The hero band celebrated solutions the results panel called unprofitable.** `economical` is
  set by `annualSavingsUsd > 0` alone, so it stays true when discounted cash flows never recover
  the CAPEX — and three UI surfaces read it as "good investment". MediCarry M1 rendered the
  celebratory «ОКУПАЕТСЯ ЗА 4.9 года» with «NPV −7 908 985 ₽» beneath it, while the panel below
  said «не окупается в пределах горизонта» and the recommendation starred it ★ as best. 2 of the
  13 seeded solutions. Adds `isViable()` — NPV ≥ 0 **and** a discounted payback inside the
  horizon — gating the hero's celebratory treatment and the ★. Non-viable results now show a
  neutral panel headed «Простой срок окупаемости» with the caveat spelled out. Presentational
  only: the engine's discriminant and every number are unchanged.
- **Assumptions are now bounded — a mistyped digit could produce an authoritative nonsense
  figure and save it into a client report.** Nothing constrained the «Допущения» inputs: no
  `max`, no clamp, no check in `validateAssumptions`. Typing `5` into «Замещение труда (доля)»
  — a fraction — returned an NPV of 3 803 215 against a true 299 373, and a discount rate of
  −0.99 (which the engine permits, since it only guards `> -1`) returned
  61 363 636 327 691 730 ₽. Every value stayed finite, so `invalid_inputs` never fired and the
  number rendered with full confidence. Adds `ASSUMPTION_BOUNDS` with a documented range per
  assumption — physical limits where they exist (24 h/day, 366 days/year, fractions 0..1) and
  generous sanity caps elsewhere — applied at the two boundaries that matter: the panel clamps
  on input, and `validateAssumptions` rejects out-of-range payloads before persistence. **The
  engine is deliberately untouched** and keeps its own `invalid_inputs` guards, so the
  sensitivity tornado can still evaluate degenerate scenarios. 15 new tests.
- **Stale-analysis banner stayed silent when a solution stopped paying back.**
  `resultsDiverged` skipped every field whose recomputed value was not a number, so when
  `discountedPaybackYears` flipped from a number to `null` — "не окупается в пределах
  горизонта", the single most important change a saved analysis can undergo — it compared
  nothing and reported no divergence. The mirror case (null → number) was caught, which is what
  made the asymmetry easy to miss. Null is now compared as a conclusion in its own right,
  before the numeric branch. Four tests cover both directions, null → null, and a stored blob
  missing the key.
- **`prisma generate` now runs at install time — CI and the Vercel path were both broken.**
  Prisma 7 dropped `@prisma/client`'s own postinstall hook, `npm run build` is bare `next build`,
  and the generated client is gitignored — so nothing regenerated it outside the Dockerfile.
  Proven on a clean clone running the exact CI sequence: `npm ci` ✓ → `migrate deploy` ✓ →
  `db:seed` **exit 1** (`MODULE_NOT_FOUND: @prisma/client/default.js`) → `build` **exit 1**.
  The workflow's "runs green the moment a remote exists" comment and `DEPLOY.md §4a`'s claim
  that the build generates the client automatically were both false. Adds
  `"postinstall": "prisma generate"`, and two changes it turns out to require: the Dockerfile's
  `deps` stage now copies the schema before `npm ci` (generate exits 1 without it), and
  `prisma.config.ts` no longer uses `env()`, which threw at config-load time and would have made
  `npm ci` fail for anyone without a `.env`.

### Changed
- **Shared economics row builder (refactor).** The print report re-rendered the same ten
  figures as the calculator's results panel, each spelling out its own money formatting, RU
  year pluralisation and null-payback wording — so a new engine figure had to be added twice.
  Extracted `components/calculator/economics-rows.ts` (`economicsRows()` + `PANEL_LABELS` /
  `REPORT_LABELS`); each surface still lays the rows out in its own markup (2-column print
  grid vs. stacked card) and keeps its own wording for the non-economical and invalid-input
  notices, which genuinely differ. Five tests pin row order, the no-savings truncation, the
  label variants and the never-pays-back wording. **One visual change:** the panel's «Базовые
  затраты на труд/год» value is now bold like its other nine rows and like the report — it was
  the only unbolded value on the card. No output number changes.
- **One `SolutionCapacity` projection (refactor).** The six-field literal mapping a solution
  record down to what the engine consumes was rebuilt by hand in four places — both server
  pages, the calculator shell, and `rankSolutions` — so adding a cost field to the model meant
  editing all four. Extracted `toSolutionCapacity()` into `lib/economics/normalize.ts` and
  routed every call site through it. Structural typing does the narrowing, so the emitted
  object is identical; three tests pin the projection (all fields copied, extras dropped,
  non-default basis preserved). No output number changes.
- **Shared test fixtures for the economics/scene suites (refactor).** Six test files each
  hand-built a full 14-field `AssumptionValues` literal (plus repeated baseline
  `SolutionCapacity` / `FacilityParams` literals — the facility params alone appeared 13
  times). Extracted `lib/economics/fixtures.ts` with `makeAssumptions()` / `makeCapacity()` /
  `makeParams()`, each spreading `DEFAULT_ASSUMPTIONS` (or a documented baseline) then caller
  overrides, so a test now states only the field it exercises. Every fixture value is
  byte-identical to before — the two suites that deliberately pin pre-A2 numbers keep their
  `laborReplacementPct: 0.7` / `residualSupervisionPct: 0` as explicit overrides. Test-only;
  no source file imports it. −60 net lines; all 127 tests green with unchanged assertions.
- **Brand identity & design tokens (#5a).** Replaced shadcn's default pure-grayscale theme with a
  **deep-blue + cyan** brand (`globals.css` oklch tokens, light + dark, brand-blue focus ring, a
  blue→cyan chart ramp for the sensitivity tornado, heading polish). Normalized 12 component/page
  files from ad-hoc `sky/emerald/amber/red` to one token per semantic: **primary** (actions/links/
  hero/★/tornado), **positive** green (savings/margin), **caution** amber (estimates), and
  `destructive` (не окупается/errors). Provenance badges keep their data-source hues; the canvas
  scene is unchanged (its cyan robots now intentionally echo the accent). Visual-only — no layout/
  behavior/copy change; all tests green.

### Added
- **DB-backed rate limiting on login & signup (audit SEC1 / deploy #6).** A fixed-window limiter
  (`lib/auth/rate-limit.ts` + `RateLimit` table) throttles signup (5 / IP / 15 min) and login
  (10 / email+IP / 15 min). Postgres-backed so it works on both single-instance Docker and
  serverless; fails open on DB error. Closes the top pre-launch security item.
- **Regional labor/energy presets (opt-in convenience).** The calculator now offers a "Регион
  (труд/энергия)" dropdown on the Step 3 parameters panel. Selecting a region (Москва,
  Санкт-Петербург, РФ — среднее, or Низкозатратный регион/СКФО) automatically sets both
  `laborCostPerHourUsd` and `energyCostFactor` based on 2025 Rosstat average wages and regional
  industrial-tariff indices. Both values remain fully editable after selection; the presets are
  cited in `docs/data-provenance.md` with a "verify before a live demo" caveat. New assumption
  field `energyCostFactor` (default 1.0, applied as a multiplier on annual energy cost).
- **Hero results band on the calculate page (backlog #4).** A prominent one-glance headline above
  the calculator — «Окупается за N лет» with NPV and ROI, and an estimated-price caveat for
  cited/estimate solutions. Non-economical shows a plain «Не окупается»; invalid inputs hide the
  band (the results panel already notes it). Presentational — reuses the existing computed result.
- **Shareable one-page report (`/report/[id]`):** Saved analyses can now be exported to a
  print-to-PDF view — a clean one-pager showing the facility parameters, calculated results,
  NPV sensitivity tornado, solution provenance (source badge + link), and a disclaimer footer.
  Entry points: a "Отчёт" link on the analyses list (`/analyses`) and an "Открыть отчёт" link
  displayed after save succeeds on the calculator.
- **Real, sourced warehouse products (data credibility).** The fake `RoboPick/StackMax/…`
  warehouse rows are replaced with **3 real robotics products** — Hai Robotics HaiPick A42T
  (`amr`), Exotec Skypod and AutoStore (`asrs`) — seeded as `source: PARSED`. Specs are cited to
  live public pages (`sourceUrl`/`lastVerified`); **prices are shown as clearly-labelled estimate
  ranges** with an "оценка" marker + citation in the comparison table and calculate header, since
  industrial-robot list prices are not published (the ROI engine computes at the range midpoint,
  unchanged). New schema fields `priceEstimated`/`priceLowUsd`/`priceHighUsd`/`priceBasis`; curated
  data in `scripts/parse-sources/warehouse-real.ts` guarded by a data-integrity test; per-figure
  citations + a "verify before a live demo" gate in `docs/data-provenance.md`. Airport/medical/
  other remain badged demo (`SEED`) pending organizer data. CAPEX-only (RaaS deferred).
- **ROI-ranked recommendation + NPV sensitivity on the calculate page (decision engine).** For
  the user's facility, Step 3 now ranks the chosen solution's category siblings by NPV/payback
  ("Рекомендация для вашего объекта", ★ on the best) and lets you switch the primary solution
  **in place** — results, visualization, and save all follow instantly, no reload. Below it, an
  **NPV sensitivity tornado** ("Чувствительность NPV к допущениям") shows how much each
  assumption swings the result at ±25%, exposing the levers behind the number. New pure engine
  modules `lib/economics/recommend.ts` + `sensitivity.ts` (with a behavior-preserving extraction
  of `baseEconomics`/`projectFinance` from `calculate.ts` so the tornado computes honest negative
  NPVs). Spec: `docs/superpowers/specs/2026-08-29-recommendation-sensitivity-design.md`.
- **Break-even labor rate on the calculator.** A note card on the calculate page shows the
  minimum hourly labor cost ($/hr) at which the solution achieves NPV=0 over the projection
  horizon, plus a safety margin indicator (ratio of current cost to break-even rate). Read-only;
  no changes to existing numbers.

### Changed (economics model — output numbers change; signed off 2026-08-25)

> Audit findings A1–A3, spec: `docs/superpowers/specs/2026-08-25-economics-model-revision.md`.
> Each is a separate commit; together they replace the over-optimistic Week-2 savings/ROI.

- **A1 — labor savings now track workload, not raw headcount.** New editable
  `opsPerWorkerPerYear` assumption (default 12500) caps displaced staff:
  `displacedFte = min(staffCount, demandPerYear ÷ opsPerWorkerPerYear)`, and `baseline` +
  savings derive from `displacedFte`. A facility that overstates headcount relative to its
  operation volume can no longer inflate savings (e.g. 1 robot doing 40 ops/day now displaces
  0.8 FTE, not 70% of a 100-person payroll). The Step-3 input is relabelled "Персонал,
  замещаемый решением" and the results show "Замещается персонала (ЭПЗ)". `opsPerWorkerPerYear
  ≤ 0` → `invalid_inputs`. Example (default per-day solution, 400 ops/day, 10 staff): annual
  savings 201k → **159k**, ROI 1648% → **1283%**.
- **A2 — conservative defaults + residual supervision cost.** Default `laborReplacementPct`
  lowered 0.7 → **0.5**, and a new editable `residualSupervisionPct` (default 0.1) retains
  ongoing human oversight: `savings = baseline × replacement × (1 − residual) − opex`. Removes
  the "robots eliminate 70% of all labor at zero running cost" optimism the audit flagged.
- **A3 — discounting, NPV & asset lifecycle.** New editable `discountRate` (0.12) and
  `assetLifeYears` (7). The engine now models yearly cash flows over the ROI horizon, re-buying
  the fleet when assets expire mid-horizon, and reports **NPV** and **discounted payback**
  alongside the (now explicitly labelled) **simple** payback/ROI. `paybackYears`→
  `simplePaybackYears`, `roiPct`→`simpleRoiPct`; adds `npvUsd` and `discountedPaybackYears`
  (null = no payback within the horizon, shown as "более N лет"). Non-positive horizon / asset
  life / discount rate ≤ −1 → `invalid_inputs`. New `lib/economics/finance.ts` (`npv`,
  `discountedPaybackYears`) is unit-tested. Example (default DB assumptions, 500 ops/day, 10
  staff): annual savings **$111k**, simple payback **1.2 г**, discounted **1.4 г**, simple ROI
  **302%**, NPV **+$262k** — versus the old model's 1648% ROI.

### Added
- **Free-text object name on the "Other" path (audit M4 / §8 M4).** The generic facility path now
  offers an optional object name in onboarding, carried via `?obj=` and echoed in the Step-2
  comparison and Step-3 calculation headings, so the flow reads as tailored to the user's object.
- **Data-provenance badges in the comparison table (audit D1, partial).** Each solution shows a
  source badge — демо-данные / данные организатора / открытый источник (linking `sourceUrl`) —
  so the placeholder catalogue is honestly labelled. The import-side validator stays deferred
  until real organizer data exists.
- **Saved analyses can be named (audit U2).** The save control now has an optional name field
  (capped at 120 chars); a blank name falls back to the previous dated default. Two saves on
  the same day are no longer indistinguishable in "Мои расчёты".
- **Security headers (audit SEC1 / DEPLOY §5).** `next.config.ts` now sets Content-Security-
  Policy, X-Frame-Options (DENY), X-Content-Type-Options (nosniff), Referrer-Policy, and HSTS
  on all routes. CSP keeps `'unsafe-inline'` for Next's inline hydration (and `'unsafe-eval'`
  in dev only for HMR) — to be tightened with nonces later. Login/signup **rate-limiting**
  remains deferred (needs a deploy-time shared store), per DEPLOY §5.
- **Editable USD→RUB exchange rate (audit I6 / §8 I6).** The rate moved from a hardcoded
  `USD_TO_RUB` constant into a seeded, editable `usdToRub` assumption. `formatCost(usd, rate)`
  now takes the rate; it's threaded through the calculator results, the visualization, and the
  comparison table (all sourced from the DB assumptions). Default remains 90; editing it in the
  assumptions panel reprices every RUB figure live. Non-positive/non-finite rate falls back to
  the default.
- **Real Step-2 comparison table (audit P1 / §8 I5).** `/compare/[type]` now renders a
  per-category side-by-side table — price, capacity + basis, the **full** OPEX breakdown
  (maintenance + energy + licensing, previously only maintenance was shown), the annual OPEX
  total, and a normalized "цена за ед. годовой производительности" (price ÷ annualized
  throughput, via the engine's `capacityPerYear`; shown only for flow bases, "—" for
  concurrent-stock) — replacing the old catalog cards. Delivers the brief's headline
  "independent comparison" value.

- **Only basis-relevant calculator fields are shown (audit U1 / REFACTORING #6).** `area` is
  relabelled "Площадь, м² (только визуализация)" since it drives only the Step-4 scene, and
  basis-specific assumptions are hidden when they don't apply (`operatingHoursPerDay` only for
  PER_HOUR_FLOW, `turnoverPerDay` only for CONCURRENT_STOCK) — so editing any visible field
  visibly changes the result. No economics-model change.

### Fixed
- **Second code-review pass on the audit-left batch (2026-08-29).**
  - The comparison table's normalized metric is now **"Цена за 1000 ед./год"** (was "за ед.").
    Per-unit annual price is sub-dollar for high-throughput solutions and rounded to "US$0"
    under the whole-unit money formatter, making the headline comparison column useless; per
    1000 units it reads meaningfully (e.g. US$56 / US$960).
  - `resultsDiverged` (P2 revisit banner) now compares the economical/reason discriminant and
    **every** numeric output field, so a model change that shifts only derived figures (NPV,
    ROI, payback, OPEX, displaced FTE) is caught — not just quantity/capex/savings.
  - The save button is **disabled while a save is in flight** ("Сохранение…"), preventing
    duplicate saved rows from a double-click.
  - Removed a stray `scripts/_q.mts` temp file accidentally committed with M4.
- **Revisit fidelity: flag stale saved analyses (audit P2).** Opening a saved analysis restores
  its inputs but the calculator recomputes from the *current* solution row, so a solution-data
  or model change makes the shown numbers differ from what was saved. The calculate page now
  recomputes with the saved inputs against today's data, compares to the stored results, and
  shows an amber "данные/модель изменились — показан пересчёт" banner when they diverge instead
  of silently showing different numbers.
- **Code-review fixes on the audit branch (2026-08-25).**
  - A3 re-CAPEX no longer charges a spurious final-year fleet purchase: the fleet is re-bought
    only when assets expire with productive years left (`t % lifeYears === 0 && t < horizon`),
    and asset life is floored to whole years to match the annual cash-flow model (life must be
    ≥ 1, else `invalid_inputs`). Fixes the case where `assetLifeYears` divides the horizon —
    notably `assetLifeYears === roiHorizonYears`, which previously ~halved ROI and understated
    NPV. **Changes output numbers only for those (now-corrected) configurations.**
  - `displacedFte` is clamped at 0 so a negative param (e.g. a pasted negative `opsPerDay`/
    `staffCount`) can't surface a negative displaced-FTE or negative baseline labour cost.
  - The visualization now shows the neutral "Проверьте параметры" notice for `invalid_inputs`
    instead of the red "не окупается" (which wrongly implied the solution was unprofitable),
    matching the results panel.
  - The discounted-payback "no payback" case now reads "не окупается в пределах горизонта"
    instead of the ungrammatical/rounding-mismatched "более N лет".
  - `validate.ts` derives its assumption-key list from `DEFAULT_ASSUMPTIONS` so a newly added
    assumption is validated automatically instead of being silently stripped from saved payloads.
- **Validate the saved-analysis payload server-side (audit S1).** The save action persisted
  fully client-controlled input as jsonb with no checks. Added tested `lib/analyses/validate.ts`
  (bounded/trimmed `name`, strict finite-number shape for `params` + `assumptions`,
  plain-object `results`); the action now also verifies the solution exists and derives
  `facilityTypeSlug` from it rather than trusting the client's slug. Server-action errors are
  now logged before returning the generic client result (REFACTORING #5).
- **Correct Russian pluralization for the payback period (audit T2).** Payback rendered a
  fixed "X лет" ("1 лет"/"2 лет" are ungrammatical). New tested `lib/format/plural.ts`
  (`pluralRu` + `formatYearsRu`) applies proper noun agreement — "1.0 год", "2.0 года",
  "5.0 лет", and the genitive singular "1.5 года" for fractional durations.
- **Signup no longer 500s on a duplicate-email race (audit E2).** Concurrent signups could
  both pass the pre-insert `findUnique` check and then race on the `User.email` unique
  constraint; the loser threw an unhandled `P2002`. The `create` is now wrapped and P2002 is
  mapped to the same "email уже существует" message. Also removed the dead `redirect` import
  in `lib/auth/actions.ts` (REFACTORING #3).
- **Economics engine no longer leaks `Infinity`/`NaN` for degenerate inputs (audit E1).**
  `computeQuantity` now returns `null` (instead of throwing or dividing by zero) for
  non-positive per-unit capacity, a zero turnover rate with no explicit peak, or a
  zero-valued annualization divisor; `computeEconomics` maps that — plus any non-finite money
  output or non-positive CAPEX — to a typed `{ economical: false, reason: "invalid_inputs" }`
  result. UI (calculator + visualization) narrows on this variant and shows the existing
  "проверьте параметры" notice, replacing the duplicated ad-hoc finiteness checks. No change
  to results for valid inputs; only previously-`Infinity`/`NaN` (masked) cases are affected.
  Added engine tests for each degenerate path.

### Added
- Project scaffolding: `docs/00-idea-brief.md` (fixed source idea, verbatim),
  this changelog. Git repo initialized.
- `docs/01-prd.md` v1: MVP scope, user flow, data model, functional/non-functional
  requirements, success criteria — finalized via brainstorming session.
- `docs/02-execution-plan.md` v1: tech stack (Next.js + TS + Postgres/Prisma +
  Tailwind/shadcn + NextAuth, Vercel deploy), architecture, data strategy (seed data now,
  organizer data + open-source parsing later), economics engine formulas, visualization
  approach (2D parametric scene, real numbers/illustrative motion), 4-week build order,
  risks.
- `docs/superpowers/plans/2026-08-17-week1-foundation.md`: detailed 7-task Week 1
  implementation plan (scaffold → shadcn/ui → Postgres+Prisma → seed → data layer+tests →
  Step 1 picker → Step 2 catalog).
- Next.js app scaffolded (Next 16.3.1 / React 19.2.8 / Tailwind v4) + shadcn/ui base
  components (button, card, label, radio-group). [Week 1 Tasks 1-2]
- Local Postgres via Docker Compose + Prisma 7 schema: 5 models (`Industry`,
  `FacilityType`, `SolutionCategory`, `Solution`, `FacilityExample`) + `SolutionSource`
  enum, initial migration. Prisma 7 driver-adapter setup (`prisma.config.ts`,
  `@prisma/adapter-pg`), since Prisma 7 requires an explicit adapter to connect. [Week 1
  Task 3]
- Seed data: 4 industries / 4 facility types / 8 solution categories / 14 solutions, all
  tagged `source: SEED` for provenance. [Week 1 Task 4]
- Data-access layer (`lib/db/`) with Vitest integration tests run against the seeded
  database. [Week 1 Task 5]
- Step 1 `/onboarding` industry + facility type picker. [Week 1 Task 6]
- Step 2 `/compare/[type]` solution catalog, plus the RUB-primary + USD currency
  formatter (`lib/format/currency.ts`) it uses to display solution prices. [Week 1 Task 7]
- `capacityBasis` enum + `Assumption` Prisma model (migration). [Week 2]
- Pure economics engine in `lib/economics/` — capacity-unit normalization (C1: per-hour/per-day
  flow + concurrent-stock sizing) and `computeEconomics` (OPEX×qty, labor-replacement %, savings≤0
  guard, undiscounted payback/ROI), fully unit-tested; plus the assumptions row→values mapper. [Week 2]
- Seeded `capacityBasis` on all 14 solutions + 8 editable economic assumptions. [Week 2]
- Query helpers `getSolutionForCalc` / `getAssumptions`; "Рассчитать экономику" links on Step 2. [Week 2]
- Step 3 `/calculate/[solutionId]`: server page + live client calculator (editable assumptions,
  recompute-on-change, RUB+USD via formatCost, NaN/Infinity finiteness guard, peak-load input for
  concurrent-stock solutions). [Week 2]
- Step 4 visualization: a 2D Canvas panel on the `/calculate` page showing robots operating on a
  per-vertical facility layout (warehouse racks / airport belt+gates / medical rooms / generic zones),
  driven live by the Step 3 params + economics result.
- Pure, unit-tested scene engine in `lib/scene/` — deterministic layout generator with a 6×6 grid
  clamp for extreme inputs, a waypoint robot simulator, and KPI derivations (deployed capacity,
  utilization %, ROI accrual) reusing the economics annualization helpers.
- Live KPI panel: robots-in-work (capped at 24 with a "показано 24 из N" badge), utilization %, and
  an animated "накопленная экономия" bar filling to one year's savings in RUB+USD; a
  not-economical result shows the "не окупается" state. [Week 3]
- Accounts (Auth.js v5 credentials, bcrypt-hashed passwords, JWT sessions): signup/login,
  header auth state, logout. Anonymous users can still use Steps 1-4; login is required only
  to save. [Week 4]
- Save & revisit: a logged-in user can save a completed analysis and reopen it from "Мои
  расчёты" (`/analyses`); saved analyses are strictly user-scoped. [Week 4]
- Deploy-ready config: `output: "standalone"`, multi-stage `Dockerfile`, `.dockerignore`, and
  a `docs/DEPLOY.md` runbook (managed Postgres + env vars + migrate/seed + Vercel/Docker). [Week 4]

### Changed
- Applied an Opus 4.8 review of all planning docs (2 Critical / 8 Important / 6 Minor;
  full text in `.superpowers/sdd/2026-08-17-week1-foundation/opus-doc-review.md`):
  - **Currency decision:** display RUB primary + USD in parens via an editable exchange
    rate (Week 1: constant in `lib/format/currency.ts`; Week 2: `Assumption` table).
  - Week 1 plan corrected: `.env.example` un-ignored (M1); `SolutionCategory` slug now
    unique per-facility-type not globally (M5); seed script + Vitest load `DATABASE_URL`
    via dotenv (I4); centralized pinned-locale currency formatter fixes a hydration risk
    (I6); package renamed from `rrp-scaffold` (M6); stack references corrected to the real
    Next 16 / Tailwind v4 (I3); PRD "share" contradiction fixed (M3).
  - `docs/02-execution-plan.md` §8 records deferred findings to resolve before their week:
    economics normalization/guards (C1, C2, I1, I2, M2) before Week 2; viz input bounds
    (I7) before Week 3; Week-4 rebalance + real deploy-DB tasks (I8); comparison spec (I5)
    and "Other" free-text (M4) as doc follow-ups.
