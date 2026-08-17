# Product Requirements Document

> Status: v1 — approved via brainstorming session, 2026-08-17.
> See [00-idea-brief.md](./00-idea-brief.md) for the fixed source idea and
> [02-execution-plan.md](./02-execution-plan.md) for how we decided to build it.

## 1. Problem statement

Companies evaluating robotization face two barriers: they don't know what solutions
exist on the market, and they can't quickly estimate the economic effect for their own
facility. The market is fragmented — vendors give self-serving estimates, and there's no
independent comparison tool. As a result, robotization investment decisions get delayed
or made without sufficient justification.

## 2. Users & use case

Primary user: a decision-maker at a company considering robotization (operations/facility
lead, not necessarily technical), evaluating whether and what to invest in for their
site. Session-based use — they pick their facility type, compare options, enter their
own numbers, see the projected economics and a visualization, then (with accounts) can
revisit or share that session later. Must be credible enough to present live to a real
client.

## 3. Scope — MVP (demo-ready)

- Auth: account creation/login (NextAuth), sessions persisted per user.
- Step 1: industry + facility type picker — Retail/Warehouse, Logistics/Airport,
  Social/Medical facility (each with organizer-provided example data), plus "Other"
  (generic, user-defined object).
- Step 2: solution catalog for the selected facility type — solution types and individual
  products within each type, key characteristics, comparison view. Backed by seed data
  initially, swapped for organizer data when it arrives.
- Step 3: user enters facility parameters (area, ops volume, staff count, etc.), picks a
  solution type; platform calculates resource needs and OPEX/CAPEX/payback/ROI, with
  underlying assumptions visible and editable.
- Step 4: 2D parametric visualization of robots operating on a generated facility layout,
  with a live-updating KPI panel driven by the Step 3 numbers.
- Deployed and reachable via a URL for the live demo.

## 4. Scope — explicitly out of scope (for this MVP)

- Live/automated open-source scraping running in the user-facing request path (parsing
  is an offline script, run manually — see execution plan).
- Real pathfinding/physics simulation for Step 4 (explicitly illustrative motion, real
  numbers — see execution plan).
- Payments, billing, multi-tenant org accounts, sharing/collaboration features.
- Localization/i18n beyond the source language.
- Mobile app (responsive web only).

## 5. User flow

Maps directly to the organizer's 4 steps:

1. **Object selection** — industry → facility type (3 defined verticals + Other).
2. **Solution comparison** — browse solution types and products for that facility type.
3. **Economics calculator** — input facility params + chosen solution type → OPEX,
   CAPEX, payback period, ROI.
4. **Visualization** — 2D scene of robots operating on-site + live KPI panel.

Each step's output is persisted to the session and read by the next step — Step 4 never
recalculates; it renders what Step 3 already produced.

## 6. Data model & sources

Core entities: `Industry`, `FacilityType`, `SolutionCategory`, `Solution` (vendor, specs,
price, capacity, `source: organizer|parsed`, `sourceUrl`, `lastVerified`),
`FacilityExample` (anonymized organizer examples), `Session` (user + params + selected
solution + calculated results), `Assumption` (configurable formula constants — labor
cost/hour, install-cost %, energy cost, etc.).

Sources: (1) organizer-provided solutions table and anonymized facility examples — not in
hand yet, schema designed to absorb it via a jsonb `specs` field so format differences
don't require a schema change; (2) open-source parsing against a list of sources the
organizer will provide — offline pipeline, not yet built pending that list; (3) our own
seed data as a placeholder for both of the above, so the product works end-to-end before
real data arrives.

## 7. Functional requirements

- User can create an account and log in.
- User can select industry + facility type, including a generic "Other" path.
- User can browse and compare solutions for their facility type, including type-level and
  product-level comparison.
- User can input facility parameters and receive calculated OPEX, CAPEX, payback period,
  and ROI, with the assumptions behind those numbers visible.
- User can view a visualization of the selected solution operating on a facility shaped
  by their inputs, with KPIs that reflect the Step 3 calculation.
- A session (selections + inputs + results) persists and can be revisited by its owner.

## 8. Non-functional requirements

- Must run reliably in a live demo to a client — favor predictability over completeness.
- Calculation logic must be transparent (visible assumptions), directly addressing the
  "vendors give self-serving numbers" complaint in the problem statement.
- Solution data must carry provenance (`source`, `sourceUrl`) so origin is always
  traceable.
- Reasonably responsive (desktop-first, since this is a guided sales-style demo tool, not
  optimized for mobile).

## 9. Success criteria (demo)

- A user can go start-to-finish through all 4 steps without errors, for each of the 3
  defined verticals and the "Other" path.
- The numbers shown in Step 3 and Step 4 are consistent (Step 4 visibly reflects Step 3's
  output, not independent/canned numbers).
- The visualization reads as "tailored to what I entered," not generic/canned, even
  though it's not a physics simulation.
- Assumptions behind the economics are visible and can be pointed to when a client
  questions a number.

## 10. Open questions

- Actual organizer solutions table, facility examples, and open-source list — not yet
  received; blocks replacing seed data and building the real parsing scripts. Tracked as
  the top open item; everything else is designed to not be blocked by it.
- Realistic default values for `Assumption` constants (regional labor cost, energy cost,
  install-cost %) — using placeholder defaults until we have or can research real
  figures; these should be revisited before the live demo, not left as arbitrary guesses.
