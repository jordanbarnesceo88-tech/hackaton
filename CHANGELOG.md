# Changelog

All notable changes to this project are documented here.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

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
