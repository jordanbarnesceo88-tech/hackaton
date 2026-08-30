# Design: Real, Sourced Solution Data (warehouse)

> Status: approved via brainstorming 2026-08-30. Sub-project #1 of the award-winning backlog
> (data credibility). Replaces the fake warehouse catalogue rows with a small set of **real**
> robotics products, specs cited from public sources, **prices shown as flagged estimate
> ranges** (industrial-robot list prices are not public). Delivers the "independent,
> non-vendor-biased" thesis for one showcase vertical. CAPEX-only; RaaS deferred to backlog #8.

## Goal & context

The platform's entire pitch is an independent, non-vendor-biased comparison. Today every
`Solution` row is `source: SEED` with a `Demo Robotics Co.` vendor — honestly badged (audit D1)
but hollow on the independence claim. This sub-project makes **warehouse** the real-data
showcase: ~3-4 real products with cited specs and defensible, clearly-labelled price *estimates*.

### Decisions locked in brainstorming (+ the spike that grounded them)

A feasibility spike (2026-08-30) confirmed: **specs are publicly citable** (e.g. AutoStore ~30
bins/hr·robot, 0.1 kW/hr; Locus Origin 36 kg / 12 h), but **prices are not** — the only price
data is third-party analyst *estimates* in prose (Kardex: AutoStore ≈ $3–6M/system; RaaS guides:
Locus ≈ $2–4k/robot·mo). Therefore:

- **Curated, not scraped.** A live scraper can't extract prices that aren't published, adds
  demo-fragility, and ingests vendors' optimistic best-case specs without judgment. Per
  execution-plan §3, parse-sources is offline/manual. We hand-curate with citations.
- **CAPEX-only.** Real products span CAPEX (AutoStore, a system purchase) and RaaS (Locus,
  subscription). RaaS needs an OpEx pricing path the engine lacks → **deferred to backlog #8**.
  We source only CAPEX-fit products for v1.
- **Prices as estimate ranges**, `priceEstimated` flagged, `priceBasis` cited; **the engine
  computes at the range midpoint** (existing `priceUsd`), never presenting a precise figure.
- **Replace** the fake warehouse rows (make warehouse the showcase); **leave airport/medical/
  other as clearly-badged SEED** pending organizer data.
- **Accuracy caveat:** researched figures are a *starting point*; a `docs/data-provenance.md`
  audit list lets the user/organizer verify each figure before a live demo.

## Schema (one Prisma migration)

Add to `Solution` (all backward-compatible; existing rows default cleanly):
```prisma
priceEstimated Boolean @default(false)  // true = priceUsd is a cited estimate, not a firm price
priceLowUsd    Float?                    // cited estimate range low
priceHighUsd   Float?                    // cited estimate range high
priceBasis     String?                  // short RU note: what the estimate is + its source kind
```
`priceUsd` remains the engine input (= midpoint of the range for estimated rows). `sourceUrl`,
`lastVerified`, `source` already exist. Run `npx prisma migrate dev` + `npx prisma generate`.

## Curated data module (offline, per PRD)

`scripts/parse-sources/warehouse-real.ts` — a typed array of real products, each fully cited:
```ts
export type CuratedSolution = {
  categorySlug: "amr" | "asrs";
  name: string;            // real product name
  vendor: string;          // real vendor
  capacityPerUnit: number; capacityUnit: string; capacityBasis: CapacityBasis;
  priceUsd: number;        // midpoint of [priceLowUsd, priceHighUsd]
  priceLowUsd: number; priceHighUsd: number; priceEstimated: true; priceBasis: string;
  maintenanceUsdYear: number; energyUsdYear: number; licensingUsdYear: number;
  specs: Record<string, number | string>;
  sourceUrl: string;       // the public citation
  lastVerified: string;    // ISO date the citation was checked
};
export const WAREHOUSE_REAL: CuratedSolution[];
```

### Candidate products (exact figures verified against a live citation at implementation)
- **`asrs`:** **AutoStore** (system unit; ~30 bins/hr·robot throughput, energy from cited 0.1 kW ×
  hours × RF tariff; price **$3–6M** est. [Kardex]); **Exotec Skypod** (system; throughput +
  price range cited).
- **`amr`:** **Geek+** goods-to-person AMR and **HAI Robotics HaiPick** (per-robot throughput +
  purchase-price estimate). *(Locus excluded — RaaS.)*

### Honest handling of each financial field
- **Price** → `priceLowUsd`/`High` from a cited third-party estimate; `priceUsd` = midpoint;
  `priceEstimated = true`; `priceBasis` e.g. `"оценка Kardex; системная цена, не офиц. прайс"`.
- **Energy** → cited power draw × operating hours × a cited RF electricity tariff (documented,
  not invented).
- **Maintenance / licensing** → documented rule-of-thumb (e.g. maintenance ≈ % of CAPEX/yr),
  noted as estimate in `priceBasis`/`specs`.
- **Specs** → only values readable off the cited `sourceUrl`.

If a citation turns out weak at implementation, swap the product — the *method* (cited specs +
flagged price estimate) is the invariant, not the exact SKU.

## Seed integration

`scripts/seed.ts`: the warehouse (`retail → warehouse`) `amr`/`asrs` categories draw their
`solutions` from `WAREHOUSE_REAL` (mapped to the seed shape, `source: PARSED`) instead of the
inline fake rows. Remove the fake `RoboPick/WareBot/StackMax/VertiStore` entries from `seedData`.
Because the seed is upsert-by-`(categoryId, name)`, add a **prune** step that deletes warehouse
solutions whose name isn't in the curated set, so a re-seed of an existing DB drops stale demo
rows. Other verticals unchanged.

## UI honesty markers

Estimated prices always render as a **range + "оценка" + citation**, never a precise figure.

- **Compare table** (`app/(app)/compare/[type]/page.tsx`): the "Цена" cell, when
  `priceEstimated`, shows `money(priceLowUsd)–money(priceHighUsd)` + a small `оценка` tag with
  `title={priceBasis}`. The existing PARSED provenance badge already links `sourceUrl`. The
  normalized "цена за 1000 ед./год" continues to use the midpoint. Add the new fields to the
  page's Prisma `select`.
- **Calculate page / shell** (`components/economics-calculator.tsx` header): for an
  estimated-price primary solution, a muted line under the vendor —
  `оценка цены: {money(low)}–{money(high)} · CAPEX по середине диапазона` (with the provenance
  link) — so CAPEX/NPV are grounded as midpoint-of-estimate.
- **Data threading:** add `priceEstimated`, `priceLowUsd`, `priceHighUsd`, `priceBasis`,
  `sourceUrl` to `getSiblingSolutions`' select and the `SiblingSolution` type
  (`lib/economics/recommend.ts`) so the shell header can show them.

## Edge cases
- **Migration safe:** existing SEED rows → `priceEstimated=false`, null range/basis; engine +
  `formatCost` unchanged; no number changes for existing rows.
- **Estimated but null range** → fall back to midpoint + "оценка" (defensive).
- **Range coherence** enforced by the data-integrity test (`low ≤ priceUsd ≤ high`).
- `getSiblingSolutions` returning estimated fields as `null` for SEED rows renders no marker —
  correct.

## Testing
- **`scripts/parse-sources/warehouse-real.test.ts`** (pure, highest-value new test): for every
  `WAREHOUSE_REAL` row assert non-empty `sourceUrl` + `lastVerified`, `priceEstimated === true`,
  `priceLowUsd ≤ priceUsd ≤ priceHighUsd`, non-empty `priceBasis`, `capacityPerUnit > 0`,
  `priceUsd > 0`, `categorySlug ∈ {amr, asrs}`, valid `capacityBasis`.
- **Existing 97 tests stay green** (no engine/format logic changes; only schema fields + data +
  presentational UI).
- **`getSiblingSolutions`/compare** render the new fields — covered by build typecheck + an
  end-to-end smoke fetch of `/compare/warehouse` (shows a real product + "оценка").
- UI is presentational → build + smoke, no component unit tests.

## Deliverables / docs
- `docs/data-provenance.md` — per-product, per-figure → source table, marked "verify before a
  live client demo" (the accuracy gate).
- CHANGELOG "Added" entry.

## Out of scope (later)
- RaaS / subscription pricing model (backlog #8); price-as-a-slider sensitivity; real data for
  airport/medical/other; the offline fetch+parse *script* (this is hand-curated data, per the
  approved decision).
