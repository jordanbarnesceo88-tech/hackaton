# Break-Even Labor Rate (#8c) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only "break-even labor rate" — the minimum $/hr labor at which the chosen solution's NPV = 0 over the ROI horizon — computed closed-form and shown as a small card on the calculator.

**Architecture:** A pure `lib/economics/breakeven.ts` that reuses `baseEconomics` + `projectFinance` (savings/NPV are linear in the labor rate). A presentational `BreakEvenNote` composed into the calculator shell. No change to any existing output number.

**Tech Stack:** Next.js 16 + React 19 + TS, Prisma 7, Vitest. No new deps.

**Spec:** `docs/superpowers/specs/2026-09-01-breakeven-design.md`

## Global Constraints
- **Never commit to `master`.** Branch `breakeven` (already checked out).
- Tests `npx --yes vitest run < /dev/null`; build `npm run build` (exit 0). DB up on 5433 for the full run.
- **Existing 118 unit + 3 E2E stay green; no existing output number changes** (pure addition).
- UI Russian; money via `formatCost(usd, usdToRub)`.

## File structure
- `lib/economics/breakeven.ts` (+ `.test.ts`) — CREATE: the solver.
- `components/calculator/break-even-note.tsx` — CREATE: the card.
- `components/economics-calculator.tsx` — MODIFY: compose the card.
- `CHANGELOG.md` — MODIFY.

---

### Task 1: `breakEvenLaborRateUsd` solver + tests

**Files:**
- Create: `lib/economics/breakeven.ts`, `lib/economics/breakeven.test.ts`

**Interfaces:**
- Consumes: `baseEconomics` (from `./calculate`), `projectFinance` (from `./finance`).
- Produces: `breakEvenLaborRateUsd(cap: SolutionCapacity, params: FacilityParams, a: AssumptionValues): number | null`.

- [ ] **Step 1: Write the test** `lib/economics/breakeven.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { breakEvenLaborRateUsd } from "./breakeven";
import { computeEconomics } from "./calculate";
import type { SolutionCapacity, FacilityParams, AssumptionValues } from "./types";

const a: AssumptionValues = {
  laborCostPerHourUsd: 15, hoursPerYear: 2000, workingDaysPerYear: 250,
  operatingHoursPerDay: 16, installPctOfCapex: 0.15, laborReplacementPct: 0.7,
  residualSupervisionPct: 0.1, opsPerWorkerPerYear: 12500, turnoverPerDay: 8,
  roiHorizonYears: 5, discountRate: 0.12, assetLifeYears: 7, usdToRub: 90,
  energyCostFactor: 1.0,
};
const cap: SolutionCapacity = {
  capacityPerUnit: 400, capacityBasis: "PER_DAY_FLOW", priceUsd: 50000,
  maintenanceUsdYear: 6000, energyUsdYear: 1000, licensingUsdYear: 2000,
};
const params: FacilityParams = { areaM2: 1000, opsPerDay: 400, staffCount: 10 };

describe("breakEvenLaborRateUsd", () => {
  it("round-trips: at the break-even rate, recomputed NPV ≈ 0", () => {
    const L = breakEvenLaborRateUsd(cap, params, a);
    expect(L).not.toBeNull();
    expect(L!).toBeGreaterThan(0);
    const r = computeEconomics(cap, params, { ...a, laborCostPerHourUsd: L! });
    if (!r.economical) throw new Error("expected economical at break-even");
    // NPV should be ~0 relative to the CAPEX scale.
    expect(Math.abs(r.npvUsd)).toBeLessThan(1); // within $1 of zero
  });

  it("just above the rate → NPV > 0; just below → NPV < 0", () => {
    const L = breakEvenLaborRateUsd(cap, params, a)!;
    const above = computeEconomics(cap, params, { ...a, laborCostPerHourUsd: L + 1 });
    const below = computeEconomics(cap, params, { ...a, laborCostPerHourUsd: Math.max(0.01, L - 1) });
    if (!above.economical) throw new Error("expected economical above");
    expect(above.npvUsd).toBeGreaterThan(0);
    // below may be economical or not, but its NPV must be lower than the break-even (≈0)
    const belowNpv = below.economical ? below.npvUsd : -Infinity;
    expect(belowNpv).toBeLessThan(above.npvUsd);
  });

  it("returns null when no labor can be displaced (replacement 0 → K=0)", () => {
    expect(breakEvenLaborRateUsd(cap, params, { ...a, laborReplacementPct: 0 })).toBeNull();
  });

  it("returns null at 100% residual supervision (K=0)", () => {
    expect(breakEvenLaborRateUsd(cap, params, { ...a, residualSupervisionPct: 1 })).toBeNull();
  });

  it("returns null for invalid inputs (opsPerWorkerPerYear = 0)", () => {
    expect(breakEvenLaborRateUsd(cap, params, { ...a, opsPerWorkerPerYear: 0 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (module missing).
Run: `npx --yes vitest run lib/economics/breakeven < /dev/null` → FAIL.

- [ ] **Step 3: Implement `lib/economics/breakeven.ts`:**
```ts
import type { SolutionCapacity, FacilityParams, AssumptionValues } from "./types";
import { baseEconomics } from "./calculate";
import { projectFinance } from "./finance";

/**
 * Minimum labor rate ($/hr) at which the solution pays back (NPV = 0) over the ROI horizon.
 * Closed-form: displacedFte/quantity/capex/opex are all independent of the labor rate, so
 * annualSavings(L) = K·L − opex is linear (K = displacedFte × hoursPerYear × laborReplacementPct
 * × (1 − residualSupervisionPct)), and NPV is linear in savings. Reuses projectFinance for the
 * annuity/re-CAPEX rather than re-deriving it. Returns null when no rate can make it pay back
 * (K ≤ 0) or the inputs are degenerate.
 */
export function breakEvenLaborRateUsd(
  cap: SolutionCapacity,
  params: FacilityParams,
  a: AssumptionValues
): number | null {
  const base = baseEconomics(cap, params, a);
  if (base === null) return null;

  const K =
    base.displacedFte * a.hoursPerYear * a.laborReplacementPct * (1 - a.residualSupervisionPct);
  if (!(K > 0)) return null;

  // NPV is linear in annualSavings; find the savings that make NPV = 0 by two evaluations.
  const npv0 = projectFinance(0, base.capexUsd, a).npvUsd;
  const npv1 = projectFinance(1, base.capexUsd, a).npvUsd;
  const slope = npv1 - npv0;
  if (!(slope > 0)) return null;

  const breakEvenSavings = -npv0 / slope;
  const laborRate = (breakEvenSavings + base.opexAnnualUsd) / K;
  return Number.isFinite(laborRate) && laborRate > 0 ? laborRate : null;
}
```

- [ ] **Step 4: Run — expect PASS.**
Run: `npx --yes vitest run lib/economics/breakeven < /dev/null` → PASS (5).

- [ ] **Step 5: Full suite + build** — `npx --yes vitest run < /dev/null` (123: 118 + 5), `npm run build` exit 0.

- [ ] **Step 6: Commit**
```bash
git add lib/economics/breakeven.ts lib/economics/breakeven.test.ts
git commit -m "feat: break-even labor rate solver (closed-form NPV=0)"
```

---

### Task 2: `BreakEvenNote` card + compose into the shell + CHANGELOG

**Files:**
- Create: `components/calculator/break-even-note.tsx`
- Modify: `components/economics-calculator.tsx`, `CHANGELOG.md`

**Interfaces:**
- Consumes: `breakEvenLaborRateUsd` (Task 1), `formatCost`.
- Produces: `<BreakEvenNote capacity params assumptions />`.

- [ ] **Step 1: Create `components/calculator/break-even-note.tsx`:**
```tsx
import { breakEvenLaborRateUsd } from "@/lib/economics/breakeven";
import { formatCost } from "@/lib/format/currency";
import type {
  SolutionCapacity,
  FacilityParams,
  AssumptionValues,
} from "@/lib/economics/types";

export function BreakEvenNote({
  capacity,
  params,
  assumptions,
}: {
  capacity: SolutionCapacity;
  params: FacilityParams;
  assumptions: AssumptionValues;
}) {
  const rate = breakEvenLaborRateUsd(capacity, params, assumptions);
  const usdToRub = assumptions.usdToRub;
  const current = assumptions.laborCostPerHourUsd;

  return (
    <div className="md:col-span-2 rounded-lg border bg-muted/30 px-4 py-3 text-sm">
      <span className="font-medium">Точка безубыточности (по ставке труда): </span>
      {rate === null ? (
        <span className="text-muted-foreground">
          не окупается ни при какой ставке труда при текущих параметрах
        </span>
      ) : (
        <>
          окупается при ставке труда ≥ <b>{formatCost(rate, usdToRub)}/час</b> (сейчас{" "}
          {formatCost(current, usdToRub)})
          {current >= rate ? (
            <span className="text-emerald-700"> · запас прочности ×{(current / rate).toFixed(1)}</span>
          ) : (
            <span className="text-amber-700"> · текущая ставка ниже точки безубыточности</span>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Compose into the shell** (`components/economics-calculator.tsx`). Import it, and
render it right AFTER `<HeroResults …/>` (so it sits under the headline, before the params/results
grid items). Add the import near the other calculator imports:
```ts
import { BreakEvenNote } from "@/components/calculator/break-even-note";
```
and immediately after the `<HeroResults ... />` element:
```tsx
      <BreakEvenNote capacity={capacity} params={params} assumptions={assumptions} />
```
(`capacity`, `params`, `assumptions` are already in scope in the shell.)

- [ ] **Step 3: Build + suite + smoke.** `npm run build` exit 0; `npx --yes vitest run < /dev/null`
(123). Then dev-server smoke on a warehouse solution (get an id from `/compare/warehouse` or a
Prisma query):
```bash
node -e '(async()=>{const r=await fetch("http://localhost:3000/calculate/CID");const t=await r.text();
console.log("status",r.status,"| break-even:",t.includes("Точка безубыточности"));})();' # replace CID
```
Expected: 200, `break-even: true`. (Kill the dev server after.)

- [ ] **Step 4: CHANGELOG** — "Added" entry: break-even labor rate on the calculator (min $/hr for
NPV=0 over the horizon + safety margin); read-only, no change to existing numbers.

- [ ] **Step 5: Commit**
```bash
git add components/calculator/break-even-note.tsx components/economics-calculator.tsx CHANGELOG.md
git commit -m "feat: break-even labor-rate note on the calculator + CHANGELOG"
```

---

## Whole-feature review (after Task 2)
- [ ] `npm run build` (exit 0), `npx --yes vitest run < /dev/null` (123), `npm run test:e2e` (3 — unaffected).
- [ ] `/code-review high` over `git diff master...HEAD`; fix findings.
- [ ] Merge to master with `--no-ff` after review + user sign-off.
