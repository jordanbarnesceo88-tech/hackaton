# Regional Labor / Energy Inputs (#8a) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An opt-in region selector that sets the labor rate and a new `energyCostFactor` assumption from a small cited preset table — the default (no region) leaves all existing numbers byte-identical.

**Architecture:** A pure `lib/economics/regions.ts` preset table; a new `energyCostFactor` assumption (default 1.0) that scales the energy term of OPEX in `baseEconomics`; a UI select that seeds two assumptions. No schema change beyond the seeded assumption.

**Tech Stack:** Next.js 16 + React 19 + TS, Prisma 7 (Postgres 5433), Vitest, Playwright. No new deps.

**Spec:** `docs/superpowers/specs/2026-09-01-regional-inputs-design.md`

## Global Constraints

- **Never commit to `master`.** Branch `regional-inputs` (already checked out).
- DB up (`docker compose up -d`, 5433) + seeded. Tests: `npx --yes vitest run < /dev/null`; build `npm run build` (exit 0).
- **`energyCostFactor` default = 1.0 ⇒ existing numbers UNCHANGED.** The parity test guards this; do NOT let default-path outputs move.
- **Existing 106 unit tests + 3 E2E stay green.** Every hand-built `AssumptionValues` fixture must gain `energyCostFactor` or it won't type-check.
- UI Russian; money via `formatCost(usd, usdToRub)`.

## File structure
- `lib/economics/types.ts` — MODIFY: add `energyCostFactor` to `AssumptionValues`.
- `lib/economics/assumptions.ts` — MODIFY: default `energyCostFactor: 1.0`.
- `lib/economics/calculate.ts` — MODIFY: scale energy term by the factor.
- `lib/economics/calculate.test.ts` — MODIFY: fixture + parity + scaling tests.
- `lib/economics/{normalize,sensitivity,recommend}.test.ts`, `lib/scene/kpi.test.ts` — MODIFY: add `energyCostFactor` to fixtures.
- `scripts/seed.ts` — MODIFY: seed the `energyCostFactor` assumption.
- `components/calculator/assumption-labels.ts` — MODIFY: add its label (+ RATIO_KEYS).
- `lib/economics/regions.ts` (+ `.test.ts`) — CREATE: cited preset table + integrity test.
- `components/calculator/region-select.tsx` — CREATE: the selector.
- `components/calculator/params-form.tsx` — MODIFY: compose the selector.
- `components/economics-calculator.tsx` — MODIFY: pass `setAssumptions`/`usdToRub` through.
- `docs/data-provenance.md`, `CHANGELOG.md` — MODIFY.

---

### Task 1: `energyCostFactor` assumption + energy scaling (model change; no-op at default)

**Files:**
- Modify: `lib/economics/types.ts`, `lib/economics/assumptions.ts`, `lib/economics/calculate.ts`, `scripts/seed.ts`, `components/calculator/assumption-labels.ts`
- Modify (fixtures): `lib/economics/calculate.test.ts`, `lib/economics/normalize.test.ts`, `lib/economics/sensitivity.test.ts`, `lib/economics/recommend.test.ts`, `lib/scene/kpi.test.ts`

**Interfaces:**
- Produces: `AssumptionValues.energyCostFactor: number`; `baseEconomics` energy term scaled by it.

- [ ] **Step 1: Add the field to `AssumptionValues`** (`lib/economics/types.ts`) — after `usdToRub`:
```ts
  // #8a: regional energy-cost multiplier on each solution's energyUsdYear. Default 1.0 (no-op).
  energyCostFactor: number;
```

- [ ] **Step 2: Default it** in `lib/economics/assumptions.ts` `DEFAULT_ASSUMPTIONS` (after `usdToRub`):
```ts
  energyCostFactor: 1.0, // #8a (regional; 1.0 = no change)
```

- [ ] **Step 3: Scale the energy term** in `lib/economics/calculate.ts` `baseEconomics`. Replace:
```ts
  const opexAnnualUsd =
    quantity * (cap.maintenanceUsdYear + cap.energyUsdYear + cap.licensingUsdYear);
```
with:
```ts
  const opexAnnualUsd =
    quantity *
    (cap.maintenanceUsdYear + cap.energyUsdYear * a.energyCostFactor + cap.licensingUsdYear);
```

- [ ] **Step 4: Add fixture field + tests** in `lib/economics/calculate.test.ts`. First add
`energyCostFactor: 1.0` to the shared `a` fixture. Then append inside `describe("computeEconomics", …)`:
```ts
  it("energyCostFactor 1.0 is a no-op (parity with the pre-#8a numbers)", () => {
    const params: FacilityParams = { areaM2: 1000, opsPerDay: 400, staffCount: 10 };
    const r = computeEconomics(cap, params, a);
    if (!r.economical) throw new Error("expected economical");
    // opex = 1*(6000 + 1000 + 2000) = 9000, unchanged.
    expect(r.opexAnnualUsd).toBeCloseTo(9000, 6);
  });

  it("energyCostFactor scales ONLY the energy term of OPEX (#8a)", () => {
    const params: FacilityParams = { areaM2: 1000, opsPerDay: 400, staffCount: 10 };
    const base = computeEconomics(cap, params, a);
    const scaled = computeEconomics(cap, params, { ...a, energyCostFactor: 0.5 });
    if (!base.economical || !scaled.economical) throw new Error("expected economical");
    // energy 1000 → 500; opex drops by quantity(1)*500 = 500; savings rise by 500.
    expect(base.opexAnnualUsd - scaled.opexAnnualUsd).toBeCloseTo(500, 6);
    expect(scaled.annualSavingsUsd - base.annualSavingsUsd).toBeCloseTo(500, 6);
  });
```

- [ ] **Step 5: Add `energyCostFactor: 1.0` to the other fixtures** — in each of
`lib/economics/normalize.test.ts`, `lib/economics/sensitivity.test.ts`,
`lib/economics/recommend.test.ts`, `lib/scene/kpi.test.ts`, add `energyCostFactor: 1.0,` to the
`AssumptionValues` literal (next to `usdToRub: 90`). (These files each define one `a`/`A` fixture.)

- [ ] **Step 6: Seed the assumption** in `scripts/seed.ts` — in the `assumptions` array, after the
`usdToRub` row, add (bump `order`):
```ts
    { key: "energyCostFactor", label: "Множитель энергозатрат (регион)", value: 1.0, unit: "коэф.", order: 14 },
```

- [ ] **Step 7: Add the panel label** in `components/calculator/assumption-labels.ts` — in
`ASSUMPTION_LABELS` (after `usdToRub`):
```ts
  energyCostFactor: "Множитель энергозатрат (регион)",
```
and add `"energyCostFactor"` to the `RATIO_KEYS` set (finer 0.05 step — it's a ~0.7–1.1 multiplier).

- [ ] **Step 8: Re-seed + verify.** `npm run db:seed` (should report 14 assumptions). Then
`npx --yes vitest run < /dev/null` → **108 passed** (106 + 2 new) and `npm run build` exit 0.
The `queries.test.ts` assumptions test derives its expected keys from `DEFAULT_ASSUMPTIONS`, so it
auto-covers the new key; `validate.test.ts` likewise. Confirm both still pass.

- [ ] **Step 9: Commit**
```bash
git add lib/economics/types.ts lib/economics/assumptions.ts lib/economics/calculate.ts \
  lib/economics/calculate.test.ts lib/economics/normalize.test.ts lib/economics/sensitivity.test.ts \
  lib/economics/recommend.test.ts lib/scene/kpi.test.ts scripts/seed.ts \
  components/calculator/assumption-labels.ts
git commit -m "feat: energyCostFactor assumption (scales energy OPEX; default 1.0 no-op)"
```

---

### Task 2: Cited region presets (`regions.ts`) + integrity test

> **Controller/capable-model task — live web research, zero fabrication.** The type + test are
> fixed; the preset VALUES are the research deliverable, constrained by the test + protocol.

**Files:**
- Create: `lib/economics/regions.ts`, `lib/economics/regions.test.ts`

**Interfaces:**
- Produces: `type RegionPreset` and `export const REGION_PRESETS: RegionPreset[]`.

- [ ] **Step 1: Create `lib/economics/regions.ts`** with the fixed type + researched data:
```ts
export type RegionPreset = {
  id: string;                 // stable slug
  name: string;               // RU label
  laborCostPerHourUsd: number;
  energyCostFactor: number;   // multiplier on energyUsdYear; Москва = 1.0 reference
};

export const REGION_PRESETS: RegionPreset[] = [
  /* research deliverable — see protocol */
];
```
**Research protocol (fill `REGION_PRESETS`):**
1. Provide **~5 RF regions** incl. «Москва», «Санкт-Петербург», «РФ-среднее», and ≥1 lower-cost
   region (e.g. Приволжский/Уральский ФО).
2. `laborCostPerHourUsd`: from a cited RF **regional average wage** (Rosstat or a reputable
   aggregator) → monthly wage ÷ ~168 work-hours/month → ÷ a documented USD→RUB rate (~90). Record
   the source per region for Task 4's provenance.
3. `energyCostFactor`: relative to Москва (=1.0), from cited RF **industrial electricity tariff**
   variation by region; keep within [0.7, 1.1].
4. Keep values plausible and defensible, not vendor-optimistic; if a region's data can't be
   sourced, drop it and pick another. Do NOT invent a number.

- [ ] **Step 2: Write `lib/economics/regions.test.ts`**:
```ts
import { describe, it, expect } from "vitest";
import { REGION_PRESETS } from "./regions";

describe("REGION_PRESETS", () => {
  it("has ≥4 presets with unique ids", () => {
    expect(REGION_PRESETS.length).toBeGreaterThanOrEqual(4);
    const ids = REGION_PRESETS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it.each(REGION_PRESETS.map((r) => [r.name, r] as const))(
    "%s is well-formed",
    (_n, r) => {
      expect(r.id.trim().length).toBeGreaterThan(0);
      expect(r.name.trim().length).toBeGreaterThan(0);
      expect(r.laborCostPerHourUsd).toBeGreaterThan(0);
      expect(r.energyCostFactor).toBeGreaterThanOrEqual(0.5);
      expect(r.energyCostFactor).toBeLessThanOrEqual(1.5);
    }
  );
  it("includes a Москва reference at energy factor 1.0", () => {
    const msk = REGION_PRESETS.find((r) => r.id === "moscow");
    expect(msk).toBeDefined();
    expect(msk!.energyCostFactor).toBeCloseTo(1.0, 6);
  });
});
```

- [ ] **Step 3: Run — expect PASS** (fix the DATA, not the test, if it fails):
`npx --yes vitest run lib/economics/regions < /dev/null` → PASS.

- [ ] **Step 4: Build + full suite** — `npm run build` (exit 0), `npx --yes vitest run < /dev/null` (110: 108 + regions).

- [ ] **Step 5: Commit**
```bash
git add lib/economics/regions.ts lib/economics/regions.test.ts
git commit -m "feat: cited RF regional labor/energy presets (regions.ts)"
```

---

### Task 3: Region selector UI + provenance/CHANGELOG

**Files:**
- Create: `components/calculator/region-select.tsx`
- Modify: `components/calculator/params-form.tsx`, `components/economics-calculator.tsx`
- Modify: `docs/data-provenance.md`, `CHANGELOG.md`

**Interfaces:**
- Consumes: `REGION_PRESETS`, `formatCost`, the assumptions state setter.

- [ ] **Step 1: Create `components/calculator/region-select.tsx`**:
```tsx
"use client";

import { Label } from "@/components/ui/label";
import { REGION_PRESETS } from "@/lib/economics/regions";
import { formatCost } from "@/lib/format/currency";

export function RegionSelect({
  usdToRub,
  onPick,
}: {
  usdToRub: number;
  onPick: (laborCostPerHourUsd: number, energyCostFactor: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor="region">Регион (труд/энергия)</Label>
      <select
        id="region"
        defaultValue=""
        className="rounded-md border px-3 py-2 text-sm"
        onChange={(e) => {
          const r = REGION_PRESETS.find((x) => x.id === e.target.value);
          if (r) onPick(r.laborCostPerHourUsd, r.energyCostFactor);
        }}
      >
        <option value="">— свои значения —</option>
        {REGION_PRESETS.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name} — ~{formatCost(r.laborCostPerHourUsd, usdToRub)}/час
          </option>
        ))}
      </select>
      <p className="text-xs text-muted-foreground">
        Подставляет ставку труда и множитель энергозатрат; их можно изменить ниже.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Compose it in `ParamsForm`** (`components/calculator/params-form.tsx`). Add an
`onPickRegion` prop and render `<RegionSelect>` at the top of the card:
- Add to the props type: `onPickRegion: (labor: number, energyFactor: number) => void;` and
  `usdToRub: number;`
- Import `RegionSelect`.
- As the first child of the params `CardContent`, add:
```tsx
        <RegionSelect usdToRub={usdToRub} onPick={onPickRegion} />
```

- [ ] **Step 3: Wire the shell** (`components/economics-calculator.tsx`) — pass the new props to
`ParamsForm`:
```tsx
      <ParamsForm
        params={params}
        setParams={setParams}
        capacity={capacity}
        capacityUnit={primary.capacityUnit}
        usdToRub={assumptions.usdToRub}
        onPickRegion={(labor, energyFactor) =>
          setAssumptions((prev) => ({
            ...prev,
            laborCostPerHourUsd: labor,
            energyCostFactor: energyFactor,
          }))
        }
      />
```

- [ ] **Step 4: Build + full suite + E2E smoke.** `npm run build` (exit 0),
`npx --yes vitest run < /dev/null` (110). Then a logged-out smoke: dev server up, fetch a warehouse
calculate page and assert the selector renders:
```bash
node -e '(async()=>{const r=await fetch("http://localhost:3000/calculate/CID");const t=await r.text();
console.log("status",r.status,"| region select:",t.includes("Регион (труд/энергия)"),"| Москва:",t.includes("Москва"));})();' # replace CID with a real warehouse solution id
```
Expected: 200, both true. (Kill the dev server after.)

- [ ] **Step 5: Provenance + CHANGELOG.** In `docs/data-provenance.md`, add a **"Regional presets"**
section: per region → labor wage source + energy-tariff source + the USD→RUB rate used, with the
"verify before a live demo" caveat. In `CHANGELOG.md`, add an "Added" entry: opt-in regional
labor/energy presets; `energyCostFactor` assumption (default 1.0, no-op); picking a region sets
labor + energy factor; cited in data-provenance.

- [ ] **Step 6: Commit**
```bash
git add components/calculator/region-select.tsx components/calculator/params-form.tsx \
  components/economics-calculator.tsx docs/data-provenance.md CHANGELOG.md
git commit -m "feat: region selector (sets labor + energy factor) + provenance/CHANGELOG"
```

---

## Whole-feature review (after Task 3)
- [ ] `npm run build` (exit 0), `npx --yes vitest run < /dev/null` (110), `npm run test:e2e` (3 pass — default path unchanged).
- [ ] **Sign-off:** report the example number delta when «Москва» (etc.) is picked vs the $15 default, for the user's explicit approval before merge.
- [ ] `/code-review high` over `git diff master...HEAD`; fix findings.
- [ ] Merge to master with `--no-ff` only after review + user sign-off.
