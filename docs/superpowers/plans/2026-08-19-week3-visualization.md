# Week 3 Step 4 Visualization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Step 4 — a 2D Canvas visualization of robots operating on the user's
facility with live KPIs — as a panel on the existing `/calculate/[solutionId]` page, driven
by the same live params + economics result as Step 3.

**Architecture:** Pure, unit-tested scene modules in `lib/scene/` (types, layout, simulate,
kpi) compute everything; a single client component `components/facility-visualization.tsx`
runs the Canvas + requestAnimationFrame loop and the KPI panel; it's rendered by
`economics-calculator.tsx` and fed the live `params`/`result`. Numbers are real (from the
economics engine); robot motion is illustrative (waypoint lerp, not physics).

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind v4, shadcn/ui,
Vitest. Canvas 2D API (no new deps).

**Spec:** `docs/superpowers/specs/2026-08-19-week3-visualization-design.md`

## Global Constraints

- Repo root `~/robotization-roi-platform`, branch `week3-visualization`.
- **Scene purity:** everything in `lib/scene/` is pure TypeScript — NO imports of Prisma,
  Next, React, the DOM/Canvas, or `process.env`. Plain data in, plain data out. Only
  `components/facility-visualization.tsx` touches React/DOM/Canvas.
- **Reuse, don't duplicate:** KPI derivations reuse the economics engine's annualization
  (Task 1 exports helpers from `lib/economics/normalize.ts`); do not re-hardcode the
  capacity/demand formulas in `lib/scene/kpi.ts`. Money is rendered ONLY via `formatCost`
  from `@/lib/format/currency` (RUB+USD) — never raw.
- **UI language is Russian** for all visible labels/badges.
- **I7 clamping (exact):** `MAX_RENDERED = 24` robots; if `quantity > 24`, render 24 and
  show a "показано 24 из {quantity}" badge; always render ≥ 1. Layout grid capped at 6×6.
- **Stateless:** the panel shares Step 3's live client state; NO new route, URL param,
  session, persistence, or auth (that's Week 4). Do not change the economics engine's math
  or Step 3's numbers.
- **FacilityKind values (exact):** `"warehouse" | "airport" | "medical" | "other"`;
  `mapKind(slug)` returns the slug if it is one of these, else `"other"`.
- Vitest config is `vitest.config.mts`; run tests with `npx --yes vitest run <path> < /dev/null`
  (never watch mode). Prefix npx with `--yes`; never spawn a Monitor or leave a dev server
  running. Coordinate the canvas via `requestAnimationFrame` with dt passed into the pure
  simulate step (no `Date.now()` inside the pure layer).

---

### Task 1: Extract annualization helpers in `lib/economics/normalize.ts` (DRY)

**Files:**
- Modify: `lib/economics/normalize.ts`
- Modify: `lib/economics/normalize.test.ts`

**Interfaces:**
- Consumes: existing `SolutionCapacity`, `FacilityParams`, `AssumptionValues` from `./types`.
- Produces: `capacityPerYear(cap, a): number` and `demandPerYear(params, a): number`
  (exported); `computeQuantity` unchanged in behavior but implemented using them. These are
  reused by `lib/scene/kpi.ts` in Task 4.

- [ ] **Step 1: Add tests for the helpers to `lib/economics/normalize.test.ts`**

Append (the existing imports of describe/it/expect and the `a` assumptions object already
exist in this file — reuse them; only add the new import symbols):

```ts
import { computeQuantity, capacityPerYear, demandPerYear } from "./normalize";

describe("capacityPerYear / demandPerYear helpers", () => {
  it("annualizes a PER_HOUR_FLOW capacity using operating hours", () => {
    // 50/hr * 16 hrs/day * 250 days = 200000
    const cap = { priceUsd: 1, maintenanceUsdYear: 0, energyUsdYear: 0, licensingUsdYear: 0,
      capacityPerUnit: 50, capacityBasis: "PER_HOUR_FLOW" as const };
    expect(capacityPerYear(cap, a)).toBe(200000);
  });
  it("annualizes a PER_DAY_FLOW capacity without the hours factor", () => {
    const cap = { priceUsd: 1, maintenanceUsdYear: 0, energyUsdYear: 0, licensingUsdYear: 0,
      capacityPerUnit: 400, capacityBasis: "PER_DAY_FLOW" as const };
    expect(capacityPerYear(cap, a)).toBe(100000); // 400 * 1 * 250
  });
  it("annualizes demand from opsPerDay", () => {
    expect(demandPerYear({ areaM2: 0, opsPerDay: 1600, staffCount: 0 }, a)).toBe(400000);
  });
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx --yes vitest run lib/economics/normalize.test.ts < /dev/null`
Expected: FAIL — `capacityPerYear` / `demandPerYear` are not exported yet.

- [ ] **Step 3: Refactor `lib/economics/normalize.ts` to export the helpers**

```ts
import type { SolutionCapacity, FacilityParams, AssumptionValues } from "./types";

/** Annualized throughput capacity of ONE unit (flow bases only). */
export function capacityPerYear(cap: SolutionCapacity, a: AssumptionValues): number {
  const hoursFactor =
    cap.capacityBasis === "PER_HOUR_FLOW" ? a.operatingHoursPerDay : 1;
  return cap.capacityPerUnit * hoursFactor * a.workingDaysPerYear;
}

/** Annualized facility demand from daily operations. */
export function demandPerYear(params: FacilityParams, a: AssumptionValues): number {
  return params.opsPerDay * a.workingDaysPerYear;
}

export function computeQuantity(
  cap: SolutionCapacity,
  params: FacilityParams,
  a: AssumptionValues
): number {
  if (!(cap.capacityPerUnit > 0)) {
    throw new Error("capacityPerUnit must be > 0");
  }

  if (cap.capacityBasis === "CONCURRENT_STOCK") {
    const peak =
      params.peakConcurrent ?? Math.ceil(params.opsPerDay / a.turnoverPerDay);
    return Math.max(1, Math.ceil(peak / cap.capacityPerUnit));
  }

  return Math.max(1, Math.ceil(demandPerYear(params, a) / capacityPerYear(cap, a)));
}
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `npx --yes vitest run lib/economics/normalize.test.ts < /dev/null`
Expected: PASS — the prior `computeQuantity` tests + the 3 new helper tests.

- [ ] **Step 5: Commit**

```bash
git add lib/economics/normalize.ts lib/economics/normalize.test.ts
git commit -m "Extract capacityPerYear/demandPerYear helpers for reuse (DRY)"
```

---

### Task 2: Scene types + layout generator (`lib/scene/`)

**Files:**
- Create: `lib/scene/types.ts`, `lib/scene/layout.ts`, `lib/scene/layout.test.ts`

**Interfaces:**
- Consumes: `FacilityParams` from `@/lib/economics/types`.
- Produces: types `FacilityKind`, `Zone`, `Waypoint`, `RobotState`, `Layout`;
  `mapKind(slug: string): FacilityKind`; `generateLayout(kind: FacilityKind, params:
  FacilityParams): Layout`. Consumed by Task 3 (simulate) and Task 5 (canvas).

- [ ] **Step 1: Create `lib/scene/types.ts`**

```ts
export type FacilityKind = "warehouse" | "airport" | "medical" | "other";

export type Zone = {
  kind: "rack" | "gate" | "belt" | "room" | "zone" | "dock";
  x: number; y: number; w: number; h: number; // normalized 0..1
  label?: string;
};

export type Waypoint = { x: number; y: number };

export type RobotState = {
  id: number;
  pos: Waypoint;    // normalized 0..1
  path: Waypoint[]; // looping path (>= 2 points)
  segment: number;  // current segment index (0..path.length-1)
  t: number;        // 0..1 progress along current segment
};

export type Layout = {
  kind: FacilityKind;
  zones: Zone[];
  pathTemplate: Waypoint[]; // >= 2 waypoints; robots follow offset copies of this
};
```

- [ ] **Step 2: Write the failing tests — `lib/scene/layout.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { generateLayout, mapKind } from "./layout";
import type { FacilityParams } from "@/lib/economics/types";

const params: FacilityParams = { areaM2: 1000, opsPerDay: 500, staffCount: 10 };
const huge: FacilityParams = { areaM2: 10_000_000, opsPerDay: 9_999_999, staffCount: 9999 };

describe("mapKind", () => {
  it("passes through known kinds", () => {
    expect(mapKind("warehouse")).toBe("warehouse");
    expect(mapKind("airport")).toBe("airport");
    expect(mapKind("medical")).toBe("medical");
    expect(mapKind("other")).toBe("other");
  });
  it("falls back to 'other' for unknown slugs", () => {
    expect(mapKind("spaceport")).toBe("other");
    expect(mapKind("")).toBe("other");
  });
});

describe("generateLayout", () => {
  it("is deterministic for the same inputs", () => {
    expect(generateLayout("warehouse", params)).toEqual(generateLayout("warehouse", params));
  });
  it("produces the requested kind and a valid path template", () => {
    for (const k of ["warehouse", "airport", "medical", "other"] as const) {
      const layout = generateLayout(k, params);
      expect(layout.kind).toBe(k);
      expect(layout.zones.length).toBeGreaterThan(0);
      expect(layout.pathTemplate.length).toBeGreaterThanOrEqual(2);
      // all coords normalized within [0,1]
      for (const z of layout.zones) {
        expect(z.x).toBeGreaterThanOrEqual(0);
        expect(z.y).toBeGreaterThanOrEqual(0);
        expect(z.x + z.w).toBeLessThanOrEqual(1.0001);
        expect(z.y + z.h).toBeLessThanOrEqual(1.0001);
      }
      for (const wp of layout.pathTemplate) {
        expect(wp.x).toBeGreaterThanOrEqual(0);
        expect(wp.x).toBeLessThanOrEqual(1);
        expect(wp.y).toBeGreaterThanOrEqual(0);
        expect(wp.y).toBeLessThanOrEqual(1);
      }
    }
  });
  it("includes a dock zone in every layout", () => {
    for (const k of ["warehouse", "airport", "medical", "other"] as const) {
      expect(generateLayout(k, params).zones.some((z) => z.kind === "dock")).toBe(true);
    }
  });
  it("clamps the grid for extreme inputs (I7) — never explodes past a 6x6 grid + a few fixtures", () => {
    for (const k of ["warehouse", "airport", "medical", "other"] as const) {
      const nonDock = generateLayout(k, huge).zones.filter((z) => z.kind !== "dock");
      // 6x6 = 36 grid cells, plus at most a couple of fixture zones (belt/corridor).
      expect(nonDock.length).toBeLessThanOrEqual(40);
    }
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx --yes vitest run lib/scene/layout.test.ts < /dev/null`
Expected: FAIL — module `./layout` not found.

- [ ] **Step 4: Implement `lib/scene/layout.ts`**

```ts
import type { FacilityParams } from "@/lib/economics/types";
import type { FacilityKind, Layout, Zone, Waypoint } from "./types";

const KINDS: FacilityKind[] = ["warehouse", "airport", "medical", "other"];

export function mapKind(slug: string): FacilityKind {
  return (KINDS as string[]).includes(slug) ? (slug as FacilityKind) : "other";
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// Grid size derived from area but hard-capped at 6x6 (I7). ~200 m^2 per cell, clamped.
function gridDims(params: FacilityParams): { cols: number; rows: number } {
  const cells = clamp(Math.round(params.areaM2 / 200), 4, 36);
  const cols = clamp(Math.round(Math.sqrt(cells)), 2, 6);
  const rows = clamp(Math.round(cells / cols), 2, 6);
  return { cols, rows };
}

const DOCK: Zone = { kind: "dock", x: 0.02, y: 0.45, w: 0.1, h: 0.1, label: "Док" };

function gridZones(
  kind: Zone["kind"],
  params: FacilityParams,
  area: { x0: number; y0: number; x1: number; y1: number }
): Zone[] {
  const { cols, rows } = gridDims(params);
  const zones: Zone[] = [];
  const gapX = 0.02;
  const gapY = 0.03;
  const cw = (area.x1 - area.x0 - gapX * (cols - 1)) / cols;
  const ch = (area.y1 - area.y0 - gapY * (rows - 1)) / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      zones.push({
        kind,
        x: area.x0 + c * (cw + gapX),
        y: area.y0 + r * (ch + gapY),
        w: cw,
        h: ch,
      });
    }
  }
  return zones;
}

export function generateLayout(kind: FacilityKind, params: FacilityParams): Layout {
  const area = { x0: 0.18, y0: 0.08, x1: 0.98, y1: 0.92 };

  if (kind === "airport") {
    const belt: Zone = { kind: "belt", x: 0.18, y: 0.46, w: 0.8, h: 0.08, label: "Лента" };
    const gates = gridZones("gate", { ...params, areaM2: Math.min(params.areaM2, 1200) }, {
      x0: 0.18, y0: 0.08, x1: 0.98, y1: 0.36,
    }).slice(0, 12);
    const pathTemplate: Waypoint[] = [
      { x: 0.07, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.22 }, { x: 0.5, y: 0.5 },
    ];
    return { kind, zones: [DOCK, belt, ...gates], pathTemplate };
  }

  if (kind === "medical") {
    // A single clamped room grid above a corridor (I7: one grid, never two).
    const rooms = gridZones("room", params, { x0: 0.18, y0: 0.08, x1: 0.98, y1: 0.62 });
    const corridor: Zone = { kind: "zone", x: 0.18, y: 0.68, w: 0.8, h: 0.06, label: "Коридор" };
    const pathTemplate: Waypoint[] = [
      { x: 0.07, y: 0.5 }, { x: 0.55, y: 0.71 }, { x: 0.55, y: 0.35 }, { x: 0.55, y: 0.71 },
    ];
    return { kind, zones: [DOCK, corridor, ...rooms], pathTemplate };
  }

  if (kind === "warehouse") {
    const racks = gridZones("rack", params, area);
    const pathTemplate: Waypoint[] = [
      { x: 0.07, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.9, y: 0.15 }, { x: 0.5, y: 0.5 },
    ];
    return { kind, zones: [DOCK, ...racks], pathTemplate };
  }

  // other / generic
  const cells = gridZones("zone", params, area);
  const pathTemplate: Waypoint[] = [
    { x: 0.07, y: 0.5 }, { x: 0.55, y: 0.55 }, { x: 0.85, y: 0.3 }, { x: 0.55, y: 0.55 },
  ];
  return { kind, zones: [DOCK, ...cells], pathTemplate };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx --yes vitest run lib/scene/layout.test.ts < /dev/null`
Expected: PASS (all layout + mapKind tests).

- [ ] **Step 6: Commit**

```bash
git add lib/scene/types.ts lib/scene/layout.ts lib/scene/layout.test.ts
git commit -m "Add scene types + per-vertical layout generator with I7 grid clamping"
```

---

### Task 3: Robot simulator (`lib/scene/simulate.ts`)

**Files:**
- Create: `lib/scene/simulate.ts`, `lib/scene/simulate.test.ts`

**Interfaces:**
- Consumes: `Layout`, `RobotState`, `Waypoint` from `./types`.
- Produces: `spawnRobots(layout: Layout, count: number): RobotState[]`;
  `stepRobots(robots: RobotState[], dtMs: number, speed: number): RobotState[]`. Consumed by
  Task 5.

- [ ] **Step 1: Write the failing tests — `lib/scene/simulate.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { spawnRobots, stepRobots } from "./simulate";
import type { Layout } from "./types";

const layout: Layout = {
  kind: "other",
  zones: [{ kind: "dock", x: 0, y: 0.45, w: 0.1, h: 0.1 }],
  pathTemplate: [
    { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 },
  ],
};

describe("spawnRobots", () => {
  it("spawns exactly `count` robots, each with the path and a start position", () => {
    const robots = spawnRobots(layout, 5);
    expect(robots).toHaveLength(5);
    for (const r of robots) {
      expect(r.path.length).toBe(4);
      expect(r.pos).toHaveProperty("x");
      expect(r.pos).toHaveProperty("y");
    }
    // staggered: not all at the exact same position
    const uniquePositions = new Set(robots.map((r) => `${r.pos.x.toFixed(3)},${r.pos.y.toFixed(3)}`));
    expect(uniquePositions.size).toBeGreaterThan(1);
  });
});

describe("stepRobots", () => {
  it("advances a robot along the current segment by speed*dt", () => {
    const robots = [{ id: 0, pos: { x: 0, y: 0 }, path: layout.pathTemplate, segment: 0, t: 0 }];
    // segment 0 is length 1 (from (0,0) to (1,0)); speed 0.5/sec * 0.5s = 0.25 progress
    const next = stepRobots(robots, 500, 0.5);
    expect(next[0].t).toBeCloseTo(0.25, 3);
    expect(next[0].pos.x).toBeCloseTo(0.25, 3);
    expect(next[0].pos.y).toBeCloseTo(0, 3);
  });
  it("rolls over to the next segment when t exceeds 1", () => {
    const robots = [{ id: 0, pos: { x: 1, y: 0 }, path: layout.pathTemplate, segment: 0, t: 0.9 }];
    const next = stepRobots(robots, 500, 0.5); // +0.25 -> 1.15 -> seg 1, t 0.15
    expect(next[0].segment).toBe(1);
    expect(next[0].t).toBeCloseTo(0.15, 3);
  });
  it("loops from the last segment back to the first", () => {
    const robots = [{ id: 0, pos: { x: 0, y: 1 }, path: layout.pathTemplate, segment: 3, t: 0.95 }];
    const next = stepRobots(robots, 200, 0.5); // +0.1 -> 1.05 -> wraps to segment 0
    expect(next[0].segment).toBe(0);
  });
  it("is pure — does not mutate the input array or robots", () => {
    const robots = [{ id: 0, pos: { x: 0, y: 0 }, path: layout.pathTemplate, segment: 0, t: 0 }];
    const snapshot = JSON.stringify(robots);
    stepRobots(robots, 500, 0.5);
    expect(JSON.stringify(robots)).toBe(snapshot);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx --yes vitest run lib/scene/simulate.test.ts < /dev/null`
Expected: FAIL — module `./simulate` not found.

- [ ] **Step 3: Implement `lib/scene/simulate.ts`**

```ts
import type { Layout, RobotState, Waypoint } from "./types";

function lerp(a: Waypoint, b: Waypoint, t: number): Waypoint {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function spawnRobots(layout: Layout, count: number): RobotState[] {
  const n = Math.max(1, Math.floor(count));
  const path = layout.pathTemplate;
  const segs = path.length; // looping: last point connects back to first
  const robots: RobotState[] = [];
  for (let i = 0; i < n; i++) {
    // stagger each robot's phase evenly around the loop
    const phase = (i / n) * segs;
    const segment = Math.floor(phase) % segs;
    const t = phase - Math.floor(phase);
    const from = path[segment];
    const to = path[(segment + 1) % segs];
    robots.push({ id: i, pos: lerp(from, to, t), path, segment, t });
  }
  return robots;
}

export function stepRobots(
  robots: RobotState[],
  dtMs: number,
  speed: number
): RobotState[] {
  const dSeg = speed * (dtMs / 1000); // progress in segment-units this frame
  return robots.map((r) => {
    const segs = r.path.length;
    let segment = r.segment;
    let t = r.t + dSeg;
    while (t >= 1) {
      t -= 1;
      segment = (segment + 1) % segs;
    }
    const from = r.path[segment];
    const to = r.path[(segment + 1) % segs];
    return { ...r, segment, t, pos: lerp(from, to, t) };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx --yes vitest run lib/scene/simulate.test.ts < /dev/null`
Expected: PASS (spawn + step + rollover + loop + purity).

- [ ] **Step 5: Commit**

```bash
git add lib/scene/simulate.ts lib/scene/simulate.test.ts
git commit -m "Add waypoint robot simulator (pure stepRobots/spawnRobots)"
```

---

### Task 4: KPI derivations (`lib/scene/kpi.ts`)

**Files:**
- Create: `lib/scene/kpi.ts`, `lib/scene/kpi.test.ts`

**Interfaces:**
- Consumes: `capacityPerYear`, `demandPerYear` from `@/lib/economics/normalize`; types
  `SolutionCapacity`, `FacilityParams`, `AssumptionValues` from `@/lib/economics/types`.
- Produces: `deployedCapacity(quantity, capacityPerUnit): number`;
  `utilizationPct(cap, params, a, quantity): number` (0..100);
  `roiAccrued(elapsedMs, loopMs, annualSavingsUsd): number`.

- [ ] **Step 1: Write the failing tests — `lib/scene/kpi.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { deployedCapacity, utilizationPct, roiAccrued } from "./kpi";
import type { SolutionCapacity, FacilityParams, AssumptionValues } from "@/lib/economics/types";

const a: AssumptionValues = {
  laborCostPerHourUsd: 15, hoursPerYear: 2000, workingDaysPerYear: 250,
  operatingHoursPerDay: 16, installPctOfCapex: 0.15, laborReplacementPct: 0.7,
  turnoverPerDay: 8, roiHorizonYears: 5,
};
const flowCap: SolutionCapacity = {
  capacityPerUnit: 400, capacityBasis: "PER_DAY_FLOW",
  priceUsd: 1, maintenanceUsdYear: 0, energyUsdYear: 0, licensingUsdYear: 0,
};
const stockCap: SolutionCapacity = {
  capacityPerUnit: 12, capacityBasis: "CONCURRENT_STOCK",
  priceUsd: 1, maintenanceUsdYear: 0, energyUsdYear: 0, licensingUsdYear: 0,
};

describe("deployedCapacity", () => {
  it("is quantity × capacityPerUnit", () => {
    expect(deployedCapacity(4, 400)).toBe(1600);
  });
});

describe("utilizationPct", () => {
  it("flow: demand/deployed, clamped to [0,100]", () => {
    // opsPerDay 400 -> demand/yr 100000; qty 1 -> deployed/yr 100000 -> 100%
    const p: FacilityParams = { areaM2: 0, opsPerDay: 400, staffCount: 0 };
    expect(utilizationPct(flowCap, p, a, 1)).toBeCloseTo(100, 3);
    // qty 4 -> deployed/yr 400000 -> 25%
    expect(utilizationPct(flowCap, p, a, 4)).toBeCloseTo(25, 3);
  });
  it("stock: peak/deployed-concurrency, clamped", () => {
    // peakConcurrent 30, qty 3 -> deployed 36 -> 83.33%
    const p: FacilityParams = { areaM2: 0, opsPerDay: 100, staffCount: 0, peakConcurrent: 30 };
    expect(utilizationPct(stockCap, p, a, 3)).toBeCloseTo((30 / 36) * 100, 2);
  });
  it("never exceeds 100 or drops below 0", () => {
    const p: FacilityParams = { areaM2: 0, opsPerDay: 999999, staffCount: 0 };
    expect(utilizationPct(flowCap, p, a, 1)).toBe(100);
  });
});

describe("roiAccrued", () => {
  it("fills linearly to annualSavings across the loop, then wraps", () => {
    expect(roiAccrued(0, 20000, 200000)).toBeCloseTo(0, 3);
    expect(roiAccrued(10000, 20000, 200000)).toBeCloseTo(100000, 3);
    expect(roiAccrued(20000, 20000, 200000)).toBeCloseTo(0, 3); // wraps
    expect(roiAccrued(25000, 20000, 200000)).toBeCloseTo(50000, 3);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx --yes vitest run lib/scene/kpi.test.ts < /dev/null`
Expected: FAIL — module `./kpi` not found.

- [ ] **Step 3: Implement `lib/scene/kpi.ts`**

```ts
import { capacityPerYear, demandPerYear } from "@/lib/economics/normalize";
import type {
  SolutionCapacity,
  FacilityParams,
  AssumptionValues,
} from "@/lib/economics/types";

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Deployed throughput in the solution's native unit (quantity × per-unit capacity). */
export function deployedCapacity(quantity: number, capacityPerUnit: number): number {
  return quantity * capacityPerUnit;
}

/** How much of deployed capacity the facility's demand uses, as a percent (0..100). */
export function utilizationPct(
  cap: SolutionCapacity,
  params: FacilityParams,
  a: AssumptionValues,
  quantity: number
): number {
  if (cap.capacityBasis === "CONCURRENT_STOCK") {
    const peak = params.peakConcurrent ?? Math.ceil(params.opsPerDay / a.turnoverPerDay);
    const deployed = quantity * cap.capacityPerUnit;
    return deployed > 0 ? clamp((peak / deployed) * 100, 0, 100) : 0;
  }
  const deployed = quantity * capacityPerYear(cap, a);
  const demand = demandPerYear(params, a);
  return deployed > 0 ? clamp((demand / deployed) * 100, 0, 100) : 0;
}

/** USD accrued so far in the current animation loop (fills 0 -> annualSavings over loopMs). */
export function roiAccrued(
  elapsedMs: number,
  loopMs: number,
  annualSavingsUsd: number
): number {
  if (!(loopMs > 0) || !Number.isFinite(annualSavingsUsd)) return 0;
  const frac = (elapsedMs % loopMs) / loopMs;
  return annualSavingsUsd * frac;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx --yes vitest run lib/scene/kpi.test.ts < /dev/null`
Expected: PASS (deployedCapacity + utilization flow/stock/clamp + roiAccrued).

- [ ] **Step 5: Commit**

```bash
git add lib/scene/kpi.ts lib/scene/kpi.test.ts
git commit -m "Add pure KPI derivations (deployed capacity, utilization, ROI accrual)"
```

---

### Task 5: Canvas visualization component (`components/facility-visualization.tsx`)

**Files:**
- Create: `components/facility-visualization.tsx`

**Interfaces:**
- Consumes: `generateLayout` (`@/lib/scene/layout`), `spawnRobots`/`stepRobots`
  (`@/lib/scene/simulate`), `deployedCapacity`/`utilizationPct`/`roiAccrued`
  (`@/lib/scene/kpi`), `formatCost` (`@/lib/format/currency`), types from
  `@/lib/scene/types` + `@/lib/economics/types`, shadcn `Card`.
- Produces: `FacilityVisualization` (default-free named export). Props:
  `{ facilityKind: FacilityKind; params: FacilityParams; assumptions: AssumptionValues;
  capacity: SolutionCapacity; capacityUnit: string; result: EconomicsResult }`.

- [ ] **Step 1: Create `components/facility-visualization.tsx`**

```tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { generateLayout } from "@/lib/scene/layout";
import { spawnRobots, stepRobots } from "@/lib/scene/simulate";
import { deployedCapacity, utilizationPct, roiAccrued } from "@/lib/scene/kpi";
import { formatCost } from "@/lib/format/currency";
import type { FacilityKind, RobotState } from "@/lib/scene/types";
import type {
  SolutionCapacity,
  FacilityParams,
  AssumptionValues,
  EconomicsResult,
} from "@/lib/economics/types";

const MAX_RENDERED = 24;
const LOOP_MS = 20000;
const ZONE_COLORS: Record<string, string> = {
  rack: "#94a3b8", gate: "#a5b4fc", belt: "#fbbf24", room: "#86efac",
  zone: "#93c5fd", dock: "#f472b6",
};

export function FacilityVisualization({
  facilityKind,
  params,
  assumptions,
  capacity,
  capacityUnit,
  result,
}: {
  facilityKind: FacilityKind;
  params: FacilityParams;
  assumptions: AssumptionValues;
  capacity: SolutionCapacity;
  capacityUnit: string;
  result: EconomicsResult;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const robotsRef = useRef<RobotState[]>([]);
  const [elapsed, setElapsed] = useState(0);

  const renderCount = Math.max(1, Math.min(MAX_RENDERED, Math.floor(result.quantity)));
  const overflow = result.quantity > MAX_RENDERED;

  const layout = useMemo(
    () => generateLayout(facilityKind, params),
    [facilityKind, params]
  );

  // (Re)spawn robots when the layout or render count changes.
  useEffect(() => {
    robotsRef.current = spawnRobots(layout, renderCount);
  }, [layout, renderCount]);

  // Animation loop: advance + draw each frame; pause when tab hidden.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let last = performance.now();
    let start = performance.now();
    // speed scales mildly with utilization/throughput but stays bounded.
    const speed = 0.15;

    const draw = () => {
      const now = performance.now();
      const dt = Math.min(now - last, 100); // clamp dt (e.g. after tab refocus)
      last = now;

      robotsRef.current = stepRobots(robotsRef.current, dt, speed);
      setElapsed(now - start);

      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(0, 0, W, H);

      for (const z of layout.zones) {
        ctx.fillStyle = ZONE_COLORS[z.kind] ?? "#64748b";
        ctx.globalAlpha = 0.85;
        ctx.fillRect(z.x * W, z.y * H, z.w * W, z.h * H);
        ctx.globalAlpha = 1;
      }

      ctx.fillStyle = "#22d3ee";
      for (const r of robotsRef.current) {
        ctx.beginPath();
        ctx.arc(r.pos.x * W, r.pos.y * H, 5, 0, Math.PI * 2);
        ctx.fill();
      }

      raf = requestAnimationFrame(draw);
    };

    const onVis = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
      } else {
        last = performance.now();
        raf = requestAnimationFrame(draw);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [layout]);

  const util = utilizationPct(capacity, params, assumptions, result.quantity);
  const deployed = deployedCapacity(result.quantity, capacity.capacityPerUnit);
  const savings = result.economical ? result.annualSavingsUsd : 0;
  const accrued = result.economical ? roiAccrued(elapsed, LOOP_MS, savings) : 0;
  const accruedFrac = savings > 0 ? accrued / savings : 0;

  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <CardTitle>Визуализация работы роботов</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-[2fr_1fr]">
        <div className="relative">
          <canvas
            ref={canvasRef}
            width={720}
            height={360}
            className="w-full rounded-md border"
            style={{ aspectRatio: "2 / 1" }}
          />
          {overflow && (
            <span className="absolute right-2 top-2 rounded bg-black/70 px-2 py-1 text-xs text-white">
              показано {MAX_RENDERED} из {result.quantity}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-3 text-sm">
          <div>
            Роботов в работе: <b>{renderCount}</b>
            {overflow ? ` (всего ${result.quantity})` : ""}
          </div>
          <div>
            Производительность: <b>{deployed.toLocaleString("ru-RU")} {capacityUnit}</b>
          </div>
          <div>Загрузка: <b>{util.toFixed(0)}%</b></div>
          <div>
            <div className="mb-1">Накопленная экономия (за год):</div>
            {result.economical ? (
              <>
                <div className="h-3 w-full overflow-hidden rounded bg-muted">
                  <div
                    className="h-full bg-emerald-500 transition-[width] duration-100"
                    style={{ width: `${Math.round(accruedFrac * 100)}%` }}
                  />
                </div>
                <div className="mt-1 font-medium">{formatCost(accrued)}</div>
              </>
            ) : (
              <div className="font-medium text-red-600">
                Решение не окупается — экономия не накапливается
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: exit 0, compiled successfully (component compiles; it isn't routed yet — wiring is Task 6).

- [ ] **Step 3: Commit**

```bash
git add components/facility-visualization.tsx
git commit -m "Add Canvas facility visualization component with live KPI panel"
```

---

### Task 6: Wire the visualization into Step 3 + verify end-to-end

**Files:**
- Modify: `app/(app)/calculate/[solutionId]/page.tsx`
- Modify: `components/economics-calculator.tsx`

**Interfaces:**
- Consumes: `FacilityVisualization` (`@/components/facility-visualization`), `mapKind`
  (`@/lib/scene/layout`).
- Produces: the visualization rendered live on `/calculate/[solutionId]`.

- [ ] **Step 1: Pass the facility slug from the page to the calculator**

In `app/(app)/calculate/[solutionId]/page.tsx`, the loaded `solution` already includes
`solutionCategory.facilityType`. Add a `facilitySlug` prop to the `<EconomicsCalculator … />`
element:

```tsx
        facilitySlug={solution.solutionCategory.facilityType.slug}
```

(Place it alongside the existing `capacity`, `capacityUnit`, `initialAssumptions` props.)

- [ ] **Step 2: Accept the prop and render the visualization in `components/economics-calculator.tsx`**

Add these imports at the top (with the other imports):

```tsx
import { FacilityVisualization } from "@/components/facility-visualization";
import { mapKind } from "@/lib/scene/layout";
```

Add `facilitySlug: string;` to the component's props type, and destructure it in the
function signature alongside `capacity, capacityUnit, initialAssumptions`.

Then, immediately AFTER the closing `</Card>` of the "Допущения" card and BEFORE the final
closing `</div>` of the component's returned JSX, add:

```tsx
      <FacilityVisualization
        facilityKind={mapKind(facilitySlug)}
        params={params}
        assumptions={assumptions}
        capacity={capacity}
        capacityUnit={capacityUnit}
        result={result}
      />
```

(`params`, `assumptions`, `capacity`, `capacityUnit`, and `result` are already in scope in
this component from Week 2.)

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: exit 0, `/calculate/[solutionId]` route still registered.

- [ ] **Step 4: End-to-end verification (build + curl, DB up)**

```bash
(npm run dev > /tmp/rrp-dev-w3.log 2>&1 &) ; sleep 8
SID=$(curl -s http://localhost:3000/compare/warehouse | grep -oE '/calculate/[a-z0-9]+' | head -1 | cut -d/ -f3)
echo "solution id: $SID"
curl -s "http://localhost:3000/calculate/$SID" | grep -oE 'Визуализация работы роботов|Роботов в работе|Загрузка|Накопленная экономия|<canvas' | sort -u
pkill -f "next dev" 2>/dev/null; pkill -f "next-server" 2>/dev/null; true
```
Expected: the page HTML now contains "Визуализация работы роботов", "Роботов в работе",
"Загрузка", "Накопленная экономия", and a `<canvas` element. (The animation itself is
client-only — a controller/browser check confirms motion; curl confirms the panel renders.)

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/calculate" components/economics-calculator.tsx
git commit -m "Wire facility visualization into Step 3 calculate page"
```

---

## Definition of done

- [ ] `npm run build` succeeds; `/calculate/[solutionId]` route registered.
- [ ] With DB up + seeded, `npx --yes vitest run < /dev/null` passes all tests — the prior
  19 + 3 normalize-helper + ~7 layout + ~5 simulate + ~5 kpi (≈39 total; exact count may
  vary slightly with how cases are grouped, but all green).
- [ ] `npm run dev`: on `/calculate/[id]` a 2D scene animates robots on a per-vertical
  layout beside live KPIs (robots in work, deployed capacity, utilization %, ROI-accrued
  bar in RUB+USD); differs by vertical; robot count reflects `quantity` clamped to ≤24 with
  the "показано 24 из N" badge when exceeded; a not-economical result shows the "не
  окупается" KPI state; editing a param visibly changes the scene.
- [ ] Extreme inputs (huge area/ops) do not explode the grid or agent count (I7).
- [ ] Each task committed individually.
- [ ] `CHANGELOG.md` updated with a Week 3 summary (final step, one commit).
