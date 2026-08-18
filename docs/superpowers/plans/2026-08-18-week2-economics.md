# Week 2 Economics Engine + Step 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Step 3 of the flow — pick a product, enter facility parameters, get
OPEX/CAPEX/payback/ROI with visible, editable assumptions — backed by a pure, unit-tested
economics engine that normalizes heterogeneous capacity units.

**Architecture:** A pure TS engine in `lib/economics/` (no framework deps, importable
server- and client-side) does all math. Prisma gains a `capacityBasis` enum on `Solution`
and an `Assumption` model. Step 3 is a server page that loads the solution + assumptions and
hands them to a client component that recomputes results live via the pure engine. Stateless
— the chosen solution travels in the URL; nothing is persisted.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind v4, shadcn/ui,
Prisma 7 (Postgres driver adapter), Vitest.

**Spec:** `docs/superpowers/specs/2026-08-18-week2-economics-design.md`

## Global Constraints

- All commands run from repo root `~/robotization-roi-platform`, on branch `week2-economics`.
- **Prisma 7 realities (do NOT revert):** Postgres on host port **5433** (`.env` is source
  of truth); datasource URL lives in `prisma.config.ts` (schema has no inline `url`); runtime
  code uses the driver adapter `new PrismaClient({ adapter: new PrismaPg({ connectionString:
  process.env.DATABASE_URL }) })`; run `npx prisma generate` after any schema change before
  code/tests use the client. DB must be up (`docker compose up -d`) and seeded for
  integration tests.
- **UI language is Russian.** All new UI copy and assumption labels in Russian; vendor/product
  brand names stay Latin. Money is displayed via the existing `formatCost` from
  `@/lib/format/currency` (RUB primary + USD in parens) — never raw numbers.
- **Stateless (2a):** NO `User`/`Session`/auth/persistence (Week 4). NO visualization (Week 3).
  The chosen solution id travels in the URL.
- **Engine purity:** everything in `lib/economics/` is pure TypeScript — no imports of Prisma,
  Next, React, or `process.env`. It takes plain data in and returns plain data. This is what
  lets the client component recompute live.
- **capacityBasis enum values (exact):** `PER_HOUR_FLOW`, `PER_DAY_FLOW`, `CONCURRENT_STOCK`.
- **The 8 assumption keys (exact camelCase):** `laborCostPerHourUsd`, `hoursPerYear`,
  `workingDaysPerYear`, `operatingHoursPerDay`, `installPctOfCapex`, `laborReplacementPct`,
  `turnoverPerDay`, `roiHorizonYears`.
- Vitest config is `vitest.config.mts` (has `setupFiles: ["dotenv/config"]`); run tests with
  `npx --yes vitest run < /dev/null` (never watch mode). Prefix npx with `--yes`; never spawn
  a Monitor or leave a dev server/watcher running.

---

### Task 1: Schema — `capacityBasis` enum + `Assumption` model + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create (generated): `prisma/migrations/<timestamp>_economics/migration.sql`

**Interfaces:**
- Consumes: existing schema (Week 1).
- Produces: enum `CapacityBasis { PER_HOUR_FLOW PER_DAY_FLOW CONCURRENT_STOCK }`; new field
  `Solution.capacityBasis CapacityBasis @default(PER_DAY_FLOW)`; model `Assumption { id, key
  @unique, label, value Float, unit String?, description String?, order Int @default(0) }`.
  The generated Prisma client exposes `prisma.assumption` and `CapacityBasis`.

- [ ] **Step 1: Add the enum + field + model to `prisma/schema.prisma`**

Add the enum near the existing `SolutionSource` enum:
```prisma
enum CapacityBasis {
  PER_HOUR_FLOW
  PER_DAY_FLOW
  CONCURRENT_STOCK
}
```
Add this field inside `model Solution { … }` (after `capacityUnit`):
```prisma
  capacityBasis      CapacityBasis    @default(PER_DAY_FLOW)
```
(The `@default` is a migration placeholder for the 14 existing rows; the seed in Task 3
overwrites each row's real basis. New solutions should always set it explicitly.)

Add a new model at the end of the file:
```prisma
model Assumption {
  id          String  @id @default(cuid())
  key         String  @unique
  label       String
  value       Float
  unit        String?
  description String?
  order       Int     @default(0)
}
```

- [ ] **Step 2: Ensure DB is up, then create the migration**

```bash
docker compose up -d
until docker compose exec -T db pg_isready -U rrp > /dev/null 2>&1; do sleep 1; done
npx --yes prisma migrate dev --name economics < /dev/null
```
Expected: exit 0, "Your database is now in sync with your schema." A new folder appears under
`prisma/migrations/`.

- [ ] **Step 3: Validate + regenerate client**

```bash
npx --yes prisma validate
npx --yes prisma generate
```
Expected: "The schema at prisma/schema.prisma is valid" and "Generated Prisma Client".

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "Add capacityBasis enum + Assumption model (economics schema)"
```

---

### Task 2: Economics engine — types + normalization (`lib/economics/`)

**Files:**
- Create: `lib/economics/types.ts`
- Create: `lib/economics/normalize.ts`
- Create: `lib/economics/normalize.test.ts`

**Interfaces:**
- Consumes: nothing (pure). Uses a local `SolutionCapacity` shape (defined here) so the engine
  never imports Prisma types.
- Produces:
  - `types.ts`: `FacilityParams`, `AssumptionValues`, `SolutionCapacity`, `EconomicsResult`
    (exact shapes below).
  - `normalize.ts`: `computeQuantity(cap: SolutionCapacity, params: FacilityParams, a:
    AssumptionValues): number` — returns an integer ≥ 1.

- [ ] **Step 1: Create `lib/economics/types.ts`**

```ts
export type CapacityBasis = "PER_HOUR_FLOW" | "PER_DAY_FLOW" | "CONCURRENT_STOCK";

export type SolutionCapacity = {
  capacityPerUnit: number;
  capacityBasis: CapacityBasis;
  priceUsd: number;
  maintenanceUsdYear: number;
  energyUsdYear: number;
  licensingUsdYear: number;
};

export type FacilityParams = {
  areaM2: number;
  opsPerDay: number;
  staffCount: number;
  peakConcurrent?: number;
};

export type AssumptionValues = {
  laborCostPerHourUsd: number;
  hoursPerYear: number;
  workingDaysPerYear: number;
  operatingHoursPerDay: number;
  installPctOfCapex: number;
  laborReplacementPct: number;
  turnoverPerDay: number;
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
      reason: "no_savings";
      quantity: number;
      capexUsd: number;
      opexAnnualUsd: number;
      baselineAnnualUsd: number;
      annualSavingsUsd: number;
    };
```

- [ ] **Step 2: Write the failing tests — `lib/economics/normalize.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { computeQuantity } from "./normalize";
import type { SolutionCapacity, FacilityParams, AssumptionValues } from "./types";

const a: AssumptionValues = {
  laborCostPerHourUsd: 15,
  hoursPerYear: 2000,
  workingDaysPerYear: 250,
  operatingHoursPerDay: 16,
  installPctOfCapex: 0.15,
  laborReplacementPct: 0.7,
  turnoverPerDay: 8,
  roiHorizonYears: 5,
};
const params: FacilityParams = { areaM2: 1000, opsPerDay: 1600, staffCount: 10 };
const base = { priceUsd: 1, maintenanceUsdYear: 0, energyUsdYear: 0, licensingUsdYear: 0 };

describe("computeQuantity", () => {
  it("sizes a PER_HOUR_FLOW solution by annualized throughput", () => {
    // cap/yr = 50 * 16 * 250 = 200000; demand/yr = 1600 * 250 = 400000; ceil(2) = 2
    const cap: SolutionCapacity = { ...base, capacityPerUnit: 50, capacityBasis: "PER_HOUR_FLOW" };
    expect(computeQuantity(cap, params, a)).toBe(2);
  });

  it("sizes a PER_DAY_FLOW solution by annualized throughput", () => {
    // cap/yr = 400 * 250 = 100000; demand/yr = 400000; ceil(4) = 4
    const cap: SolutionCapacity = { ...base, capacityPerUnit: 400, capacityBasis: "PER_DAY_FLOW" };
    expect(computeQuantity(cap, params, a)).toBe(4);
  });

  it("sizes a CONCURRENT_STOCK solution from an explicit peak", () => {
    // peak 30 / capacityPerUnit 12 = ceil(2.5) = 3
    const cap: SolutionCapacity = { ...base, capacityPerUnit: 12, capacityBasis: "CONCURRENT_STOCK" };
    expect(computeQuantity(cap, { ...params, peakConcurrent: 30 }, a)).toBe(3);
  });

  it("derives stock peak from opsPerDay/turnoverPerDay when peakConcurrent is absent", () => {
    // peak = ceil(1600/8)=200; 200/12 = ceil(16.67) = 17
    const cap: SolutionCapacity = { ...base, capacityPerUnit: 12, capacityBasis: "CONCURRENT_STOCK" };
    expect(computeQuantity(cap, params, a)).toBe(17);
  });

  it("never returns less than 1", () => {
    const cap: SolutionCapacity = { ...base, capacityPerUnit: 999999, capacityBasis: "PER_DAY_FLOW" };
    expect(computeQuantity(cap, { ...params, opsPerDay: 1 }, a)).toBe(1);
  });

  it("throws on non-positive capacity (no divide-by-zero)", () => {
    const cap: SolutionCapacity = { ...base, capacityPerUnit: 0, capacityBasis: "PER_DAY_FLOW" };
    expect(() => computeQuantity(cap, params, a)).toThrow();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx --yes vitest run lib/economics/normalize.test.ts < /dev/null`
Expected: FAIL — `./normalize` has no `computeQuantity` (module/function not found).

- [ ] **Step 4: Implement `lib/economics/normalize.ts`**

```ts
import type { SolutionCapacity, FacilityParams, AssumptionValues } from "./types";

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

  const hoursFactor =
    cap.capacityBasis === "PER_HOUR_FLOW" ? a.operatingHoursPerDay : 1;
  const capacityPerYear = cap.capacityPerUnit * hoursFactor * a.workingDaysPerYear;
  const demandPerYear = params.opsPerDay * a.workingDaysPerYear;
  return Math.max(1, Math.ceil(demandPerYear / capacityPerYear));
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx --yes vitest run lib/economics/normalize.test.ts < /dev/null`
Expected: PASS — 6 tests.

- [ ] **Step 6: Commit**

```bash
git add lib/economics/types.ts lib/economics/normalize.ts lib/economics/normalize.test.ts
git commit -m "Add economics engine types + capacity normalization (C1)"
```

---

### Task 3: Economics engine — `computeEconomics` + §8 fixes

**Files:**
- Create: `lib/economics/calculate.ts`
- Create: `lib/economics/calculate.test.ts`

**Interfaces:**
- Consumes: `computeQuantity` (Task 2), the types (Task 2).
- Produces: `computeEconomics(cap: SolutionCapacity, params: FacilityParams, a:
  AssumptionValues): EconomicsResult`.

- [ ] **Step 1: Write the failing tests — `lib/economics/calculate.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { computeEconomics } from "./calculate";
import type { SolutionCapacity, FacilityParams, AssumptionValues } from "./types";

const a: AssumptionValues = {
  laborCostPerHourUsd: 15,
  hoursPerYear: 2000,
  workingDaysPerYear: 250,
  operatingHoursPerDay: 16,
  installPctOfCapex: 0.15,
  laborReplacementPct: 0.7,
  turnoverPerDay: 8,
  roiHorizonYears: 5,
};

// PER_DAY_FLOW, cap 400/day. opsPerDay 400 -> qty = ceil((400*250)/(400*250)) = 1.
const cap: SolutionCapacity = {
  capacityPerUnit: 400,
  capacityBasis: "PER_DAY_FLOW",
  priceUsd: 50000,
  maintenanceUsdYear: 6000,
  energyUsdYear: 1000,
  licensingUsdYear: 2000,
};

describe("computeEconomics", () => {
  it("computes an economical result with all fields", () => {
    // staff 10 -> baseline = 10*15*2000 = 300000
    // qty 1 -> capex = 1*50000*1.15 = 57500; opex = 1*(6000+1000+2000)=9000
    // savings = 300000*0.7 - 9000 = 210000 - 9000 = 201000
    // payback = 57500/201000 ≈ 0.286; roi = (201000*5 - 57500)/57500*100 ≈ 1647.8
    const params: FacilityParams = { areaM2: 1000, opsPerDay: 400, staffCount: 10 };
    const r = computeEconomics(cap, params, a);
    expect(r.economical).toBe(true);
    if (!r.economical) return;
    expect(r.quantity).toBe(1);
    expect(r.capexUsd).toBeCloseTo(57500, 2);
    expect(r.opexAnnualUsd).toBeCloseTo(9000, 2);
    expect(r.baselineAnnualUsd).toBeCloseTo(300000, 2);
    expect(r.annualSavingsUsd).toBeCloseTo(201000, 2);
    expect(r.paybackYears).toBeCloseTo(57500 / 201000, 4);
    expect(r.roiPct).toBeCloseTo(((201000 * 5 - 57500) / 57500) * 100, 2);
  });

  it("scales OPEX by quantity (I1)", () => {
    // opsPerDay 1600 -> qty = ceil((1600*250)/(400*250)) = 4; opex = 4*9000 = 36000
    const params: FacilityParams = { areaM2: 1000, opsPerDay: 1600, staffCount: 50 };
    const r = computeEconomics(cap, params, a);
    if (!r.economical) throw new Error("expected economical");
    expect(r.quantity).toBe(4);
    expect(r.opexAnnualUsd).toBeCloseTo(36000, 2);
  });

  it("returns not-economical when savings <= 0 (C2), no payback/roi", () => {
    // tiny staff (1) -> baseline 30000; savings = 30000*0.7 - 9000 = 21000-9000=12000 >0
    // push OPEX up via many robots: opsPerDay 4000 -> qty=10 -> opex=90000; savings=21000-90000<0
    const params: FacilityParams = { areaM2: 1000, opsPerDay: 4000, staffCount: 1 };
    const r = computeEconomics(cap, params, a);
    expect(r.economical).toBe(false);
    if (r.economical) return;
    expect(r.reason).toBe("no_savings");
    expect(r.annualSavingsUsd).toBeLessThanOrEqual(0);
    expect(r).not.toHaveProperty("paybackYears");
  });

  it("applies labor-replacement pct < 100 (I2)", () => {
    // baseline 300000, replacement 0.5 -> labor saved 150000; opex 9000; savings 141000
    const params: FacilityParams = { areaM2: 1000, opsPerDay: 400, staffCount: 10 };
    const r = computeEconomics(cap, params, { ...a, laborReplacementPct: 0.5 });
    if (!r.economical) throw new Error("expected economical");
    expect(r.annualSavingsUsd).toBeCloseTo(150000 - 9000, 2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx --yes vitest run lib/economics/calculate.test.ts < /dev/null`
Expected: FAIL — `./calculate` has no `computeEconomics`.

- [ ] **Step 3: Implement `lib/economics/calculate.ts`**

```ts
import type {
  SolutionCapacity,
  FacilityParams,
  AssumptionValues,
  EconomicsResult,
} from "./types";
import { computeQuantity } from "./normalize";

export function computeEconomics(
  cap: SolutionCapacity,
  params: FacilityParams,
  a: AssumptionValues
): EconomicsResult {
  const quantity = computeQuantity(cap, params, a);

  const baselineAnnualUsd =
    params.staffCount * a.laborCostPerHourUsd * a.hoursPerYear;
  const capexUsd = quantity * cap.priceUsd * (1 + a.installPctOfCapex);
  const opexAnnualUsd =
    quantity *
    (cap.maintenanceUsdYear + cap.energyUsdYear + cap.licensingUsdYear); // I1
  const annualSavingsUsd =
    baselineAnnualUsd * a.laborReplacementPct - opexAnnualUsd; // I2

  const common = {
    quantity,
    capexUsd,
    opexAnnualUsd,
    baselineAnnualUsd,
    annualSavingsUsd,
  };

  if (annualSavingsUsd <= 0) {
    return { economical: false, reason: "no_savings", ...common }; // C2
  }

  const paybackYears = capexUsd / annualSavingsUsd;
  const roiPct =
    ((annualSavingsUsd * a.roiHorizonYears - capexUsd) / capexUsd) * 100;

  return { economical: true, ...common, paybackYears, roiPct };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx --yes vitest run lib/economics/calculate.test.ts < /dev/null`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/economics/calculate.ts lib/economics/calculate.test.ts
git commit -m "Add computeEconomics with C2/I1/I2/M2 fixes"
```

---

### Task 4: Seed — `capacityBasis` on 14 solutions + 8 `Assumption` rows

**Files:**
- Modify: `scripts/seed.ts`

**Interfaces:**
- Consumes: schema from Task 1 (`CapacityBasis`, `prisma.assumption`).
- Produces: every seeded solution has a real `capacityBasis`; 8 `Assumption` rows exist.

- [ ] **Step 1: Add `capacityBasis` to the seed's solution type + every entry**

In `scripts/seed.ts`, extend the `SolutionSeed` type with `capacityBasis: CapacityBasis`
(import `CapacityBasis` from `@prisma/client`), and add the field to all 14 solution objects
using this mapping (by capacityUnit):
- `заказов/час`, `мест багажа/час`, `операций/час` → `"PER_HOUR_FLOW"`
  (RoboPick A200, WareBot X1, BagHandler B1, CargoMate C2, GenericAMR-Base)
- `паллет/день`, `доставок/день`, `помещений/день`, `операций/день` → `"PER_DAY_FLOW"`
  (StackMax 3000, VertiStore S, MediCarry M1, PharmRunner P2, SaniBot UV-1, CleanWave C3,
  GenericFixed-Base)
- `тележек одновременно` → `"CONCURRENT_STOCK"` (TugBot T500, RampRunner R1)

Also add `capacityBasis: solutionSeed.capacityBasis` to BOTH the `create` and `update`
branches of the existing `prisma.solution.upsert(...)` call.

- [ ] **Step 2: Add an assumptions seed block**

Add near the top of `main()` (before or after the industries loop) an idempotent upsert of
the 8 assumptions:
```ts
const assumptions = [
  { key: "laborCostPerHourUsd", label: "Стоимость труда (час)", value: 15, unit: "USD/час", order: 1 },
  { key: "hoursPerYear", label: "Рабочих часов в году (на сотрудника)", value: 2000, unit: "часов", order: 2 },
  { key: "workingDaysPerYear", label: "Рабочих дней в году", value: 250, unit: "дней", order: 3 },
  { key: "operatingHoursPerDay", label: "Часов работы объекта в сутки", value: 16, unit: "часов", order: 4 },
  { key: "installPctOfCapex", label: "Монтаж/интеграция (доля от CAPEX)", value: 0.15, unit: "доля", order: 5 },
  { key: "laborReplacementPct", label: "Замещение труда роботами", value: 0.7, unit: "доля", order: 6 },
  { key: "turnoverPerDay", label: "Оборотов в сутки (для stock-решений)", value: 8, unit: "раз", order: 7 },
  { key: "roiHorizonYears", label: "Горизонт расчёта ROI", value: 5, unit: "лет", order: 8 },
];
for (const asmp of assumptions) {
  await prisma.assumption.upsert({
    where: { key: asmp.key },
    update: { label: asmp.label, value: asmp.value, unit: asmp.unit, order: asmp.order },
    create: asmp,
  });
}
```
Update the final `console.log` to also report the assumptions count, e.g. append
`, ${assumptions.length} assumptions.` — keep the existing solution counts.

- [ ] **Step 3: Run the seed**

```bash
npx --yes prisma generate
npm run db:seed
```
Expected: exit 0; the summary line now includes `8 assumptions`. Re-run once to confirm
idempotency (counts unchanged, no errors).

- [ ] **Step 4: Verify the basis stuck (spot check)**

```bash
docker compose exec -T db psql -U rrp -d robotization_roi -c "select \"capacityBasis\", count(*) from \"Solution\" group by 1 order by 1;"
```
Expected: `CONCURRENT_STOCK | 2`, `PER_DAY_FLOW | 7`, `PER_HOUR_FLOW | 5`.

- [ ] **Step 5: Commit**

```bash
git add scripts/seed.ts
git commit -m "Seed capacityBasis on all solutions + 8 assumptions"
```

---

### Task 5: Query helpers — `getSolutionForCalc`, `getAssumptions`

**Files:**
- Modify: `lib/db/queries.ts`
- Modify: `lib/db/queries.test.ts`

**Interfaces:**
- Consumes: seeded DB (Task 4); existing `prisma` client (`lib/db/client.ts`).
- Produces:
  - `getSolutionForCalc(id: string)` → the `Solution` (all fields incl. `capacityBasis`,
    prices, capacity) with `{ solutionCategory: { facilityType: { industry } } }` included, or
    `null`.
  - `getAssumptions()` → all `Assumption` rows ordered by `order` asc.

- [ ] **Step 1: Add failing tests to `lib/db/queries.test.ts`**

Append:
```ts
import { getSolutionForCalc, getAssumptions } from "./queries";

describe("getAssumptions", () => {
  it("returns the 8 seeded assumptions ordered by `order`", async () => {
    const rows = await getAssumptions();
    expect(rows).toHaveLength(8);
    expect(rows[0].key).toBe("laborCostPerHourUsd");
    expect(rows.map((r) => r.order)).toEqual([...rows.map((r) => r.order)].sort((x, y) => x - y));
  });
});

describe("getSolutionForCalc", () => {
  it("returns a solution with capacityBasis and its facility type, or null", async () => {
    const warehouse = await getCatalogForFacilityType("warehouse");
    const someId = warehouse!.solutionCategories[0].solutions[0].id;
    const sol = await getSolutionForCalc(someId);
    expect(sol).not.toBeNull();
    expect(sol!.capacityBasis).toBeDefined();
    expect(sol!.solutionCategory.facilityType.slug).toBe("warehouse");
    expect(await getSolutionForCalc("does-not-exist")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx --yes vitest run lib/db/queries.test.ts < /dev/null`
Expected: FAIL — `getSolutionForCalc` / `getAssumptions` not exported.

- [ ] **Step 3: Implement in `lib/db/queries.ts`**

```ts
export async function getAssumptions() {
  return prisma.assumption.findMany({ orderBy: { order: "asc" } });
}

export async function getSolutionForCalc(id: string) {
  return prisma.solution.findUnique({
    where: { id },
    include: {
      solutionCategory: { include: { facilityType: { include: { industry: true } } } },
    },
  });
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx --yes vitest run lib/db/queries.test.ts < /dev/null`
Expected: PASS (the 3 existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add lib/db/queries.ts lib/db/queries.test.ts
git commit -m "Add getSolutionForCalc + getAssumptions queries"
```

---

### Task 6: Assumption mapping helper + Step 2 "Рассчитать" links

**Files:**
- Create: `lib/economics/assumptions.ts`
- Create: `lib/economics/assumptions.test.ts`
- Modify: `app/(app)/compare/[type]/page.tsx`

**Interfaces:**
- Consumes: `AssumptionValues` type (Task 2); the `Assumption[]` rows shape from
  `getAssumptions` (Task 5) — each row has `{ key: string; value: number }`.
- Produces: `assumptionsToValues(rows: { key: string; value: number }[]): AssumptionValues`
  (maps DB rows → the engine's typed object, applying the documented defaults for any missing
  key so the engine always gets a complete object). Step 2 cards link to `/calculate/[id]`.

- [ ] **Step 1: Write failing test — `lib/economics/assumptions.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { assumptionsToValues, DEFAULT_ASSUMPTIONS } from "./assumptions";

describe("assumptionsToValues", () => {
  it("maps rows by key into a complete AssumptionValues object", () => {
    const rows = [
      { key: "laborCostPerHourUsd", value: 20 },
      { key: "roiHorizonYears", value: 3 },
    ];
    const v = assumptionsToValues(rows);
    expect(v.laborCostPerHourUsd).toBe(20);
    expect(v.roiHorizonYears).toBe(3);
    // missing keys fall back to documented defaults
    expect(v.workingDaysPerYear).toBe(DEFAULT_ASSUMPTIONS.workingDaysPerYear);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx --yes vitest run lib/economics/assumptions.test.ts < /dev/null`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/economics/assumptions.ts`**

```ts
import type { AssumptionValues } from "./types";

export const DEFAULT_ASSUMPTIONS: AssumptionValues = {
  laborCostPerHourUsd: 15,
  hoursPerYear: 2000,
  workingDaysPerYear: 250,
  operatingHoursPerDay: 16,
  installPctOfCapex: 0.15,
  laborReplacementPct: 0.7,
  turnoverPerDay: 8,
  roiHorizonYears: 5,
};

export function assumptionsToValues(
  rows: { key: string; value: number }[]
): AssumptionValues {
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const out = { ...DEFAULT_ASSUMPTIONS };
  for (const k of Object.keys(out) as (keyof AssumptionValues)[]) {
    const v = byKey.get(k);
    if (typeof v === "number") out[k] = v;
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx --yes vitest run lib/economics/assumptions.test.ts < /dev/null`
Expected: PASS.

- [ ] **Step 5: Add a "Рассчитать экономику" link to each solution card**

In `app/(app)/compare/[type]/page.tsx`, inside the solution `<Card>` (after the
`<CardContent>` with price/capacity), add a link to Step 3. Import `Link` from `next/link` at
the top. Add within the card:
```tsx
                <div className="px-6 pb-4">
                  <Link
                    href={`/calculate/${solution.id}`}
                    className="text-sm font-medium underline underline-offset-4"
                  >
                    Рассчитать экономику →
                  </Link>
                </div>
```
(Place it as the last child of the `<Card>`, after `</CardContent>`.)

- [ ] **Step 6: Verify build**

Run: `npm run build`
Expected: exit 0, compiled successfully.

- [ ] **Step 7: Commit**

```bash
git add lib/economics/assumptions.ts lib/economics/assumptions.test.ts "app/(app)/compare"
git commit -m "Add assumptions mapping helper + Step 2 calculate links"
```

---

### Task 7: Step 3 — `/calculate/[solutionId]` page + calculator client component

**Files:**
- Create: `app/(app)/calculate/[solutionId]/page.tsx`
- Create: `components/economics-calculator.tsx`

**Interfaces:**
- Consumes: `getSolutionForCalc`, `getAssumptions` (Task 5); `assumptionsToValues`,
  `DEFAULT_ASSUMPTIONS` (Task 6); `computeEconomics` + types (Tasks 2-3); `formatCost`
  (`@/lib/format/currency`); shadcn `Card`, `Label`, `Button`.
- Produces: route `/calculate/[solutionId]`; `EconomicsCalculator` client component.

- [ ] **Step 1: Create the server page `app/(app)/calculate/[solutionId]/page.tsx`**

```tsx
import { notFound } from "next/navigation";
import { getSolutionForCalc, getAssumptions } from "@/lib/db/queries";
import { assumptionsToValues } from "@/lib/economics/assumptions";
import { EconomicsCalculator } from "@/components/economics-calculator";

export default async function CalculatePage({
  params,
}: {
  params: Promise<{ solutionId: string }>;
}) {
  const { solutionId } = await params;
  const [solution, assumptionRows] = await Promise.all([
    getSolutionForCalc(solutionId),
    getAssumptions(),
  ]);
  if (!solution) notFound();

  const initialAssumptions = assumptionsToValues(assumptionRows);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 py-12">
      <div>
        <h1 className="text-2xl font-semibold">Расчёт экономики: {solution.name}</h1>
        <p className="text-sm text-muted-foreground">
          {solution.vendor} · {solution.solutionCategory.facilityType.name} (
          {solution.solutionCategory.facilityType.industry.name})
        </p>
      </div>
      <EconomicsCalculator
        capacity={{
          capacityPerUnit: solution.capacityPerUnit,
          capacityBasis: solution.capacityBasis,
          priceUsd: solution.priceUsd,
          maintenanceUsdYear: solution.maintenanceUsdYear,
          energyUsdYear: solution.energyUsdYear,
          licensingUsdYear: solution.licensingUsdYear,
        }}
        capacityUnit={solution.capacityUnit}
        initialAssumptions={initialAssumptions}
      />
    </div>
  );
}
```

- [ ] **Step 2: Create the client component `components/economics-calculator.tsx`**

```tsx
"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { computeEconomics } from "@/lib/economics/calculate";
import type {
  SolutionCapacity,
  FacilityParams,
  AssumptionValues,
} from "@/lib/economics/types";
import { formatCost } from "@/lib/format/currency";

const ASSUMPTION_LABELS: Record<keyof AssumptionValues, string> = {
  laborCostPerHourUsd: "Стоимость труда (USD/час)",
  hoursPerYear: "Рабочих часов в году",
  workingDaysPerYear: "Рабочих дней в году",
  operatingHoursPerDay: "Часов работы в сутки",
  installPctOfCapex: "Монтаж (доля от CAPEX)",
  laborReplacementPct: "Замещение труда (доля)",
  turnoverPerDay: "Оборотов в сутки",
  roiHorizonYears: "Горизонт ROI (лет)",
};

function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label>{label}</Label>
      <input
        type="number"
        className="rounded-md border px-3 py-2 text-sm"
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export function EconomicsCalculator({
  capacity,
  capacityUnit,
  initialAssumptions,
}: {
  capacity: SolutionCapacity;
  capacityUnit: string;
  initialAssumptions: AssumptionValues;
}) {
  const isStock = capacity.capacityBasis === "CONCURRENT_STOCK";
  const [params, setParams] = useState<FacilityParams>({
    areaM2: 1000,
    opsPerDay: 500,
    staffCount: 10,
    ...(isStock ? { peakConcurrent: 20 } : {}),
  });
  const [assumptions, setAssumptions] =
    useState<AssumptionValues>(initialAssumptions);

  const result = computeEconomics(capacity, params, assumptions);

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Параметры объекта</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <NumField label="Площадь (м²)" value={params.areaM2}
            onChange={(n) => setParams((p) => ({ ...p, areaM2: n }))} />
          <NumField label="Объём операций в сутки" value={params.opsPerDay}
            onChange={(n) => setParams((p) => ({ ...p, opsPerDay: n }))} />
          <NumField label="Численность персонала" value={params.staffCount}
            onChange={(n) => setParams((p) => ({ ...p, staffCount: n }))} />
          {isStock && (
            <NumField
              label="Пиковая одновременная нагрузка"
              value={params.peakConcurrent ?? 0}
              onChange={(n) => setParams((p) => ({ ...p, peakConcurrent: n }))}
            />
          )}
          <p className="text-xs text-muted-foreground">
            Производительность решения: {capacity.capacityPerUnit} {capacityUnit}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Результаты</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <div>Требуется единиц: <b>{result.quantity}</b></div>
          <div>CAPEX: <b>{formatCost(result.capexUsd)}</b></div>
          <div>OPEX/год: <b>{formatCost(result.opexAnnualUsd)}</b></div>
          <div>Базовые затраты на труд/год: {formatCost(result.baselineAnnualUsd)}</div>
          {result.economical ? (
            <>
              <div>Годовая экономия: <b>{formatCost(result.annualSavingsUsd)}</b></div>
              <div>Срок окупаемости: <b>{result.paybackYears.toFixed(1)} лет</b></div>
              <div>ROI: <b>{result.roiPct.toFixed(0)}%</b></div>
            </>
          ) : (
            <div className="font-medium text-red-600">
              Решение не окупается при текущих параметрах
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle>Допущения (можно изменить)</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
          {(Object.keys(ASSUMPTION_LABELS) as (keyof AssumptionValues)[]).map((k) => (
            <NumField
              key={k}
              label={ASSUMPTION_LABELS[k]}
              value={assumptions[k]}
              onChange={(n) => setAssumptions((a) => ({ ...a, [k]: n }))}
            />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: exit 0, `/calculate/[solutionId]` route registered.

- [ ] **Step 4: Manual verification (build + curl, DB up)**

```bash
(npm run dev > /tmp/rrp-dev-w2.log 2>&1 &) ; sleep 8
# grab a real solution id from the warehouse catalog page
SID=$(curl -s http://localhost:3000/compare/warehouse | grep -oE '/calculate/[a-z0-9]+' | head -1 | cut -d/ -f3)
echo "solution id: $SID"
curl -s "http://localhost:3000/calculate/$SID" | grep -oE 'Расчёт экономики|CAPEX|OPEX/год|Допущения|₽' | sort -u
curl -s -o /dev/null -w "unknown: %{http_code}\n" http://localhost:3000/calculate/does-not-exist   # expect 404
pkill -f "next dev" 2>/dev/null; pkill -f "next-server" 2>/dev/null; true
```
Expected: the calc page shows "Расчёт экономики", CAPEX, OPEX/год, Допущения, and ₽; unknown
id → 404.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/calculate" components/economics-calculator.tsx
git commit -m "Add Step 3 economics calculator page + client component"
```

---

## Definition of done

- [ ] `npm run build` succeeds; `/calculate/[solutionId]` route registered.
- [ ] With DB up + seeded, `npx --yes vitest run < /dev/null` passes all tests — 19 total:
  3 currency + 5 DB-query (3 existing + 2 new) + 6 normalize + 4 calculate + 1 assumptions.
- [ ] `npm run dev`: from `/compare/warehouse`, "Рассчитать экономику" → `/calculate/[id]`
  shows params form, editable assumptions, and results in RUB+USD; editing an assumption
  recomputes live; a tiny facility shows the "не окупается" state (no NaN/negative).
- [ ] `CONCURRENT_STOCK` solutions (airport tugs) show a "пиковая одновременная нагрузка"
  input; flow solutions do not.
- [ ] Each task committed individually.
- [ ] `CHANGELOG.md` updated with a Week 2 summary (final step, one commit).
