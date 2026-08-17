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
