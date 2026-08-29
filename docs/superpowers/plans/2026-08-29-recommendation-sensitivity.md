# ROI-Ranked Recommendation + Sensitivity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the Step-3 calculate page, rank a category's solutions by the user's real ROI (NPV) with an in-place "switch primary" action, and show an NPV sensitivity tornado — all computed live from the entered params/assumptions.

**Architecture:** Two new pure engine modules (`recommend.ts`, `sensitivity.ts`) plus a behavior-preserving extraction of the finance step out of `calculate.ts` (so the tornado can compute honest negative NPVs). The calculate page loads the primary solution's category siblings; the existing calculator shell gains `selectedSolutionId` state so results/visualization/save follow an in-place switch. Two presentational components render the ranking and a hand-rolled SVG tornado.

**Tech Stack:** Next.js 16 (App Router) + React 19 + TypeScript, Prisma 7 (driver adapter), Vitest, Tailwind v4. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-29-recommendation-sensitivity-design.md`

## Global Constraints

- **Never commit to `master`.** Work on branch `recommendation-sensitivity` (already checked out).
- **Prisma 7 needs the driver adapter**; DB runs on host port **5433** (`docker compose up -d`). Tests/build need the DB up.
- **Run tests with:** `npx --yes vitest run < /dev/null` (vitest.config.mts, `@/` alias). Verify build with `npm run build` (exit 0).
- **The existing 83 tests MUST stay green after every task** — the finance extraction (Task 1) is behavior-preserving and they are its parity check.
- **UI is Russian.** Money is rendered via `formatCost(usd, usdToRub)`; year counts via `formatYearsRu`.
- **DRY / YAGNI / TDD.** One commit per task. Do NOT change any economics OUTPUT number — Task 1 must be behavior-preserving.

## File structure

- `lib/economics/calculate.ts` — MODIFY: extract exported `baseEconomics`; call `projectFinance`.
- `lib/economics/finance.ts` — MODIFY: add `projectFinance`.
- `lib/economics/sensitivity.ts` — CREATE: `npvForScenario`, `sensitivity`, `SensitivityBar`.
- `lib/economics/recommend.ts` — CREATE: `rankSolutions`, `RankedSolution`.
- `lib/db/queries.ts` — MODIFY: add `getSiblingSolutions` + `SiblingSolution` type.
- `components/calculator/assumption-labels.ts` — CREATE: shared `ASSUMPTION_LABELS` + `RATIO_KEYS`.
- `components/calculator/assumptions-panel.tsx` — MODIFY: import the shared labels.
- `components/calculator/recommendation-panel.tsx` — CREATE.
- `components/calculator/sensitivity-chart.tsx` — CREATE.
- `components/economics-calculator.tsx` — MODIFY: `selectedSolutionId` state, `categorySolutions` prop, compose panels.
- `app/(app)/calculate/[solutionId]/page.tsx` — MODIFY: fetch siblings, pass props.
- Tests: `lib/economics/finance.test.ts` (extend), `lib/economics/sensitivity.test.ts` (new), `lib/economics/recommend.test.ts` (new).

---

### Task 1: Extract `baseEconomics` + `projectFinance` (behavior-preserving)

**Files:**
- Modify: `lib/economics/finance.ts`
- Modify: `lib/economics/calculate.ts`
- Test: `lib/economics/finance.test.ts`, `lib/economics/calculate.test.ts` (existing — parity)

**Interfaces:**
- Produces:
  - `baseEconomics(cap: SolutionCapacity, params: FacilityParams, a: AssumptionValues): BaseEconomics | null` where `BaseEconomics = { quantity: number; displacedFte: number; capexUsd: number; opexAnnualUsd: number; baselineAnnualUsd: number; annualSavingsUsd: number }` (exported from `calculate.ts`). Returns `null` for every `invalid_inputs` condition.
  - `projectFinance(annualSavingsUsd: number, capexUsd: number, a: AssumptionValues): { npvUsd: number; simplePaybackYears: number; simpleRoiPct: number; discountedPaybackYears: number | null }` (exported from `finance.ts`). Does NOT gate on savings sign.

- [ ] **Step 1: Add a parity test to `calculate.test.ts`** (guards the refactor). Append inside the top-level `describe("computeEconomics", …)`:

```ts
  it("finance figures stay consistent after the projectFinance extraction (parity)", () => {
    const params: FacilityParams = { areaM2: 1000, opsPerDay: 400, staffCount: 10 };
    const r = computeEconomics(cap, params, a);
    if (!r.economical) throw new Error("expected economical");
    // Values pinned pre-refactor (assetLife 7 >= horizon 5 -> no re-CAPEX).
    expect(r.simplePaybackYears).toBeCloseTo(57500 / 159000, 6);
    expect(r.simpleRoiPct).toBeCloseTo(((159000 * 5 - 57500) / 57500) * 100, 4);
    expect(r.npvUsd).toBeGreaterThan(0);
    expect(Number.isFinite(r.npvUsd)).toBe(true);
  });
```

- [ ] **Step 2: Run it — expect PASS** (documents current behavior before refactor).

Run: `npx --yes vitest run lib/economics/calculate < /dev/null`
Expected: PASS.

- [ ] **Step 3: Add `projectFinance` to `finance.ts`** (append after `discountedPaybackYears`):

```ts
import type { AssumptionValues } from "./types";

/**
 * A3 finance projection over the ROI horizon. Re-buys the fleet when assets wear out with
 * productive years left (`t % lifeYears === 0 && t < horizon`); life floored to whole years.
 * Does NOT gate on savings sign — a negative annualSavings yields a real negative NPV (used by
 * the sensitivity tornado).
 */
export function projectFinance(
  annualSavingsUsd: number,
  capexUsd: number,
  a: AssumptionValues
): { npvUsd: number; simplePaybackYears: number; simpleRoiPct: number; discountedPaybackYears: number | null } {
  const horizon = Math.floor(a.roiHorizonYears);
  const lifeYears = Math.floor(a.assetLifeYears);
  const cashflows: number[] = [-capexUsd];
  let reCapexTotal = 0;
  for (let t = 1; t <= horizon; t++) {
    const reCapex = t % lifeYears === 0 && t < horizon ? capexUsd : 0;
    reCapexTotal += reCapex;
    cashflows.push(annualSavingsUsd - reCapex);
  }
  const investmentUsd = capexUsd + reCapexTotal;
  return {
    npvUsd: npv(a.discountRate, cashflows),
    simplePaybackYears: capexUsd / annualSavingsUsd,
    simpleRoiPct: ((annualSavingsUsd * horizon - investmentUsd) / investmentUsd) * 100,
    discountedPaybackYears: discountedPaybackYears(a.discountRate, cashflows),
  };
}
```

- [ ] **Step 4: Refactor `calculate.ts`** to use `baseEconomics` + `projectFinance`. Replace the whole body of `computeEconomics` and add the exported helper:

```ts
import type {
  SolutionCapacity,
  FacilityParams,
  AssumptionValues,
  EconomicsResult,
} from "./types";
import { computeQuantity, demandPerYear } from "./normalize";
import { projectFinance } from "./finance";

export type BaseEconomics = {
  quantity: number;
  displacedFte: number;
  capexUsd: number;
  opexAnnualUsd: number;
  baselineAnnualUsd: number;
  annualSavingsUsd: number;
};

/**
 * Shared core: quantity + capex/opex + A1/A2 savings, with all invalid_inputs guards. Returns
 * null for degenerate inputs. Used by computeEconomics and by the sensitivity engine.
 */
export function baseEconomics(
  cap: SolutionCapacity,
  params: FacilityParams,
  a: AssumptionValues
): BaseEconomics | null {
  const quantity = computeQuantity(cap, params, a);
  if (
    quantity === null ||
    !(a.opsPerWorkerPerYear > 0) ||
    !(a.roiHorizonYears >= 1) ||
    !(a.assetLifeYears >= 1) ||
    !(a.discountRate > -1)
  ) {
    return null;
  }

  const annualLaborCostPerFteUsd = a.laborCostPerHourUsd * a.hoursPerYear;
  const maxDisplaceableFte = demandPerYear(params, a) / a.opsPerWorkerPerYear;
  const displacedFte = Math.max(0, Math.min(params.staffCount, maxDisplaceableFte));
  const baselineAnnualUsd = displacedFte * annualLaborCostPerFteUsd;

  const capexUsd = quantity * cap.priceUsd * (1 + a.installPctOfCapex);
  const opexAnnualUsd =
    quantity * (cap.maintenanceUsdYear + cap.energyUsdYear + cap.licensingUsdYear);
  const annualSavingsUsd =
    baselineAnnualUsd * a.laborReplacementPct * (1 - a.residualSupervisionPct) - opexAnnualUsd;

  const finite =
    Number.isFinite(displacedFte) &&
    Number.isFinite(capexUsd) &&
    Number.isFinite(opexAnnualUsd) &&
    Number.isFinite(baselineAnnualUsd) &&
    Number.isFinite(annualSavingsUsd);
  if (!finite || capexUsd <= 0) return null;

  return { quantity, displacedFte, capexUsd, opexAnnualUsd, baselineAnnualUsd, annualSavingsUsd };
}

export function computeEconomics(
  cap: SolutionCapacity,
  params: FacilityParams,
  a: AssumptionValues
): EconomicsResult {
  const base = baseEconomics(cap, params, a);
  if (base === null) return { economical: false, reason: "invalid_inputs" };

  if (base.annualSavingsUsd <= 0) {
    return { economical: false, reason: "no_savings", ...base };
  }

  const fin = projectFinance(base.annualSavingsUsd, base.capexUsd, a);
  return { economical: true, ...base, ...fin };
}
```

- [ ] **Step 5: Run the full suite — expect PASS** (parity: identical numbers).

Run: `npx --yes vitest run < /dev/null`
Expected: `Tests  84 passed (84)` (83 + the new parity test).

- [ ] **Step 6: Verify build**

Run: `npm run build` — expect exit 0, no TS errors.

- [ ] **Step 7: Commit**

```bash
git add lib/economics/finance.ts lib/economics/calculate.ts lib/economics/calculate.test.ts
git commit -m "refactor: extract baseEconomics + projectFinance (behavior-preserving)"
```

---

### Task 2: Sensitivity engine (`sensitivity.ts`)

**Files:**
- Create: `lib/economics/sensitivity.ts`
- Test: `lib/economics/sensitivity.test.ts`

**Interfaces:**
- Consumes: `baseEconomics` (Task 1) from `./calculate`, `projectFinance` from `./finance`.
- Produces:
  - `npvForScenario(cap: SolutionCapacity, params: FacilityParams, a: AssumptionValues): number | null`
  - `type SensitivityBar = { key: keyof AssumptionValues; baseNpv: number; lowNpv: number; highNpv: number; swing: number }`
  - `sensitivity(cap: SolutionCapacity, params: FacilityParams, a: AssumptionValues, deltaPct?: number): SensitivityBar[]`

- [ ] **Step 1: Write `sensitivity.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { npvForScenario, sensitivity } from "./sensitivity";
import type { SolutionCapacity, FacilityParams, AssumptionValues } from "./types";

const a: AssumptionValues = {
  laborCostPerHourUsd: 15, hoursPerYear: 2000, workingDaysPerYear: 250,
  operatingHoursPerDay: 16, installPctOfCapex: 0.15, laborReplacementPct: 0.5,
  residualSupervisionPct: 0.1, opsPerWorkerPerYear: 12500, turnoverPerDay: 8,
  roiHorizonYears: 5, discountRate: 0.12, assetLifeYears: 7, usdToRub: 90,
};
const cap: SolutionCapacity = {
  capacityPerUnit: 400, capacityBasis: "PER_DAY_FLOW", priceUsd: 50000,
  maintenanceUsdYear: 6000, energyUsdYear: 1000, licensingUsdYear: 2000,
};
const params: FacilityParams = { areaM2: 1000, opsPerDay: 400, staffCount: 10 };

describe("npvForScenario", () => {
  it("returns a finite NPV for an economical scenario", () => {
    const v = npvForScenario(cap, params, a);
    expect(v).not.toBeNull();
    expect(Number.isFinite(v!)).toBe(true);
    expect(v!).toBeGreaterThan(0);
  });
  it("returns a real NEGATIVE NPV when savings go negative (not truncated to 0)", () => {
    // Tiny displaceable workload -> savings < 0, but capex still incurred -> NPV < 0.
    const v = npvForScenario(cap, { ...params, opsPerDay: 20, staffCount: 1 }, a);
    expect(v).not.toBeNull();
    expect(v!).toBeLessThan(0);
  });
  it("returns null for invalid inputs", () => {
    expect(npvForScenario(cap, params, { ...a, opsPerWorkerPerYear: 0 })).toBeNull();
  });
});

describe("sensitivity", () => {
  it("returns bars sorted by swing descending, all with positive swing", () => {
    const bars = sensitivity(cap, params, a);
    expect(bars.length).toBeGreaterThan(0);
    for (let i = 1; i < bars.length; i++) {
      expect(bars[i - 1].swing).toBeGreaterThanOrEqual(bars[i].swing);
    }
    expect(bars.every((b) => b.swing >= 0)).toBe(true);
  });
  it("does not perturb display-only usdToRub", () => {
    const bars = sensitivity(cap, params, a);
    expect(bars.some((b) => b.key === "usdToRub")).toBe(false);
  });
  it("labor cost is among the strongest levers", () => {
    const bars = sensitivity(cap, params, a);
    const top3 = bars.slice(0, 3).map((b) => b.key);
    expect(top3).toContain("laborCostPerHourUsd");
  });
  it("returns [] when the base case is invalid", () => {
    expect(sensitivity(cap, params, { ...a, assetLifeYears: 0 })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (module not found).

Run: `npx --yes vitest run lib/economics/sensitivity < /dev/null`
Expected: FAIL.

- [ ] **Step 3: Implement `sensitivity.ts`**

```ts
import type { SolutionCapacity, FacilityParams, AssumptionValues } from "./types";
import { baseEconomics } from "./calculate";
import { projectFinance } from "./finance";

/** NPV for a scenario, allowing negative savings (real negative NPV). null only if invalid. */
export function npvForScenario(
  cap: SolutionCapacity,
  params: FacilityParams,
  a: AssumptionValues
): number | null {
  const base = baseEconomics(cap, params, a);
  if (base === null) return null;
  return projectFinance(base.annualSavingsUsd, base.capexUsd, a).npvUsd;
}

export type SensitivityBar = {
  key: keyof AssumptionValues;
  baseNpv: number;
  lowNpv: number;
  highNpv: number;
  swing: number;
};

// Economically meaningful levers; excludes display-only usdToRub and basis/timing constants.
const PERTURBED_KEYS: (keyof AssumptionValues)[] = [
  "laborCostPerHourUsd",
  "laborReplacementPct",
  "opsPerWorkerPerYear",
  "residualSupervisionPct",
  "installPctOfCapex",
  "discountRate",
  "assetLifeYears",
  "roiHorizonYears",
];

/** One-at-a-time ±deltaPct tornado on NPV, sorted by swing desc. [] if base is invalid. */
export function sensitivity(
  cap: SolutionCapacity,
  params: FacilityParams,
  a: AssumptionValues,
  deltaPct = 0.25
): SensitivityBar[] {
  const baseNpv = npvForScenario(cap, params, a);
  if (baseNpv === null) return [];

  const bars: SensitivityBar[] = [];
  for (const key of PERTURBED_KEYS) {
    const lowNpv = npvForScenario(cap, params, { ...a, [key]: a[key] * (1 - deltaPct) });
    const highNpv = npvForScenario(cap, params, { ...a, [key]: a[key] * (1 + deltaPct) });
    if (lowNpv === null || highNpv === null) continue;
    bars.push({ key, baseNpv, lowNpv, highNpv, swing: Math.abs(highNpv - lowNpv) });
  }
  return bars.sort((x, y) => y.swing - x.swing);
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx --yes vitest run lib/economics/sensitivity < /dev/null`
Expected: PASS (4 sensitivity + 3 npvForScenario).

- [ ] **Step 5: Commit**

```bash
git add lib/economics/sensitivity.ts lib/economics/sensitivity.test.ts
git commit -m "feat: NPV sensitivity tornado engine (sensitivity.ts)"
```

---

### Task 3: Recommendation engine (`recommend.ts`)

**Files:**
- Create: `lib/economics/recommend.ts`
- Test: `lib/economics/recommend.test.ts`

**Interfaces:**
- Consumes: `computeEconomics` (from `./calculate`), `SolutionCapacity` and result types.
- Produces:
  - `type SiblingSolution = SolutionCapacity & { id: string; name: string; vendor: string; capacityUnit: string }` (defined here and re-exported by `queries.ts` in Task 4 — single source of truth is `recommend.ts`).
  - `type RankedSolution = { id: string; name: string; vendor: string; result: EconomicsResult }`
  - `rankSolutions(siblings: SiblingSolution[], params: FacilityParams, a: AssumptionValues): RankedSolution[]`

- [ ] **Step 1: Write `recommend.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { rankSolutions, type SiblingSolution } from "./recommend";
import type { FacilityParams, AssumptionValues } from "./types";

const a: AssumptionValues = {
  laborCostPerHourUsd: 15, hoursPerYear: 2000, workingDaysPerYear: 250,
  operatingHoursPerDay: 16, installPctOfCapex: 0.15, laborReplacementPct: 0.5,
  residualSupervisionPct: 0.1, opsPerWorkerPerYear: 12500, turnoverPerDay: 8,
  roiHorizonYears: 5, discountRate: 0.12, assetLifeYears: 7, usdToRub: 90,
};
const params: FacilityParams = { areaM2: 1000, opsPerDay: 400, staffCount: 10 };

const base = {
  capacityBasis: "PER_DAY_FLOW" as const, capacityPerUnit: 400, capacityUnit: "паллет/день",
  maintenanceUsdYear: 6000, energyUsdYear: 1000, licensingUsdYear: 2000,
};
// cheaper price -> higher NPV; expensive -> lower; broken -> no_savings
const cheap: SiblingSolution = { ...base, id: "cheap", name: "Cheap", vendor: "V", priceUsd: 40000 };
const pricey: SiblingSolution = { ...base, id: "pricey", name: "Pricey", vendor: "V", priceUsd: 90000 };
const unprofitable: SiblingSolution = {
  ...base, id: "bad", name: "Bad", vendor: "V", priceUsd: 40000,
  maintenanceUsdYear: 500000, energyUsdYear: 0, licensingUsdYear: 0, // OPEX >> savings
};

describe("rankSolutions", () => {
  it("orders economical solutions by NPV descending", () => {
    const ranked = rankSolutions([pricey, cheap], params, a);
    expect(ranked.map((r) => r.id)).toEqual(["cheap", "pricey"]);
    expect(ranked[0].result.economical).toBe(true);
  });
  it("places non-economical solutions after economical ones", () => {
    const ranked = rankSolutions([unprofitable, cheap], params, a);
    expect(ranked[0].id).toBe("cheap");
    expect(ranked[1].id).toBe("bad");
    expect(ranked[1].result.economical).toBe(false);
  });
  it("is a stable single-item list", () => {
    const ranked = rankSolutions([cheap], params, a);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].id).toBe("cheap");
  });
  it("breaks NPV ties deterministically by name", () => {
    const twinA: SiblingSolution = { ...cheap, id: "a", name: "Alpha" };
    const twinB: SiblingSolution = { ...cheap, id: "b", name: "Beta" };
    const ranked = rankSolutions([twinB, twinA], params, a);
    expect(ranked.map((r) => r.name)).toEqual(["Alpha", "Beta"]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (module not found).

Run: `npx --yes vitest run lib/economics/recommend < /dev/null`
Expected: FAIL.

- [ ] **Step 3: Implement `recommend.ts`**

```ts
import type {
  SolutionCapacity,
  FacilityParams,
  AssumptionValues,
  EconomicsResult,
} from "./types";
import { computeEconomics } from "./calculate";

export type SiblingSolution = SolutionCapacity & {
  id: string;
  name: string;
  vendor: string;
  capacityUnit: string;
};

export type RankedSolution = {
  id: string;
  name: string;
  vendor: string;
  result: EconomicsResult;
};

// Higher = ranked first. Economical (has NPV) beats no_savings beats invalid_inputs.
function tier(r: EconomicsResult): number {
  if (r.economical) return 2;
  return r.reason === "no_savings" ? 1 : 0;
}

/** Rank a category's solutions for the given facility: economical by NPV desc, others after. */
export function rankSolutions(
  siblings: SiblingSolution[],
  params: FacilityParams,
  a: AssumptionValues
): RankedSolution[] {
  const ranked: RankedSolution[] = siblings.map((s) => ({
    id: s.id,
    name: s.name,
    vendor: s.vendor,
    result: computeEconomics(
      {
        capacityPerUnit: s.capacityPerUnit,
        capacityBasis: s.capacityBasis,
        priceUsd: s.priceUsd,
        maintenanceUsdYear: s.maintenanceUsdYear,
        energyUsdYear: s.energyUsdYear,
        licensingUsdYear: s.licensingUsdYear,
      },
      params,
      a
    ),
  }));

  return ranked.sort((x, y) => {
    const dt = tier(y.result) - tier(x.result);
    if (dt !== 0) return dt;
    const xn = x.result.economical ? x.result.npvUsd : -Infinity;
    const yn = y.result.economical ? y.result.npvUsd : -Infinity;
    if (yn !== xn) return yn - xn;
    return x.name.localeCompare(y.name);
  });
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx --yes vitest run lib/economics/recommend < /dev/null`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/economics/recommend.ts lib/economics/recommend.test.ts
git commit -m "feat: rankSolutions recommendation engine (recommend.ts)"
```

---

### Task 4: `getSiblingSolutions` query

**Files:**
- Modify: `lib/db/queries.ts`

**Interfaces:**
- Consumes: `SiblingSolution` type (from `lib/economics/recommend`).
- Produces: `getSiblingSolutions(solutionId: string): Promise<SiblingSolution[]>` — every solution in the same category as `solutionId`, ordered by name (primary included). `[]` if the solution doesn't exist.

- [ ] **Step 1: Add the query to `queries.ts`** (append near `getSolutionForCalc`):

```ts
import type { SiblingSolution } from "@/lib/economics/recommend";

export async function getSiblingSolutions(solutionId: string): Promise<SiblingSolution[]> {
  const solution = await prisma.solution.findUnique({
    where: { id: solutionId },
    select: { solutionCategoryId: true },
  });
  if (!solution) return [];
  const rows = await prisma.solution.findMany({
    where: { solutionCategoryId: solution.solutionCategoryId },
    orderBy: { name: "asc" },
    select: {
      id: true, name: true, vendor: true, priceUsd: true, capacityPerUnit: true,
      capacityUnit: true, capacityBasis: true, maintenanceUsdYear: true,
      energyUsdYear: true, licensingUsdYear: true,
    },
  });
  return rows;
}
```
Note: Prisma generates `capacityBasis` as the same string-literal union the engine uses (this is
why `getSolutionForCalc`'s result already assigns into `SolutionCapacity` in the page today), so
`return rows` satisfies `SiblingSolution[]` directly. If TS ever objects on the enum, cast the
field: `return rows.map((r) => ({ ...r, capacityBasis: r.capacityBasis as CapacityBasis }))` and
`import type { CapacityBasis } from "@/lib/economics/types"`.

- [ ] **Step 2: Add an integration test to `lib/db/queries.test.ts`** (needs the seeded DB up):

```ts
describe("getSiblingSolutions", () => {
  it("returns all solutions in a solution's category, ordered by name", async () => {
    const warehouse = await getCatalogForFacilityType("warehouse");
    const amr = warehouse!.solutionCategories.find((c) => c.slug === "amr")!;
    const one = amr.solutions[0].id;
    const siblings = await getSiblingSolutions(one);
    expect(siblings.length).toBe(amr.solutions.length);
    expect(siblings.map((s) => s.id)).toContain(one);
    const names = siblings.map((s) => s.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
  it("returns [] for an unknown solution id", async () => {
    expect(await getSiblingSolutions("does-not-exist")).toEqual([]);
  });
});
```
Add `getSiblingSolutions` to the existing `import { … } from "./queries"` line at the top of the test file.

- [ ] **Step 3: Run — expect PASS** (DB must be up: `docker compose up -d`).

Run: `npx --yes vitest run lib/db/queries < /dev/null`
Expected: PASS.

- [ ] **Step 4: Verify build** (`npm run build`, exit 0).

- [ ] **Step 5: Commit**

```bash
git add lib/db/queries.ts lib/db/queries.test.ts
git commit -m "feat: getSiblingSolutions query (category siblings for a solution)"
```

---

### Task 5: Shared assumption labels module

**Files:**
- Create: `components/calculator/assumption-labels.ts`
- Modify: `components/calculator/assumptions-panel.tsx`

**Interfaces:**
- Produces: `ASSUMPTION_LABELS: Record<keyof AssumptionValues, string>` and `RATIO_KEYS: Set<keyof AssumptionValues>` from `assumption-labels.ts`.

- [ ] **Step 1: Create `assumption-labels.ts`** — move the two consts verbatim out of `assumptions-panel.tsx`:

```ts
import type { AssumptionValues } from "@/lib/economics/types";

export const ASSUMPTION_LABELS: Record<keyof AssumptionValues, string> = {
  laborCostPerHourUsd: "Стоимость труда (USD/час)",
  hoursPerYear: "Рабочих часов в году",
  workingDaysPerYear: "Рабочих дней в году",
  operatingHoursPerDay: "Часов работы в сутки",
  installPctOfCapex: "Монтаж (доля от CAPEX)",
  laborReplacementPct: "Замещение труда (доля)",
  residualSupervisionPct: "Остаточный надзор (доля)",
  opsPerWorkerPerYear: "Операций на сотрудника в год",
  turnoverPerDay: "Оборотов в сутки",
  roiHorizonYears: "Горизонт ROI (лет)",
  discountRate: "Ставка дисконтирования (доля)",
  assetLifeYears: "Срок службы техники (лет)",
  usdToRub: "Курс USD→RUB",
};

// Ratio (0..1 fraction) assumptions get a finer spinner step; everything else steps by 1.
export const RATIO_KEYS = new Set<keyof AssumptionValues>([
  "installPctOfCapex",
  "laborReplacementPct",
  "residualSupervisionPct",
  "discountRate",
]);
```

- [ ] **Step 2: Update `assumptions-panel.tsx`** — delete the two local consts and import them:

Remove the `const ASSUMPTION_LABELS…` and `const RATIO_KEYS…` blocks. Add near the top:
```ts
import { ASSUMPTION_LABELS, RATIO_KEYS } from "./assumption-labels";
```
(`BASIS_ONLY` and the component stay as-is.)

- [ ] **Step 3: Verify build + tests** (behavior-preserving).

Run: `npm run build` (exit 0) and `npx --yes vitest run < /dev/null` (all green).

- [ ] **Step 4: Commit**

```bash
git add components/calculator/assumption-labels.ts components/calculator/assumptions-panel.tsx
git commit -m "refactor: lift ASSUMPTION_LABELS/RATIO_KEYS into a shared module"
```

---

### Task 6: `SensitivityChart` component

**Files:**
- Create: `components/calculator/sensitivity-chart.tsx`

**Interfaces:**
- Consumes: `SensitivityBar` (from `@/lib/economics/sensitivity`), `ASSUMPTION_LABELS` (Task 5), `formatCost`.
- Produces: `<SensitivityChart bars={SensitivityBar[]} usdToRub={number} />`. Renders `null` when `bars` is empty.

- [ ] **Step 1: Implement the component**

```tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ASSUMPTION_LABELS } from "./assumption-labels";
import { formatCost } from "@/lib/format/currency";
import type { SensitivityBar } from "@/lib/economics/sensitivity";

export function SensitivityChart({
  bars,
  usdToRub,
}: {
  bars: SensitivityBar[];
  usdToRub: number;
}) {
  if (bars.length === 0) return null;
  const maxSwing = Math.max(...bars.map((b) => b.swing), 1);

  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <CardTitle>Чувствительность NPV к допущениям</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <p className="text-xs text-muted-foreground">
          Размах NPV при изменении каждого допущения на ±25%. Чем длиннее полоса, тем сильнее
          допущение влияет на результат.
        </p>
        {bars.map((b) => (
          <div key={b.key} className="grid grid-cols-[minmax(9rem,14rem)_1fr_auto] items-center gap-3">
            <span className="truncate" title={ASSUMPTION_LABELS[b.key]}>
              {ASSUMPTION_LABELS[b.key]}
            </span>
            <div className="h-3 w-full rounded bg-muted">
              <div
                className="h-full rounded bg-sky-500"
                style={{ width: `${Math.round((b.swing / maxSwing) * 100)}%` }}
              />
            </div>
            <span className="whitespace-nowrap tabular-nums text-muted-foreground">
              {formatCost(b.swing, usdToRub)}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Verify build** (`npm run build`, exit 0 — component compiles; it's wired in Task 8).

- [ ] **Step 3: Commit**

```bash
git add components/calculator/sensitivity-chart.tsx
git commit -m "feat: SensitivityChart tornado component"
```

---

### Task 7: `RecommendationPanel` component

**Files:**
- Create: `components/calculator/recommendation-panel.tsx`

**Interfaces:**
- Consumes: `RankedSolution` (from `@/lib/economics/recommend`), `formatCost`, `formatYearsRu`.
- Produces: `<RecommendationPanel ranked={RankedSolution[]} selectedId={string} usdToRub={number} onSelect={(id: string) => void} />`. Renders `null` when `ranked.length < 2`.

- [ ] **Step 1: Implement the component**

```tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCost } from "@/lib/format/currency";
import { formatYearsRu } from "@/lib/format/plural";
import type { RankedSolution } from "@/lib/economics/recommend";

export function RecommendationPanel({
  ranked,
  selectedId,
  usdToRub,
  onSelect,
}: {
  ranked: RankedSolution[];
  selectedId: string;
  usdToRub: number;
  onSelect: (id: string) => void;
}) {
  if (ranked.length < 2) return null;
  const bestId = ranked[0].result.economical ? ranked[0].id : null;

  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <CardTitle>Рекомендация для вашего объекта</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <p className="text-xs text-muted-foreground">
          Решения этой категории, отсортированные по NPV при ваших параметрах.
        </p>
        {ranked.map((r) => {
          const isSelected = r.id === selectedId;
          const isBest = r.id === bestId;
          return (
            <div
              key={r.id}
              className={`flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 ${
                isSelected ? "border-sky-500 bg-sky-50/50" : ""
              }`}
            >
              <div className="min-w-40">
                <div className="font-medium">
                  {isBest ? "★ " : ""}
                  {r.name}
                  {isSelected ? (
                    <span className="ml-2 text-xs text-sky-700">вы смотрите</span>
                  ) : null}
                </div>
                <div className="text-xs text-muted-foreground">{r.vendor}</div>
              </div>
              <div className="flex items-center gap-4">
                {r.result.economical ? (
                  <span className="tabular-nums text-muted-foreground">
                    {formatYearsRu(r.result.simplePaybackYears)} · NPV{" "}
                    {formatCost(r.result.npvUsd, usdToRub)}
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    {r.result.economical === false && r.result.reason === "no_savings"
                      ? "не окупается"
                      : "проверьте параметры"}
                  </span>
                )}
                {!isSelected && (
                  <button
                    onClick={() => onSelect(r.id)}
                    className="rounded-md border px-2 py-1 text-xs font-medium"
                  >
                    Сделать основным
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Verify build** (`npm run build`, exit 0).

- [ ] **Step 3: Commit**

```bash
git add components/calculator/recommendation-panel.tsx
git commit -m "feat: RecommendationPanel ranked-solutions component"
```

---

### Task 8: Wire the shell + calculate page (in-place switching + compose)

> Tasks for the shell and the page are combined because the shell's prop-shape change and the
> page's prop-passing change are inseparable — neither builds without the other. This task's
> deliverable is the whole feature rendering end-to-end.

**Files:**
- Modify: `components/economics-calculator.tsx`
- Modify: `app/(app)/calculate/[solutionId]/page.tsx`

**Interfaces:**
- Consumes: `categorySolutions: SiblingSolution[]`, `initialSelectedId: string` (new shell props), `rankSolutions`, `sensitivity`, `RecommendationPanel`, `SensitivityChart`, `getSiblingSolutions`.
- Produces: the composed calculator with in-place switching, wired into the page.

- [ ] **Step 1: Rewrite `economics-calculator.tsx`** to hold `selectedSolutionId` and derive the primary solution:

```tsx
"use client";

import { useState } from "react";
import { FacilityVisualization } from "@/components/facility-visualization";
import { ParamsForm } from "@/components/calculator/params-form";
import { ResultsPanel } from "@/components/calculator/results-panel";
import { AssumptionsPanel } from "@/components/calculator/assumptions-panel";
import { SaveControl } from "@/components/calculator/save-control";
import { RecommendationPanel } from "@/components/calculator/recommendation-panel";
import { SensitivityChart } from "@/components/calculator/sensitivity-chart";
import { mapKind } from "@/lib/scene/layout";
import { computeEconomics } from "@/lib/economics/calculate";
import { rankSolutions, type SiblingSolution } from "@/lib/economics/recommend";
import { sensitivity } from "@/lib/economics/sensitivity";
import type {
  SolutionCapacity,
  FacilityParams,
  AssumptionValues,
} from "@/lib/economics/types";

export function EconomicsCalculator({
  categorySolutions,
  initialSelectedId,
  initialAssumptions,
  facilitySlug,
  initialParams,
}: {
  categorySolutions: SiblingSolution[];
  initialSelectedId: string;
  initialAssumptions: AssumptionValues;
  facilitySlug: string;
  initialParams?: FacilityParams;
}) {
  const [selectedSolutionId, setSelectedSolutionId] = useState(initialSelectedId);
  const primary =
    categorySolutions.find((s) => s.id === selectedSolutionId) ?? categorySolutions[0];

  const isStock = primary.capacityBasis === "CONCURRENT_STOCK";
  const [params, setParams] = useState<FacilityParams>(
    initialParams ?? {
      areaM2: 1000,
      opsPerDay: 500,
      staffCount: 10,
      ...(isStock ? { peakConcurrent: 20 } : {}),
    }
  );
  const [assumptions, setAssumptions] = useState<AssumptionValues>(initialAssumptions);

  const capacity: SolutionCapacity = {
    capacityPerUnit: primary.capacityPerUnit,
    capacityBasis: primary.capacityBasis,
    priceUsd: primary.priceUsd,
    maintenanceUsdYear: primary.maintenanceUsdYear,
    energyUsdYear: primary.energyUsdYear,
    licensingUsdYear: primary.licensingUsdYear,
  };

  const result = computeEconomics(capacity, params, assumptions);
  const ranked = rankSolutions(categorySolutions, params, assumptions);
  const bars = sensitivity(capacity, params, assumptions);

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <ParamsForm
        params={params}
        setParams={setParams}
        capacity={capacity}
        capacityUnit={primary.capacityUnit}
      />
      <ResultsPanel result={result} usdToRub={assumptions.usdToRub} />
      <RecommendationPanel
        ranked={ranked}
        selectedId={selectedSolutionId}
        usdToRub={assumptions.usdToRub}
        onSelect={setSelectedSolutionId}
      />
      <SensitivityChart bars={bars} usdToRub={assumptions.usdToRub} />
      <SaveControl
        facilitySlug={facilitySlug}
        solutionId={selectedSolutionId}
        params={params}
        assumptions={assumptions}
        result={result}
      />
      <AssumptionsPanel
        assumptions={assumptions}
        setAssumptions={setAssumptions}
        capacityBasis={primary.capacityBasis}
      />
      <FacilityVisualization
        facilityKind={mapKind(facilitySlug)}
        params={params}
        assumptions={assumptions}
        capacity={capacity}
        capacityUnit={primary.capacityUnit}
        result={result}
      />
    </div>
  );
}
```

Note: `capacityUnit` and `solutionId` props were previously passed in; they are now derived from `primary`/`selectedSolutionId`, so the page (Step 2 below) no longer passes them.

- [ ] **Step 2: Update the page** (`app/(app)/calculate/[solutionId]/page.tsx`) to fetch siblings and pass the new props. Replace the `Promise.all` that loads `[solution, assumptionRows]` with one that also loads siblings, and replace the component invocation:

```tsx
  const [solution, assumptionRows, categorySolutions] = await Promise.all([
    getSolutionForCalc(solutionId),
    getAssumptions(),
    getSiblingSolutions(solutionId),
  ]);
  if (!solution) notFound();
```

Keep the existing `capacity`, `initialAssumptions`, `initialParams`, and `dataChanged`
(P2) logic unchanged. Then replace the JSX component call with:

```tsx
      <EconomicsCalculator
        categorySolutions={categorySolutions}
        initialSelectedId={solution.id}
        initialAssumptions={initialAssumptions}
        facilitySlug={solution.solutionCategory.facilityType.slug}
        initialParams={initialParams}
      />
```

Add `getSiblingSolutions` to the `import { … } from "@/lib/db/queries"` line.

- [ ] **Step 3: Verify build** (shell + page typecheck together now).

Run: `npm run build` — expect exit 0, no TS errors.

- [ ] **Step 4: Run the full suite**

Run: `npx --yes vitest run < /dev/null`
Expected: all green (~93 tests: the pre-feature 83 + parity + sensitivity(7) + recommend(4) + query(2)).

- [ ] **Step 5: End-to-end smoke test** (verification-before-completion). Start the DB (`docker compose up -d`) and dev server (`npm run dev`). Get a warehouse solution id (e.g. `node -e` Prisma query or from `/compare/warehouse`), then:

```bash
node -e '(async()=>{const id=process.argv[1];const r=await fetch("http://localhost:3000/calculate/"+id);const t=await r.text();
console.log("status",r.status,
"| recommendation:",t.includes("Рекомендация для вашего объекта"),
"| sensitivity:",t.includes("Чувствительность NPV"),
"| best-star:",t.includes("★"));})();' "<warehouse-solution-id>"
```
Expected: status 200; recommendation + sensitivity present; a ★ on the best row. Then manually confirm in a browser that "Сделать основным" swaps the results + visualization **without a reload**.

- [ ] **Step 6: Commit**

```bash
git add components/economics-calculator.tsx "app/(app)/calculate/[solutionId]/page.tsx"
git commit -m "feat: in-place switching + wire recommendation/sensitivity into the page"
```

---

## Whole-feature review (after Task 8)

- [ ] Run `npm run build` (exit 0) and `npx --yes vitest run < /dev/null` (all green).
- [ ] Request a code review (`/code-review high`) over `git diff master...HEAD`; fix findings.
- [ ] Add a CHANGELOG entry under a new "Added" bullet describing the recommendation + sensitivity feature.
- [ ] Merge to master with `--no-ff` only after review + user sign-off.
