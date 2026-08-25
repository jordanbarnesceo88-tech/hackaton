# Execution Plan

> Status: v1 — approved via brainstorming session, 2026-08-17.
> The idea itself ([00-idea-brief.md](./00-idea-brief.md)) is fixed; this document is
> about *how* we build it: architecture, tech stack, data strategy, build order.
>
> Constraints this plan was made under: solo developer + AI pairing, 3-4+ weeks until
> demo, organizer data (solutions table, facility examples, source list) not yet in hand.

## 1. Tech stack

Next.js 14+ (App Router), TypeScript throughout. Postgres via Prisma. Tailwind + shadcn/ui
for UI. NextAuth for accounts. Deployed on Vercel. Single framework end-to-end (UI + API
routes + auth) — fastest path for solo+AI development on this timeline, and matches the
`nextauth-authentication`, `deployment-patterns`, and `docker-patterns` skills already
installed.

## 2. Architecture

Single Next.js app:

```
app/
  (auth)/            — login/signup pages, NextAuth routes
  (app)/
    onboarding/       — Step 1: industry + facility type picker
    compare/[type]/   — Step 2: solution catalog + comparison
    calculate/        — Step 3: params form + economics results
    visualize/        — Step 4: 2D scene + live KPIs
  api/                — route handlers (solutions, calc, session)
lib/
  economics/          — pure calculation functions (OPEX/CAPEX/ROI/payback)
  scene/              — layout generator + animation engine for step 4
  db/                 — Prisma client + queries
prisma/
  schema.prisma
scripts/
  parse-sources/      — offline scraper/parser scripts (run manually, not user-facing)
  seed.ts             — placeholder data for all 3 verticals + Other
docs/                 — this planning doc set
```

Each of the 4 user-facing steps writes its selections into a `Session` record. Step 4
renders off the Step 3 output rather than recomputing — keeps the "live KPIs" honest
(real numbers, not decorative) and keeps the steps independently testable.

## 3. Data strategy (organizer data + open-source parsing)

Schema (Prisma): `Industry`, `FacilityType`, `SolutionCategory`, `Solution` (vendor, specs
as jsonb, price, capacity, `source: organizer|parsed`, `sourceUrl`, `lastVerified`),
`FacilityExample` (anonymized organizer examples), `Session`, `Assumption` (configurable
formula constants).

Since organizer data isn't available yet: `scripts/seed.ts` populates realistic
placeholder solutions (~3-5 per vertical) so the entire flow works end-to-end from week 1.
Open-source parsing lives in `scripts/parse-sources/` as **offline, manually-run
scripts** — not a live scraper in the user request path (too fragile for a client demo).
Each parser produces `Solution` records with `source: 'parsed'` and `sourceUrl` for
provenance. We're building the schema now but not the actual scrapers, since we don't
have the organizer's source list yet and guessing at sources would be wasted work — this
is the top blocked item, tracked in the PRD's open questions.

When real data lands, an import script maps the organizer's format to the same `Solution`
schema (the jsonb `specs` field absorbs structural differences without a schema change)
and overwrites/supplements the seed data.

## 4. Economics engine design

Pure functions in `lib/economics/`, framework-independent and unit-testable:

- **Baseline cost** (current manual state) = staff count × labor cost/hour × hours/year
  (labor cost/hour from `Assumption`, not hardcoded).
- **CAPEX** = solution unit price × quantity needed (quantity = facility params ÷
  solution's stated capacity) + install/integration cost (configurable %).
- **OPEX (new)** = solution's maintenance + energy + licensing costs (from solution data).
- **Annual savings** = Baseline cost − OPEX(new).
- **Payback period** = CAPEX ÷ Annual savings.
- **ROI** = (Annual savings × N years − CAPEX) ÷ CAPEX × 100%.

Every constant (labor cost/hour, install-cost %, energy cost, discount rate) lives in the
`Assumption` table — editable and visible in the UI, not hardcoded. This is a deliberate
answer to the problem statement's own complaint ("vendors give self-serving estimates,
no independent tool exists") — showing our assumptions openly is a credibility feature.
For the "Other" facility type, the same engine runs off generic inputs (area, ops volume,
staff count, labor cost) — no vertical-specific branching required.

## 5. Visualization/simulation approach

Explicit build-vs-fake decision: **2D parametric scene**, not canned video and not a full
3D/physics simulation. `lib/scene/`:

- **Layout generator** — deterministic function `(facilityType, params) → grid of zones`
  (racks for warehouse, gates/belts for airport, rooms/beds for medical, generic zones for
  Other). Deterministic, not random, so it reads as tailored to the user's input.
- **Robot simulator** — waypoint-based agents (not real pathfinding); robot count and
  speed driven directly by the Step 3 output (calculated quantity, throughput). Rendered
  on HTML5 Canvas via `requestAnimationFrame` (chosen over SVG/DOM for animating many
  moving elements at once).
- **KPI panel** — reads from the same simulation tick: throughput counter, utilization %,
  and a "ROI accrued" bar animating from 0 to the real calculated total over a fixed demo
  duration.

The line to hold during implementation: **numbers are always real** (straight from the
economics engine), **motion is illustrative** (waypoints, not physics). This is the
highest execution-risk item in the whole build and gets the most schedule buffer (see
build order below).

## 6. Build order / milestones

- **Week 1** — DB schema + seed data → Step 1 (picker) + Step 2 (catalog/comparison)
  against seed data.
- **Week 2** — Economics engine (+ tests) → Step 3 (params form + results), assumptions
  surfaced in UI.
- **Week 3** — Visualization engine (layout generator + canvas animation + KPI panel) —
  highest-risk item, most buffer.
- **Week 4** — Auth wired across the flow + Session persistence, polish, deploy to
  Vercel, swap in real organizer data when it lands, demo rehearsal.

## 7. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Visualization scope creep toward "real" simulation | Locked as illustrative/waypoint-based now, before implementation starts; canvas not WebGL/3D |
| Organizer data shape differs from our schema | `specs` stored as jsonb, source-agnostic; only the import mapping changes, not the schema |
| Economics formulas need domain assumptions we don't have | Assumptions made explicit, editable, and visible in UI rather than hidden or hardcoded |
| Solo+AI time risk across DB+auth+UI+viz in 3-4 weeks | Ordered by risk — visualization gets the most buffer; auth is fast via the already-installed NextAuth skill |
| Organizer source list arrives late, blocking real parsing | Seed data keeps the product demoable end-to-end independent of when real data lands |

## 8. Post-plan review findings (Opus 4.8, 2026-08-17)

An Opus 4.8 review of all planning docs (full text:
`.superpowers/sdd/2026-08-17-week1-foundation/opus-doc-review.md`) surfaced defects that
must be resolved before the weeks they affect. Week 1 in-flight fixes were already applied
to the Week 1 plan. The items below are tracked here and MUST be addressed when their week
is designed — do not start Week 2 economics coding before resolving the C-cluster.

### Must fix before Week 2 (economics engine)

- **C1 — Capacity units are heterogeneous; "quantity = params ÷ capacity" is undefined
  generically.** `capacityUnit` is free-text differing per category (orders/hr, pallets/day,
  "carts simultaneously", rooms/day…). Per-hour vs per-day differ 10-24×; "carts
  simultaneously" is a *stock*, not a flow. Fix: add a `capacityBasis` enum to `Solution`
  (`PER_HOUR_FLOW | PER_DAY_FLOW | CONCURRENT_STOCK`), express facility demand in a
  normalized unit (e.g. operations/day), convert both sides to a common basis before
  dividing, and use a different sizing rule for `CONCURRENT_STOCK` (units = peak concurrent
  demand ÷ per-unit concurrency). Document, per facility type, which facility-param field
  maps to demand. (Schema field deliberately deferred out of Week 1 to avoid pre-committing
  the economics model; adding it in Week 2 is one cheap migration.)
- **C2 — Payback/ROI have no guard for annual savings ≤ 0.** savings = 0 → divide-by-zero
  (Infinity/NaN in UI + Step 4 ROI bar); savings < 0 → nonsensical negative payback.
  Near-certain on the free-form "Other" path in a live demo. Fix: treat `annualSavings <= 0`
  as a first-class typed result (`{ economical: false }`) and render "Решение не окупается
  при текущих параметрах" instead of a number; guard the Step 4 bar the same way. Unit-test
  savings = 0, savings < 0, quantity = 0.
- **I1 — OPEX not scaled by quantity while CAPEX is** → savings/ROI systematically
  overstated (up to quantity×). Fix: `OPEX(new) = quantity × (maintenance + energy +
  licensing)`; make per-unit vs fleet-total explicit in the UI assumptions.
- **I2 — Savings model assumes 100% labor elimination and zero baseline OPEX**, decoupled
  from purchased capacity — optimistic-by-construction, a credibility risk for an "honest
  tool". Fix: add a visible/editable `laborReplacementPct` (default < 100%), tie displaced
  labor to capacity coverage (`min(1, deployedCapacity ÷ demand)`), optionally subtract a
  baseline-OPEX assumption.
- **M2 — Assumption hygiene:** `discount rate` is declared but unused (add discounted
  payback/NPV or drop it); `quantity` needs `ceil()` (can't buy 3.7 robots); `hoursPerYear`
  is used in Baseline but missing from the enumerated assumptions — add it.

### Currency (decided 2026-08-17)

- **I6 — Display currency = RUB primary + USD in parentheses**, via an editable USD→RUB
  exchange-rate `Assumption`. Week 1 uses a documented constant (`USD_TO_RUB` in
  `lib/format/currency.ts`); Week 2 moves it into the `Assumption` table. All monetary
  display goes through the centralized pinned-locale formatter to avoid hydration mismatch.
  Update the rate to a current value before any live client demo.

### Must fix before Week 3 (visualization)

- **I7 — Visualization has no bounds for extreme inputs.** Robot count comes straight from
  calculated quantity; nothing clamps it → hundreds of canvas agents (jank/lock-up on
  stage), or < 1 robot, or an exploding zone grid. Fix in the §5 spec: clamp rendered
  agents to a sane max with an "×N" multiplier label, clamp/scale the zone grid, guarantee
  ≥ 1 robot rendered.

### Must fix before Week 4 (deploy/auth) — rebalance

- **I8 — Week 4 is overloaded and retrofits state into deliberately-stateless steps.** Auth
  is an MVP requirement parked in the final week alongside 5 other large items, and Session
  persistence must be retrofitted into Steps 1-4. Also "deploy to Vercel" needs a *hosted*
  Postgres (docker-compose is local-only), `prisma generate` on build, and pooled
  serverless connections — none called out. Fix: pull auth + a minimal Session write
  forward to end of Week 2 / start of Week 3 so later steps read/write session as built;
  add explicit Week 4 tasks (provision managed Postgres e.g. Neon/Vercel Postgres, set
  `DATABASE_URL` in Vercel, add `prisma generate` to build, use a pooled connection
  string); don't share the rehearsal week with a first-time deploy.

### Doc hygiene (fix opportunistically)

- **I5 — "Comparison" (the brief's headline value) is never specified**; Week 1 ships a
  plain catalog. Add a short spec for Step 2 comparison (per-category side-by-side table
  with aligned rows: price, capacity, OPEX components, and a normalized "cost per unit
  throughput/yr" once C1 exists). Fine for Week 1 to ship the catalog first, but track
  comparison as an explicit follow-up rather than leaving it implied.
- **M3 — PRD self-contradiction:** §2 says a session can be "shared", §4 lists sharing as
  out-of-scope. (Fixed in PRD: §2 changed to revisit-only.)
- **M4 — "Other / произвольный объект" is reduced to one fixed preset** with no free-text
  for the user to describe their object. Acknowledge the reduction in the PRD and add an
  optional free-text object name/description on the "Other" path so Step 3/4 labels can
  echo it back ("tailored to what I entered").
- **M5 — `SolutionCategory.slug` was globally unique** → collision risk with organizer
  data. (Fixed in Week 1 plan: now `@@unique([facilityTypeId, slug])`.)

### Resolution log — post-build audit (2026-08-24/25)

A full read-only audit ([docs/AUDIT.md](./AUDIT.md)) reconfirmed §8 status and surfaced new
findings. Economics-model fixes (change output numbers, product-owner-signed-off) are specified
in [docs/superpowers/specs/2026-08-25-economics-model-revision.md](./superpowers/specs/2026-08-25-economics-model-revision.md):

- **I2 — 100% labor / no residual cost → RESOLVED (A1 + A2).** Displaced labor is now
  workload-capped (`displacedFte = min(staffCount, demand/opsPerWorkerPerYear)`), the default
  replacement is 0.5 (was 0.7), and a `residualSupervisionPct` retains ongoing oversight cost.
- **M2 — discount rate → RESOLVED (A3).** `discountRate` + `assetLifeYears` now drive NPV,
  discounted payback, and horizon re-CAPEX alongside the (relabelled) simple figures.
- **I5 — Step 2 comparison → RESOLVED (P1).** `/compare/[type]` now renders a per-category
  comparison table (price, capacity + basis, full OPEX = maint+energy+licensing, and a
  normalized "цена за ед. годовой производительности") instead of the old catalog cards.
- **U1 — inert calculator fields → RESOLVED (REFACTORING #6).** `area` is relabelled "только
  визуализация" (it drives only the Step-4 scene), and basis-only assumptions are hidden when
  they don't apply (`operatingHoursPerDay` only for PER_HOUR_FLOW, `turnoverPerDay` only for
  CONCURRENT_STOCK) — so every visible field moves the result. No economics-model change.
- **I6 — USD→RUB rate in the Assumption table → RESOLVED.** `usdToRub` is now a seeded,
  editable assumption; `formatCost(usd, rate)` takes it, threaded through the calculator
  results, visualization, and comparison table (all load the DB rate). Default stays 90.
- **M4 — free-text "Other" object → RESOLVED.** The generic path now offers an optional object
  name in onboarding, carried via `?obj=` and echoed in the Step-2 comparison and Step-3 calc
  headings ("tailored to what I entered").
- **D1 — provenance → PARTIAL.** Solution rows now show a source badge (демо/организатор/
  открытый источник) in the comparison table; the import-side validator (require
  capacityBasis/sourceUrl for non-SEED rows) stays deferred until real organizer data exists.
- Still open (deferred): SEC1 login/signup rate-limiting (needs a deploy-time shared store).
