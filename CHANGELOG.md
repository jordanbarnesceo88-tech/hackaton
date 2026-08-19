# Changelog

All notable changes to this project are documented here.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

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
