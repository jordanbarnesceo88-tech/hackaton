# Real Sourced Warehouse Data — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fake warehouse catalogue rows with ~3-4 real robotics products (`source: PARSED`) whose specs are cited and whose prices are shown as clearly-labelled estimate ranges, so the "independent, non-vendor-biased" pitch is real for the warehouse vertical.

**Architecture:** A backward-compatible schema migration adds estimate fields to `Solution`; a hand-curated, fully-cited data module feeds the seed for the warehouse `amr`/`asrs` categories; the compare table and calculate header surface prices as ranges + "оценка" + citation. The engine is unchanged — it computes at the range midpoint (`priceUsd`), exactly as today.

**Tech Stack:** Next.js 16 + React 19 + TypeScript, Prisma 7 (driver adapter, Postgres on host 5433), Vitest, Tailwind v4. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-30-real-sourced-data-design.md`

## Global Constraints

- **Never commit to `master`.** Work on branch `real-sourced-data` (already checked out).
- **Prisma 7:** DB via `docker compose up -d` (host **5433**). Schema change → `npx prisma migrate dev --name <n>` then `npx prisma generate`. Re-seed with `npm run db:seed`.
- **Run tests:** `npx --yes vitest run < /dev/null`. Verify build: `npm run build` (exit 0).
- **The existing 97 tests MUST stay green** after every task (no engine/economics/format logic changes — only schema fields, data, and presentational UI).
- **Do NOT change any economics OUTPUT number** for existing rows. Estimated prices feed `priceUsd` (midpoint) exactly like a normal price.
- **UI is Russian.** Money via `formatCost(usd, usdToRub)`.
- **Accuracy is non-negotiable (Task 2):** every real figure must trace to a live public citation. NEVER fabricate a spec or price. Flag every price as an estimate. Fabricated "real" data is worse than honest placeholders.

## File structure

- `prisma/schema.prisma` — MODIFY: add 4 fields to `Solution` (+ migration).
- `scripts/parse-sources/warehouse-real.ts` — CREATE: `CuratedSolution` type + `WAREHOUSE_REAL` data.
- `scripts/parse-sources/warehouse-real.test.ts` — CREATE: data-integrity test.
- `scripts/seed.ts` — MODIFY: feed warehouse categories from `WAREHOUSE_REAL`; remove fake rows; prune stale.
- `lib/economics/recommend.ts` — MODIFY: extend `SiblingSolution` with estimate fields.
- `lib/db/queries.ts` — MODIFY: `getSiblingSolutions` select adds estimate fields.
- `app/(app)/compare/[type]/page.tsx` — MODIFY: `SolutionRow` + price cell renders range + "оценка".
- `components/economics-calculator.tsx` — MODIFY: header shows the estimate note.
- `docs/data-provenance.md` — CREATE: per-figure → source audit list.
- `CHANGELOG.md` — MODIFY: "Added" entry.

---

### Task 1: Schema migration — estimate fields on `Solution`

**Files:**
- Modify: `prisma/schema.prisma`
- Migration: `prisma/migrations/*` (generated)

**Interfaces:**
- Produces: `Solution.priceEstimated: boolean`, `Solution.priceLowUsd: number | null`, `Solution.priceHighUsd: number | null`, `Solution.priceBasis: string | null`.

- [ ] **Step 1: Add the fields** to the `Solution` model in `prisma/schema.prisma`, right after the `priceUsd` line:

```prisma
  priceUsd           Float
  priceEstimated     Boolean          @default(false)
  priceLowUsd        Float?
  priceHighUsd       Float?
  priceBasis         String?
```

- [ ] **Step 2: Create + apply the migration** (DB must be up: `docker compose up -d`):

Run: `npx prisma migrate dev --name solution_price_estimate` then `npx prisma generate`
Expected: migration created + applied, client regenerated, no errors.

- [ ] **Step 3: Verify build + existing tests** (schema change is additive, nothing consumes the fields yet).

Run: `npm run build` (exit 0) and `npx --yes vitest run < /dev/null` (97 passed).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add estimated-price fields to Solution (schema + migration)"
```

---

### Task 2: Curated real-product data module + integrity test

> **Controller/capable-model task — requires live web research.** This is the one task that must
> NOT be handed to a cheap transcription model: it needs `WebSearch`/`WebFetch`, source judgment,
> and zero fabrication. The `CuratedSolution` type and the test below are complete and fixed; the
> **data values are the research deliverable**, constrained by the test + the research protocol.

**Files:**
- Create: `scripts/parse-sources/warehouse-real.ts`
- Test: `scripts/parse-sources/warehouse-real.test.ts`

**Interfaces:**
- Produces: `type CuratedSolution` and `export const WAREHOUSE_REAL: CuratedSolution[]` (used by the seed in Task 3).

- [ ] **Step 1: Create the module with the fixed type + researched data.**

Type (verbatim). **Use a RELATIVE import, not the `@/` alias** — this module is imported by
`scripts/seed.ts`, which runs under `tsx`, and `tsx` does not resolve tsconfig path aliases (the
seed would fail at runtime). Vitest resolves both, but relative keeps it runnable everywhere:
```ts
import type { CapacityBasis } from "../../lib/economics/types";

export type CuratedSolution = {
  categorySlug: "amr" | "asrs";
  name: string;            // real product name
  vendor: string;          // real vendor
  capacityPerUnit: number;
  capacityUnit: string;
  capacityBasis: CapacityBasis;
  priceUsd: number;        // MUST equal round((priceLowUsd + priceHighUsd) / 2)
  priceLowUsd: number;
  priceHighUsd: number;
  priceEstimated: true;
  priceBasis: string;      // short RU note: what the estimate is + its source kind
  maintenanceUsdYear: number;
  energyUsdYear: number;
  licensingUsdYear: number;
  specs: Record<string, number | string>;
  sourceUrl: string;       // the public citation
  lastVerified: string;    // ISO date the citation was checked, e.g. "2026-08-30"
};

export const WAREHOUSE_REAL: CuratedSolution[] = [
  /* research deliverable — see protocol below */
];
```

**Research protocol (how to fill `WAREHOUSE_REAL`):**
1. Source **3-4 real CAPEX-fit warehouse products** across `asrs` (≥1) and `amr` (≥1). Starting
   candidates: AutoStore, Exotec Skypod (`asrs`); Geek+, HAI Robotics HaiPick (`amr`). Exclude
   Locus (RaaS).
2. For **each** product, via `WebSearch`/`WebFetch`, record into the row ONLY what a live public
   page states, and set `sourceUrl` to that page + `lastVerified` to today:
   - `capacityPerUnit` + `capacityUnit` + `capacityBasis` — a per-unit throughput the page states
     (e.g. AutoStore ~30 bins/hr·robot → `30`, `"бинов/час"`, `PER_HOUR_FLOW`).
   - `priceLowUsd`/`priceHighUsd` — a cited third-party estimate range; `priceUsd` = rounded
     midpoint; `priceBasis` names the estimate + that it's not an official price (RU), e.g.
     `"оценка Kardex; системная цена, не офиц. прайс"`.
   - `energyUsdYear` — from a cited power draw × operating hours × a cited RF electricity tariff;
     put the inputs in `specs` (e.g. `powerKw`, `tariffRubKwh`).
   - `maintenanceUsdYear` / `licensingUsdYear` — a documented rule-of-thumb (e.g. maintenance ≈
     8% of `priceUsd`/yr); note the basis in `priceBasis` or `specs`.
   - `specs` — real cited figures (payload, battery, throughput, powerKw, etc.).
3. If a product's price cannot be estimated from ANY citable source, drop it and pick another —
   do not invent a number.
4. Keep a running note of each figure → its URL for Task 6's `docs/data-provenance.md`.

- [ ] **Step 2: Write the data-integrity test** (`warehouse-real.test.ts`):

```ts
import { describe, it, expect } from "vitest";
import { WAREHOUSE_REAL } from "./warehouse-real";

const BASES = ["PER_HOUR_FLOW", "PER_DAY_FLOW", "CONCURRENT_STOCK"];

describe("WAREHOUSE_REAL curated data", () => {
  it("has at least 3 products spanning both categories", () => {
    expect(WAREHOUSE_REAL.length).toBeGreaterThanOrEqual(3);
    const slugs = new Set(WAREHOUSE_REAL.map((s) => s.categorySlug));
    expect(slugs.has("amr")).toBe(true);
    expect(slugs.has("asrs")).toBe(true);
  });

  it.each(WAREHOUSE_REAL.map((s) => [s.name, s] as const))(
    "%s is well-formed, cited, and price-estimated",
    (_name, s) => {
      expect(["amr", "asrs"]).toContain(s.categorySlug);
      expect(BASES).toContain(s.capacityBasis);
      expect(s.name.trim().length).toBeGreaterThan(0);
      expect(s.vendor.trim().length).toBeGreaterThan(0);
      expect(s.capacityPerUnit).toBeGreaterThan(0);
      expect(s.priceEstimated).toBe(true);
      expect(s.priceLowUsd).toBeGreaterThan(0);
      expect(s.priceHighUsd).toBeGreaterThanOrEqual(s.priceLowUsd);
      expect(s.priceUsd).toBeGreaterThanOrEqual(s.priceLowUsd);
      expect(s.priceUsd).toBeLessThanOrEqual(s.priceHighUsd);
      // priceUsd is the rounded midpoint
      expect(s.priceUsd).toBe(Math.round((s.priceLowUsd + s.priceHighUsd) / 2));
      expect(s.priceBasis.trim().length).toBeGreaterThan(0);
      expect(s.maintenanceUsdYear).toBeGreaterThanOrEqual(0);
      expect(s.energyUsdYear).toBeGreaterThanOrEqual(0);
      expect(s.licensingUsdYear).toBeGreaterThanOrEqual(0);
      expect(/^https?:\/\//.test(s.sourceUrl)).toBe(true);
      expect(/^\d{4}-\d{2}-\d{2}$/.test(s.lastVerified)).toBe(true);
    }
  );
});
```

- [ ] **Step 3: Run — expect PASS** (fails first if data is missing/ill-formed; fix the data, not the test).

Run: `npx --yes vitest run scripts/parse-sources/warehouse-real < /dev/null`
Expected: PASS for every curated row.

- [ ] **Step 4: Verify build** (`npm run build`, exit 0).

- [ ] **Step 5: Commit**

```bash
git add scripts/parse-sources/warehouse-real.ts scripts/parse-sources/warehouse-real.test.ts
git commit -m "feat: curated real warehouse products (cited specs, estimated prices)"
```

---

### Task 3: Seed integration — real warehouse data + prune

**Files:**
- Modify: `scripts/seed.ts`

**Interfaces:**
- Consumes: `WAREHOUSE_REAL` (Task 2).

- [ ] **Step 1: Import the curated data** at the top of `seed.ts`:

```ts
import { WAREHOUSE_REAL } from "./parse-sources/warehouse-real";
```

- [ ] **Step 2: Remove the fake warehouse solutions** from the inline `seedData` — in the
`retail → warehouse` facility type, set the `amr` and `asrs` categories' `solutions: []`
(keep the categories themselves; their solutions now come from `WAREHOUSE_REAL`). Leave
airport/medical/other untouched.

- [ ] **Step 3: Upsert the curated products** after the category is upserted. Inside `main()`,
after the existing category/solution upsert loops complete, add a block that inserts each
`WAREHOUSE_REAL` row into its category as `source: PARSED`. Look up the category id by
`(warehouse facilityTypeId, categorySlug)`:

```ts
  // Real, cited warehouse products (source: PARSED) — replaces the demo warehouse rows.
  const warehouse = await prisma.facilityType.findUnique({ where: { slug: "warehouse" } });
  if (warehouse) {
    for (const s of WAREHOUSE_REAL) {
      const category = await prisma.solutionCategory.findUnique({
        where: { facilityTypeId_slug: { facilityTypeId: warehouse.id, slug: s.categorySlug } },
      });
      if (!category) continue;
      const data = {
        vendor: s.vendor, priceUsd: s.priceUsd, priceEstimated: s.priceEstimated,
        priceLowUsd: s.priceLowUsd, priceHighUsd: s.priceHighUsd, priceBasis: s.priceBasis,
        capacityPerUnit: s.capacityPerUnit, capacityUnit: s.capacityUnit,
        capacityBasis: s.capacityBasis, maintenanceUsdYear: s.maintenanceUsdYear,
        energyUsdYear: s.energyUsdYear, licensingUsdYear: s.licensingUsdYear,
        specs: s.specs, source: SolutionSource.PARSED,
        sourceUrl: s.sourceUrl, lastVerified: new Date(s.lastVerified),
      };
      await prisma.solution.upsert({
        where: { solutionCategoryId_name: { solutionCategoryId: category.id, name: s.name } },
        update: data,
        create: { name: s.name, solutionCategoryId: category.id, ...data },
      });
      solutionCount++;
    }

    // Prune stale demo rows: delete warehouse solutions not in the curated set.
    const keep = WAREHOUSE_REAL.map((s) => s.name);
    await prisma.solution.deleteMany({
      where: {
        solutionCategory: { facilityType: { slug: "warehouse" } },
        name: { notIn: keep },
      },
    });
  }
```

- [ ] **Step 4: Re-seed and verify the data.**

Run: `npm run db:seed`
Expected: completes; warehouse now holds only the curated real products.

Verify with a quick query:
```bash
node -e '
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
require("dotenv").config();
(async () => {
  const p = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const rows = await p.solution.findMany({
    where: { solutionCategory: { facilityType: { slug: "warehouse" } } },
    select: { name: true, source: true, priceEstimated: true, sourceUrl: true },
  });
  console.log(JSON.stringify(rows, null, 2));
  await p.$disconnect();
})();'
```
Expected: only curated names, all `source: "PARSED"`, `priceEstimated: true`, non-null `sourceUrl`.

- [ ] **Step 5: Run the full suite** (the DB-integration tests read the re-seeded data).

Run: `npx --yes vitest run < /dev/null`
Expected: 97 + Task-2 data test still green. (The `getSiblingSolutions`/`getCatalogForFacilityType` tests assert structure, not fake names, so they survive the data swap.)

- [ ] **Step 6: Commit**

```bash
git add scripts/seed.ts
git commit -m "feat: seed real warehouse products (PARSED) + prune stale demo rows"
```

---

### Task 4: Compare-table UI — price range + "оценка"

**Files:**
- Modify: `app/(app)/compare/[type]/page.tsx`

**Interfaces:**
- Consumes: the new `Solution` fields (Task 1) via the page's Prisma include/select.

- [ ] **Step 1: Add the estimate fields to `SolutionRow`** (the local type in the page):

```ts
  priceEstimated: boolean;
  priceLowUsd: number | null;
  priceHighUsd: number | null;
  priceBasis: string | null;
```
(The page reads solutions via `getCatalogForFacilityType`, which uses `include: { solutions: true }` — no select to change; all scalar fields including the new ones are already returned. Confirm by reading `lib/db/queries.ts::getCatalogForFacilityType`.)

- [ ] **Step 2: Render the price cell as a range when estimated.** Replace the existing price
`<Td>` in the table body:

```tsx
                      <Td className="text-right whitespace-nowrap">
                        {s.priceEstimated && s.priceLowUsd != null && s.priceHighUsd != null ? (
                          <span title={s.priceBasis ?? undefined}>
                            {money(s.priceLowUsd)}–{money(s.priceHighUsd)}{" "}
                            <sup className="text-[10px] text-amber-700">оценка</sup>
                          </span>
                        ) : (
                          money(s.priceUsd)
                        )}
                      </Td>
```

- [ ] **Step 3: Verify build + smoke.** (`npm run build` exit 0.) With DB up + dev server:

```bash
node -e '(async()=>{const r=await fetch("http://localhost:3000/compare/warehouse");const t=await r.text();
console.log("status",r.status,"| оценка:",t.includes("оценка"),"| открытый источник:",t.includes("открытый источник"));})();'
```
Expected: status 200; `оценка: true`; provenance link present (real rows are PARSED).

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/compare/[type]/page.tsx"
git commit -m "feat: show estimated price ranges + оценка marker in the comparison table"
```

---

### Task 5: SiblingSolution + calculate-header estimate note

> Combined (like the prior plan's shell+page task) because the `SiblingSolution`/query change and
> its only consumer (the header) must land together to build.

**Files:**
- Modify: `lib/economics/recommend.ts` (`SiblingSolution` type)
- Modify: `lib/db/queries.ts` (`getSiblingSolutions` select)
- Modify: `components/economics-calculator.tsx` (header note)

**Interfaces:**
- Produces: `SiblingSolution` gains `priceEstimated: boolean; priceLowUsd: number | null; priceHighUsd: number | null; priceBasis: string | null; sourceUrl: string | null`.

- [ ] **Step 1: Extend `SiblingSolution`** in `lib/economics/recommend.ts`:

```ts
export type SiblingSolution = SolutionCapacity & {
  id: string;
  name: string;
  vendor: string;
  capacityUnit: string;
  priceEstimated: boolean;
  priceLowUsd: number | null;
  priceHighUsd: number | null;
  priceBasis: string | null;
  sourceUrl: string | null;
};
```

- [ ] **Step 2: Add the fields to `getSiblingSolutions`'s select** in `lib/db/queries.ts`:

```ts
    select: {
      id: true, name: true, vendor: true, priceUsd: true, capacityPerUnit: true,
      capacityUnit: true, capacityBasis: true, maintenanceUsdYear: true,
      energyUsdYear: true, licensingUsdYear: true,
      priceEstimated: true, priceLowUsd: true, priceHighUsd: true,
      priceBasis: true, sourceUrl: true,
    },
```

- [ ] **Step 3: Show the estimate note in the shell header** (`components/economics-calculator.tsx`).
Inside the header `<div>`, after the vendor `<p>`, add (using the already-available `primary` and
`formatCost`; import `formatCost` if not present):

```tsx
        {primary.priceEstimated && primary.priceLowUsd != null && primary.priceHighUsd != null && (
          <p className="text-xs text-amber-700">
            оценка цены: {formatCost(primary.priceLowUsd, assumptions.usdToRub)}–
            {formatCost(primary.priceHighUsd, assumptions.usdToRub)} · CAPEX по середине диапазона
            {primary.sourceUrl ? (
              <>
                {" "}
                <a href={primary.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">
                  источник ↗
                </a>
              </>
            ) : null}
          </p>
        )}
```
(Confirm `formatCost` is imported in the shell; if not, add `import { formatCost } from "@/lib/format/currency";`.)

- [ ] **Step 4: Verify build + full suite.**

Run: `npm run build` (exit 0) and `npx --yes vitest run < /dev/null` (all green).

- [ ] **Step 5: Smoke test** (DB up + dev server). Fetch a real warehouse solution's calculate
page and confirm the estimate note renders (get an id from the compare page or a Prisma query):

```bash
node -e '(async()=>{const id=process.argv[1];const r=await fetch("http://localhost:3000/calculate/"+id);const t=await r.text();
console.log("status",r.status,"| оценка цены:",t.includes("оценка цены"),"| источник:",t.includes("источник"));})();' "<real-warehouse-solution-id>"
```
Expected: status 200; `оценка цены: true`.

- [ ] **Step 6: Commit**

```bash
git add lib/economics/recommend.ts lib/db/queries.ts components/economics-calculator.tsx
git commit -m "feat: surface estimated-price note on the calculate page header"
```

---

### Task 6: Provenance doc + CHANGELOG

**Files:**
- Create: `docs/data-provenance.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Write `docs/data-provenance.md`** — a table per curated product listing each
figure (capacity, price range, energy basis, maintenance basis, key specs) → its `sourceUrl`,
with a header stating: "Researched starting point — **verify every figure before a live client
demo**; specs/prices drift and datasheets list optimistic best-case numbers." Populate from the
Task-2 research notes (one row per figure per product).

- [ ] **Step 2: Add a CHANGELOG "Added" entry** under `## [Unreleased]` describing: real,
cited warehouse products replacing the demo rows; prices as flagged estimate ranges (engine at
midpoint); provenance surfaced in compare + calculate; `docs/data-provenance.md` as the accuracy
gate.

- [ ] **Step 3: Commit**

```bash
git add docs/data-provenance.md CHANGELOG.md
git commit -m "docs: data-provenance accuracy gate + CHANGELOG for real warehouse data"
```

---

## Whole-feature review (after Task 6)

- [ ] `npm run build` (exit 0) + `npx --yes vitest run < /dev/null` (all green).
- [ ] `/code-review high` over `git diff master...HEAD`; fix findings.
- [ ] **Manual accuracy spot-check:** open each `sourceUrl` in `docs/data-provenance.md` and
  confirm the cited spec/price-estimate still matches — this is the one thing tests cannot verify.
- [ ] Merge to master with `--no-ff` only after review + user sign-off.
