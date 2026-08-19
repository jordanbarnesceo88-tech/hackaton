# Week 2 Design — Economics Engine + Step 3

> Status: approved via brainstorming 2026-08-18. Idea is fixed (see
> [00-idea-brief.md](../../00-idea-brief.md)); this specs the execution/design of Week 2.
> Builds on Week 1 (merged to master). Related: [PRD](../../01-prd.md),
> [execution plan §4 formulas + §8 tracked findings](../../02-execution-plan.md).

## Goal

Deliver Step 3 of the 4-step flow: the user picks a specific solution (product), enters
their facility parameters, and gets OPEX / CAPEX / payback / ROI, with every assumption
behind the numbers visible and editable. Backed by a pure, unit-tested economics engine
that correctly normalizes heterogeneous solution capacity units.

## Decisions locked in brainstorming

- **1a — Normalize to per-year throughput** (the C1 fix): a `capacityBasis` enum tags each
  solution; flow capacities annualize via operating-hours/days assumptions; stock-type uses
  a separate concurrency rule.
- **2a — Stateless:** engine + Step 3 only; no accounts/session/persistence this week
  (deferred to Week 4). Results computed on the fly; the chosen solution travels in the URL.
- **3a — Editable assumptions:** every assumption shows a default and is user-editable in
  Step 3, recomputing results live.
- **Per-product economics:** the brief says Step 3 selects a "тип решения," but concrete
  numbers need a specific product's price/capacity, so Step 3 computes per product (reached
  from a product card in Step 2). More concrete for the demo.

## 1. Schema additions (one migration)

- **`capacityBasis` enum on `Solution`:** `PER_HOUR_FLOW | PER_DAY_FLOW | CONCURRENT_STOCK`.
  Non-null; seed sets it per solution. Classification of the 14 seeded solutions:
  - `PER_HOUR_FLOW`: RoboPick A200, WareBot X1 (заказов/час); BagHandler B1, CargoMate C2
    (мест багажа/час); GenericAMR-Base (операций/час)
  - `PER_DAY_FLOW`: StackMax 3000, VertiStore S (паллет/день); MediCarry M1, PharmRunner P2
    (доставок/день); SaniBot UV-1, CleanWave C3 (помещений/день); GenericFixed-Base
    (операций/день)
  - `CONCURRENT_STOCK`: TugBot T500, RampRunner R1 (тележек одновременно)
- **`Assumption` model:**
  ```prisma
  model Assumption {
    id          String  @id @default(cuid())
    key         String  @unique   // e.g. "laborCostPerHourUsd"
    label       String             // Russian UI label
    value       Float
    unit        String?            // e.g. "USD/час", "%", "лет"
    description String?
    order       Int      @default(0) // display order in the UI
  }
  ```

Because the migration adds a non-null `capacityBasis` to a table that already has 14 rows,
the migration must supply it. Approach: add the column with a temporary default, backfill
via the re-run seed (idempotent upsert sets each solution's real basis), then the column
stays non-null. Simplest for a dev DB: add the enum, add the field with
`@default(PER_DAY_FLOW)` (a safe placeholder), and let the seed overwrite each row's real
value. Document the default is only a migration placeholder.

## 2. Economics engine — `lib/economics/`

Pure TypeScript, framework-independent, unit-tested, importable from both server and client
(so Step 3 can recompute live client-side with no round-trip). Files:

- `types.ts` — `FacilityParams`, `AssumptionValues`, `EconomicsResult`
- `normalize.ts` — capacity/demand annualization + `computeQuantity`
- `calculate.ts` — `computeEconomics(...)` orchestration
- `*.test.ts` — one test file per module

### Types

```ts
export type FacilityParams = {
  areaM2: number;          // площадь (captured; not all solutions use it — future)
  opsPerDay: number;       // объём операций в день (primary flow demand)
  staffCount: number;      // численность персонала (baseline labor)
  peakConcurrent?: number; // пиковая одновременная нагрузка (stock-type; optional)
};

export type AssumptionValues = {
  laborCostPerHourUsd: number;
  hoursPerYear: number;
  workingDaysPerYear: number;
  operatingHoursPerDay: number;
  installPctOfCapex: number;   // 0..1
  laborReplacementPct: number; // 0..1
  turnoverPerDay: number;      // stock demand derivation
  roiHorizonYears: number;
};

export type EconomicsResult =
  | {
      economical: true;
      quantity: number;
      capexUsd: number;
      opexAnnualUsd: number;
      baselineAnnualUsd: number;
      annualSavingsUsd: number;
      paybackYears: number;
      roiPct: number;
    }
  | {
      economical: false;
      quantity: number;
      capexUsd: number;
      opexAnnualUsd: number;
      baselineAnnualUsd: number;
      annualSavingsUsd: number; // ≤ 0
      reason: "no_savings";     // annual savings ≤ 0
    };
```

### Normalization (C1)

`computeQuantity(solution, params, a: AssumptionValues): number`

- **Flow** (`PER_HOUR_FLOW` / `PER_DAY_FLOW`):
  - `capacityPerYear = capacityPerUnit × (basis === PER_HOUR_FLOW ? a.operatingHoursPerDay : 1) × a.workingDaysPerYear`
  - `demandPerYear = params.opsPerDay × a.workingDaysPerYear`
  - `quantity = max(1, ceil(demandPerYear / capacityPerYear))`
- **Stock** (`CONCURRENT_STOCK`):
  - `peak = params.peakConcurrent ?? ceil(params.opsPerDay / a.turnoverPerDay)`
  - `quantity = max(1, ceil(peak / capacityPerUnit))`
- Guard: if `capacityPerUnit <= 0` → treat as invalid input (throw / typed error), never divide by zero.

`max(1, …)` guarantees ≥ 1 robot rendered (also helps Week 3's visualization).

### Formulas (`calculate.ts`)

```
baselineAnnualUsd = staffCount × laborCostPerHourUsd × hoursPerYear
quantity          = computeQuantity(...)                         // ceil, ≥1
capexUsd          = quantity × priceUsd × (1 + installPctOfCapex)
opexAnnualUsd     = quantity × (maintenanceUsdYear + energyUsdYear + licensingUsdYear)  // I1
annualSavingsUsd  = baselineAnnualUsd × laborReplacementPct − opexAnnualUsd             // I2
```

- **C2 guard:** if `annualSavingsUsd <= 0` → return `{ economical: false, reason: "no_savings", … }`.
  UI renders "Решение не окупается при текущих параметрах". No payback/ROI computed.
- else:
  ```
  paybackYears = capexUsd / annualSavingsUsd
  roiPct       = (annualSavingsUsd × roiHorizonYears − capexUsd) / capexUsd × 100
  ```
- **M2:** quantity uses `ceil` ✓; `hoursPerYear` is an assumption ✓; **discount rate dropped**
  (undiscounted MVP; NPV/discounted payback noted as a future enhancement — no dead config).

## 3. Assumptions (seeded defaults, all editable)

| key | label (ru) | default | unit |
|---|---|---|---|
| laborCostPerHourUsd | Стоимость труда (час) | 15 | USD/час |
| hoursPerYear | Рабочих часов в году (на сотрудника) | 2000 | часов |
| workingDaysPerYear | Рабочих дней в году | 250 | дней |
| operatingHoursPerDay | Часов работы объекта в сутки | 16 | часов |
| installPctOfCapex | Монтаж/интеграция (% от CAPEX) | 0.15 | доля |
| laborReplacementPct | Замещение труда роботами | 0.7 | доля |
| turnoverPerDay | Оборотов в сутки (для stock-решений) | 8 | раз |
| roiHorizonYears | Горизонт расчёта ROI | 5 | лет |

Defaults are placeholders to tune before a real client demo (tracked note in the UI/spec).

## 4. Step 3 UI — `/calculate/[solutionId]`

- **Entry:** Step 2 (`/compare/[type]`) gets a **"Рассчитать экономику"** button/link on each
  product card → `/calculate/[solutionId]`.
- **Server page** (`app/(app)/calculate/[solutionId]/page.tsx`): loads the solution (with its
  category + facility type) and the 8 assumptions; `notFound()` if the solution id is unknown.
  Passes them to a client component.
- **Client component** (`components/economics-calculator.tsx`): holds facility-params state and
  editable-assumptions state; calls the pure `computeEconomics` on every change (live, no
  round-trip). Renders:
  - a facility-params form (площадь, объём операций/день, численность персонала, and — shown
    only for `CONCURRENT_STOCK` solutions — пиковая одновременная нагрузка)
  - an editable assumptions panel (all 8, with labels/units)
  - a results panel: quantity, CAPEX, OPEX/год, годовая экономия, срок окупаемости, ROI —
    money via the existing `formatCost` (RUB+USD) — OR the "не окупается" state
- **Data-access:** add `getSolutionForCalc(id)` and `getAssumptions()` to `lib/db/queries.ts`.

## 5. Seed updates

- Add `capacityBasis` to all 14 solutions (per the classification in §1).
- Seed the 8 `Assumption` rows (idempotent upsert by `key`).

## Scope

- **In:** schema (`capacityBasis` + `Assumption`) + migration; economics engine + tests;
  `/calculate/[solutionId]` page + calculator client component; Step 2 "рассчитать" links;
  query helpers; seed updates.
- **Out:** auth / `Session` / persistence (Week 4); visualization (Week 3); real organizer
  data; discounted/NPV metrics; per-category (averaged) economics.

## Success criteria

- For each of the 3 verticals and "Other", picking a product → entering params → seeing
  coherent CAPEX/OPEX/payback/ROI, all in RUB+USD, with editable assumptions that recompute
  live.
- Editing an assumption (e.g. labor cost ↓) visibly changes the results.
- A small facility / low labor cost pushes a solution into the "не окупается" state instead
  of showing Infinity/NaN/negative payback (C2 verified).
- `CONCURRENT_STOCK` solutions (tugs) size sensibly by concurrency, not throughput.
- Engine unit tests cover: flow sizing (hour + day), stock sizing, savings≤0, quantity≥1,
  capacity=0 guard.

## Risks

- Assumption defaults are guesses → clearly labeled placeholder; editable so a demo can be
  tuned live. Real regional figures tracked as a pre-demo task.
- Demand model (single `opsPerDay`) is a simplification → acceptable for demo; the params
  form captures area/staff too for future refinement. Documented, not hidden.
