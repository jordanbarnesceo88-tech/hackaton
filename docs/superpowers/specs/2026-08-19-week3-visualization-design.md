# Week 3 Design — Step 4 Visualization

> Status: approved via brainstorming 2026-08-19. Idea is fixed (see
> [00-idea-brief.md](../../00-idea-brief.md)); this specs the execution/design of Week 3.
> Builds on Weeks 1-2 (merged to master). Related: [execution plan §5 (viz) + §8 (I7)](../../02-execution-plan.md),
> [Week 2 spec](./2026-08-18-week2-economics-design.md).

## Goal

Deliver Step 4: a 2D visualization of robots operating on the user's facility, with live
KPIs, rendered as a panel on the existing `/calculate/[solutionId]` page and driven by the
same live params + economics result as Step 3. Numbers are real (from the engine); robot
motion is illustrative (waypoint lerp, not physics).

## Decisions locked in brainstorming

- **1a — Panel within the calculate page**, sharing Step 3's live client state (no new
  route, no URL/session plumbing). Editing a param updates results *and* the animation.
- **2a — Distinct per-vertical layouts** (warehouse / airport / medical / other), each a
  deterministic function of params.
- **3a — The animated "ROI accrued" bar fills 0 → one year's projected savings** over a
  fixed ~20s loop, then repeats.
- Build-vs-fake (from Week 1): 2D Canvas, real numbers + illustrative waypoint motion, not
  3D/physics.

## Architecture

`components/economics-calculator.tsx` (Step 3 client component) already holds `params`,
`assumptions`, and `result = computeEconomics(...)`. It will render a new
`<FacilityVisualization>` below the results, passing: `facilityKind`, `params`, `result`,
`capacityUnit`. The page `app/(app)/calculate/[solutionId]/page.tsx` already loads
`solution.solutionCategory.facilityType` — it will pass `facilityType.slug` down to the
calculator, which forwards it as `facilityKind`.

All scene logic lives in framework-free, unit-tested modules under `lib/scene/` (same
purity discipline as `lib/economics/` — no Prisma/Next/React/`process.env` imports). Only
the canvas component (`components/facility-visualization.tsx`) touches React/DOM/Canvas.

## 1. `lib/scene/types.ts`

```ts
export type FacilityKind = "warehouse" | "airport" | "medical" | "other";

export type Zone = {
  kind: "rack" | "gate" | "belt" | "room" | "zone" | "dock";
  x: number; y: number; w: number; h: number; // normalized 0..1 coords in the scene
  label?: string;
};

export type Waypoint = { x: number; y: number };

export type RobotState = {
  id: number;
  pos: Waypoint;        // current position (normalized 0..1)
  path: Waypoint[];     // looping waypoint path
  segment: number;      // index of the current path segment
  t: number;            // 0..1 progress along the current segment
};

export type Layout = {
  kind: FacilityKind;
  zones: Zone[];
  // A robot's default path template (normalized). Robots are spread along it with offsets.
  pathTemplate: Waypoint[];
};
```

`FacilityKind`: the DB facility-type slugs are `warehouse | airport | medical | other`.
`mapKind(slug: string): FacilityKind` returns the slug if known, else `"other"` (so any
future/unknown slug degrades to the generic layout).

## 2. `lib/scene/layout.ts` — deterministic layouts + clamping (I7)

`generateLayout(kind: FacilityKind, params: FacilityParams): Layout`

- Grid dimensions derive from params but are CLAMPED: e.g. `cols = clamp(round(sqrt(area /
  K)), 2, 6)`, `rows = clamp(..., 2, 6)` — a huge `areaM2` never produces more than a 6×6
  grid. Constants live at the top of the file.
- Per-kind zone layout (all coords normalized 0..1 so the canvas scales freely):
  - **warehouse**: a grid of `rack` zones with aisle gaps; one `dock` zone on the left.
    Path template: dock → down an aisle → across → back to dock.
  - **airport**: a long horizontal `belt` zone across the middle + a row of `gate` zones
    along the top; a `dock` at one end. Path: dock → belt → a gate → back.
  - **medical**: a grid of `room` zones along a central corridor + one `dock` (pharmacy).
    Path: dock → corridor → a room → back.
  - **other**: a generic grid of `zone` cells + a `dock`. Path: dock → a zone → back.
- Deterministic: same (kind, params) always yields the same layout (no RNG). This is what
  makes it read as "tailored to what I entered."

## 3. `lib/scene/simulate.ts` — waypoint motion (pure)

- `spawnRobots(layout: Layout, count: number): RobotState[]` — creates `count` robots on
  the layout's `pathTemplate`, each offset in phase (staggered `segment`/`t`) so they don't
  overlap. `count` is the already-clamped render count (see §5).
- `stepRobots(robots: RobotState[], dtMs: number, speed: number): RobotState[]` — advances
  each robot along its path by `speed * dtMs`, lerping between waypoints; wraps to segment 0
  at the end of the path (looping). Pure: returns new state, no side effects, no `Date.now`
  (dt is passed in). This is the unit-tested core.
- `speed` is illustrative, mildly scaled by throughput (a bounded factor), so a
  higher-throughput facility looks a bit busier — but clamped to a sane range.

## 4. `lib/scene/kpi.ts` — live KPI derivations (pure)

From the `EconomicsResult` + the solution capacity + elapsed time:
- `throughputPerHour(result, capacityPerUnit, basis, a)` — deployed capacity per hour
  (real number derived from `quantity × capacityPerUnit` normalized to /hour). Rendered as
  a real figure with the unit.
- `utilizationPct(demandPerYear, deployedPerYear)` — `clamp(demand/deployed, 0, 1) × 100`.
- `roiAccrued(elapsedMs, loopMs, annualSavingsUsd)` — returns the USD accrued so far in the
  current loop: `annualSavingsUsd × ((elapsedMs % loopMs) / loopMs)`. `loopMs` default
  ~20000. This is the animated headline value; if the result is not economical, the caller
  shows the "не окупается" state instead of calling this.

All pure and unit-tested (including the not-economical/zero cases and clamping).

## 5. `components/facility-visualization.tsx` — Canvas + KPI panel (client)

- `"use client"`. Props: `{ facilityKind, params, result, capacityUnit, capacityPerUnit, capacityBasis, assumptions }` (enough for layout + KPI derivations).
- **Render count (I7):** `renderCount = clamp(result.quantity, 1, MAX_RENDERED)` where
  `MAX_RENDERED = 24`. If `result.quantity > MAX_RENDERED`, show a badge
  "показано 24 из {quantity}". Always ≥ 1 robot.
- Build the layout with `generateLayout` and robots with `spawnRobots(layout, renderCount)`
  in a `useEffect`/`useRef` (recompute when `facilityKind`/params/renderCount change).
- **Animation loop:** `requestAnimationFrame`; each frame compute `dtMs` from the frame
  timestamp, call `stepRobots`, and redraw the canvas (zones as rounded rects with labels;
  robots as small circles/triangles). Cancel the rAF on unmount; **pause when the tab is
  hidden** (`document.visibilitychange`) and when the results are non-finite.
- **KPI panel** (beside/under the canvas): throughput (real, with unit), utilization %, and
  the **ROI-accrued** bar + counter animating 0 → `annualSavingsUsd` (via `formatCost`,
  RUB+USD) over the ~20s loop. If `!result.economical` (or the Week-2 non-finite guard from
  the calculator applies), the ROI KPI shows "Решение не окупается — экономия не
  накапливается" and the bar stays empty; robots still animate (illustrative).
- Canvas is drawn only in `useEffect` (client-only) → no SSR/hydration hazard. Use a fixed
  internal resolution scaled to the container width (`max-width: 100%`), DPR-aware.
- Styling: Tailwind theme colors; clean, not ornate. Russian labels.

## 6. Wiring

- `app/(app)/calculate/[solutionId]/page.tsx`: pass `facilityType={solution.solutionCategory.facilityType.slug}` (and `capacityBasis`, `capacityPerUnit` already available) to `EconomicsCalculator`.
- `components/economics-calculator.tsx`: accept `facilityKind` (mapped from the slug via
  `mapKind`) and render `<FacilityVisualization … />` below the results card, fed the live
  `params` + `result` + capacity fields it already has.

## Scope

- **In:** `lib/scene/` (types, layout, simulate, kpi) + tests; `components/facility-visualization.tsx`; wiring in the calculate page + calculator; clamping (I7).
- **Out:** persistence/auth/Session (Week 4); real 3D/physics; sound; export/share/GIF;
  changing the economics engine or Step 3 numbers.

## Success criteria

- On `/calculate/[id]` for each of the 4 verticals, a distinct 2D scene animates robots on
  a layout shaped by the entered params, beside live KPIs; the scene visibly differs by
  vertical.
- Robot count reflects the calculated `quantity`, clamped to ≤24 with a "показано 24 из N"
  badge when exceeded; always ≥1.
- The ROI-accrued bar animates 0 → one year's savings (RUB+USD) and loops; a
  not-economical result shows the "не окупается" KPI state instead.
- Editing a Step 3 param (e.g. ops/day, staff) visibly changes both the numbers and the
  animation (robot count / busyness).
- Extreme inputs (huge area, huge ops volume) do NOT explode the grid or agent count or
  jank the page (I7 verified).
- `stepRobots`, `generateLayout`, and the KPI derivations are covered by unit tests
  (deterministic layout, clamping, motion advance, roiAccrued math, not-economical case).

## Risks

- Canvas performance with many agents → capped at 24 rendered (I7); rAF paused when hidden.
- "Illustrative motion vs real numbers" confusion → KPI panel shows real figures; motion is
  clearly schematic (simple shapes), and the honesty line is carried from Step 3.
- Layout generator complexity creep → each vertical is a simple parametric shape; keep the
  per-kind functions small and clamped.
