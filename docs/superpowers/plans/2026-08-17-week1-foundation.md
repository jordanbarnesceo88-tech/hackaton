# Week 1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Next.js app, database, and seed data, then ship Steps 1-2 of the
user flow (industry/facility-type picker → solution catalog/comparison) as working,
demoable pages.

**Architecture:** Single Next.js 14+ App Router project, TypeScript, Tailwind + shadcn/ui
for components, Postgres (local via Docker) accessed through Prisma. Server components
fetch data directly via Prisma; a small client component handles the two-step picker's
interactive state.

**Tech Stack:** Next.js (App Router, TypeScript), Tailwind CSS, shadcn/ui, Prisma ORM,
PostgreSQL 16 (Docker Compose for local dev), Vitest for unit/integration tests.

**Spec:** `docs/00-idea-brief.md`, `docs/01-prd.md`, `docs/02-execution-plan.md`

## Global Constraints

- All commands below run from the project root: `~/robotization-roi-platform`.
- Prerequisites: Node.js 20+, npm, Docker Desktop running locally.
- **UI language is Russian.** The PRD lists "localization beyond the source language" as
  out of scope — the source language (Russian, matching the idea brief and the real
  client audience) is the only supported UI language. All seed data names/descriptions
  and static UI copy must be in Russian. Vendor/product brand names stay in Latin script
  (standard practice — real robotics vendor names aren't translated either).
- **Scope boundary:** this plan covers Steps 1-2 of the 4-step flow only. It explicitly
  does NOT include: the `Session` model (added in the Week 2 plan, which needs it to
  persist calculator inputs/results), the `Assumption` model (added in Week 2, needed by
  the economics engine), the `User` model or any auth (added in the Week 4 plan). Steps
  1-2 are stateless/URL-driven in this plan — the facility type slug travels via the URL,
  not a persisted session — so this sub-project is fully self-contained and demoable on
  its own before those later pieces exist.
- **Solution provenance:** the spec (`docs/02-execution-plan.md` §3) names two
  `Solution.source` values, `organizer|parsed`. Placeholder data seeded by this plan is
  neither — mislabeling it as one would contradict the PRD's own provenance requirement
  (§8: "Solution data must carry provenance"). This plan adds a third value, `SEED`, to
  honestly label this plan's placeholder data. Swapping in real organizer/parsed data
  later is a data change, not a schema change.
- `FacilityExample` is defined in this plan's schema (per PRD §6) but is NOT seeded here
  — anonymized organizer examples aren't available yet (PRD §10, open question). The
  table exists and is empty until that data arrives.

---

### Task 1: Scaffold the Next.js app

**Files:**
- Create (via `create-next-app`, then merged in): `package.json`, `tsconfig.json`,
  `next.config.mjs`, `tailwind.config.ts`, `postcss.config.mjs`, `app/layout.tsx`,
  `app/page.tsx`, `app/globals.css`, `.gitignore`, `public/*`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: a working Next.js project buildable with `npm run build`.

- [ ] **Step 1: Scaffold into a temp directory (non-interactive)**

The repo already has `.git`, `README.md`, `CHANGELOG.md`, `docs/` — scaffolding directly
into it risks `create-next-app` refusing a non-empty directory or overwriting those
files. Scaffold into a temp dir instead:

```bash
npx create-next-app@latest /tmp/rrp-scaffold \
  --typescript --tailwind --eslint --app \
  --src-dir=false --import-alias "@/*" --use-npm --no-git
```

If any prompt appears despite the flags, accept the shown default.

- [ ] **Step 2: Merge into the project, excluding files we already have**

```bash
rsync -a --exclude='.git' --exclude='README.md' --exclude='node_modules' \
  /tmp/rrp-scaffold/ ~/robotization-roi-platform/
rm -rf /tmp/rrp-scaffold
```

- [ ] **Step 3: Install dependencies**

```bash
cd ~/robotization-roi-platform && npm install
```

- [ ] **Step 4: Verify the build**

Run: `npm run build`
Expected: exit code 0, output includes "Compiled successfully".

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Scaffold Next.js app (TypeScript, App Router, Tailwind)"
```

---

### Task 2: Install shadcn/ui base components

**Files:**
- Create: `components.json`, `lib/utils.ts`, `components/ui/button.tsx`,
  `components/ui/card.tsx`, `components/ui/label.tsx`, `components/ui/radio-group.tsx`
- Modify: `tailwind.config.ts`, `app/globals.css` (both updated automatically by the
  shadcn CLI)

**Interfaces:**
- Consumes: Next.js project from Task 1 (`tailwind.config.ts`, `app/globals.css`).
- Produces: `Button` (from `@/components/ui/button`), `Card`/`CardHeader`/`CardTitle`/
  `CardContent` (from `@/components/ui/card`), `Label` (from `@/components/ui/label`),
  `RadioGroup`/`RadioGroupItem` (from `@/components/ui/radio-group`), `cn()` helper
  (from `@/lib/utils`).

- [ ] **Step 1: Initialize shadcn/ui**

```bash
npx shadcn@latest init -d
```

If prompted despite `-d`, accept the shown defaults.

- [ ] **Step 2: Add the components this plan needs**

```bash
npx shadcn@latest add button card label radio-group -y
```

- [ ] **Step 3: Verify the build still succeeds**

Run: `npm run build`
Expected: exit code 0, output includes "Compiled successfully".

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Add shadcn/ui base components (button, card, label, radio-group)"
```

---

### Task 3: Local Postgres + Prisma schema

**Files:**
- Create: `docker-compose.yml`, `.env`, `.env.example`, `prisma/schema.prisma`
- Modify: `.gitignore` (ensure `.env` is ignored)

**Interfaces:**
- Consumes: nothing new.
- Produces: running Postgres on `localhost:5432`; Prisma models `Industry`,
  `FacilityType`, `SolutionCategory`, `Solution`, `FacilityExample`, enum
  `SolutionSource`; generated `@prisma/client` types.

- [ ] **Step 1: Install Prisma**

```bash
npm install @prisma/client
npm install -D prisma
```

- [ ] **Step 2: Create `docker-compose.yml`**

```yaml
services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: rrp
      POSTGRES_PASSWORD: rrp_dev_password
      POSTGRES_DB: robotization_roi
    ports:
      - "5432:5432"
    volumes:
      - rrp_pgdata:/var/lib/postgresql/data

volumes:
  rrp_pgdata:
```

- [ ] **Step 3: Create `.env` and `.env.example`**

`.env`:
```
DATABASE_URL="postgresql://rrp:rrp_dev_password@localhost:5432/robotization_roi"
```

`.env.example` (same content — this is a local-only dev password, not a real secret):
```
DATABASE_URL="postgresql://rrp:rrp_dev_password@localhost:5432/robotization_roi"
```

- [ ] **Step 4: Ensure `.env` is gitignored**

Check `.gitignore` for a `.env` line; if it only has `.env*.local`, add a line containing
just `.env` (keep `.env.example` trackable — it has no real secret).

- [ ] **Step 5: Start Postgres and wait until ready**

```bash
docker compose up -d
until docker compose exec -T db pg_isready -U rrp > /dev/null 2>&1; do sleep 1; done
```

- [ ] **Step 6: Write `prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Industry {
  id            String         @id @default(cuid())
  slug          String         @unique
  name          String
  facilityTypes FacilityType[]
}

model FacilityType {
  id                 String              @id @default(cuid())
  slug               String              @unique
  name               String
  isGeneric          Boolean             @default(false)
  industryId         String
  industry           Industry            @relation(fields: [industryId], references: [id])
  solutionCategories SolutionCategory[]
  facilityExamples   FacilityExample[]
}

model SolutionCategory {
  id             String       @id @default(cuid())
  slug           String       @unique
  name           String
  description    String
  facilityTypeId String
  facilityType   FacilityType @relation(fields: [facilityTypeId], references: [id])
  solutions      Solution[]
}

enum SolutionSource {
  SEED
  ORGANIZER
  PARSED
}

model Solution {
  id                 String           @id @default(cuid())
  name               String
  vendor             String
  solutionCategoryId String
  solutionCategory   SolutionCategory @relation(fields: [solutionCategoryId], references: [id])
  priceUsd           Float
  capacityPerUnit    Float
  capacityUnit       String
  maintenanceUsdYear Float
  energyUsdYear      Float
  licensingUsdYear   Float
  specs              Json
  source             SolutionSource   @default(SEED)
  sourceUrl          String?
  lastVerified       DateTime?
  createdAt          DateTime         @default(now())
  updatedAt          DateTime         @updatedAt

  @@unique([solutionCategoryId, name])
}

model FacilityExample {
  id             String       @id @default(cuid())
  name           String
  facilityTypeId String
  facilityType   FacilityType @relation(fields: [facilityTypeId], references: [id])
  params         Json
}
```

- [ ] **Step 7: Run the first migration**

```bash
npx prisma migrate dev --name init
```

Expected: exit code 0, output includes "Your database is now in sync with your schema."

- [ ] **Step 8: Validate**

Run: `npx prisma validate`
Expected: "The schema at prisma/schema.prisma is valid"

- [ ] **Step 9: Commit**

```bash
git add docker-compose.yml .env.example .gitignore prisma/
git commit -m "Add local Postgres via Docker Compose and Prisma schema"
```

---

### Task 4: Seed data

**Files:**
- Create: `scripts/seed.ts`
- Modify: `package.json` (add `db:seed` script and `prisma.seed` config)

**Interfaces:**
- Consumes: schema/migration from Task 3.
- Produces: 4 industries, 4 facility types, 8 solution categories, 14 solutions in the
  database (all `source: SEED`); `npm run db:seed` command.

- [ ] **Step 1: Install a TS script runner**

```bash
npm install -D tsx
```

- [ ] **Step 2: Add seed config and script to `package.json`**

Add to the top-level of `package.json`:
```json
"prisma": {
  "seed": "tsx scripts/seed.ts"
}
```

Add to the `"scripts"` block:
```json
"db:seed": "tsx scripts/seed.ts"
```

- [ ] **Step 3: Create `scripts/seed.ts`**

```typescript
import { PrismaClient, SolutionSource } from "@prisma/client";

const prisma = new PrismaClient();

type SolutionSeed = {
  name: string;
  vendor: string;
  priceUsd: number;
  capacityPerUnit: number;
  capacityUnit: string;
  maintenanceUsdYear: number;
  energyUsdYear: number;
  licensingUsdYear: number;
  specs: Record<string, number>;
};

type CategorySeed = {
  slug: string;
  name: string;
  description: string;
  solutions: SolutionSeed[];
};

type FacilityTypeSeed = {
  slug: string;
  name: string;
  isGeneric: boolean;
  categories: CategorySeed[];
};

type IndustrySeed = {
  slug: string;
  name: string;
  facilityTypes: FacilityTypeSeed[];
};

const seedData: IndustrySeed[] = [
  {
    slug: "retail",
    name: "Торговля",
    facilityTypes: [
      {
        slug: "warehouse",
        name: "Склад",
        isGeneric: false,
        categories: [
          {
            slug: "amr",
            name: "Автономные мобильные роботы (AMR)",
            description:
              "Мобильные роботы для перемещения товаров между зонами склада без выделенных путей",
            solutions: [
              {
                name: "RoboPick A200",
                vendor: "Demo Robotics Co.",
                priceUsd: 45000,
                capacityPerUnit: 200,
                capacityUnit: "заказов/час",
                maintenanceUsdYear: 6000,
                energyUsdYear: 1200,
                licensingUsdYear: 3000,
                specs: { payloadKg: 200, speedMps: 1.5, batteryHours: 8 },
              },
              {
                name: "WareBot X1",
                vendor: "Placeholder Automation LLC",
                priceUsd: 38000,
                capacityPerUnit: 150,
                capacityUnit: "заказов/час",
                maintenanceUsdYear: 5000,
                energyUsdYear: 1000,
                licensingUsdYear: 2500,
                specs: { payloadKg: 150, speedMps: 1.2, batteryHours: 10 },
              },
            ],
          },
          {
            slug: "asrs",
            name: "Автоматизированные системы хранения (AS/RS)",
            description:
              "Автоматизированные стеллажные системы для хранения и подбора товаров",
            solutions: [
              {
                name: "StackMax 3000",
                vendor: "Demo Robotics Co.",
                priceUsd: 120000,
                capacityPerUnit: 500,
                capacityUnit: "паллет/день",
                maintenanceUsdYear: 15000,
                energyUsdYear: 4000,
                licensingUsdYear: 5000,
                specs: { heightM: 12, aislesServed: 4 },
              },
              {
                name: "VertiStore S",
                vendor: "Placeholder Automation LLC",
                priceUsd: 95000,
                capacityPerUnit: 350,
                capacityUnit: "паллет/день",
                maintenanceUsdYear: 12000,
                energyUsdYear: 3200,
                licensingUsdYear: 4000,
                specs: { heightM: 9, aislesServed: 3 },
              },
            ],
          },
        ],
      },
    ],
  },
  {
    slug: "logistics",
    name: "Логистика",
    facilityTypes: [
      {
        slug: "airport",
        name: "Аэропорт",
        isGeneric: false,
        categories: [
          {
            slug: "baggage-robots",
            name: "Роботы для обработки багажа",
            description: "Роботизированные системы сортировки и перемещения багажа",
            solutions: [
              {
                name: "BagHandler B1",
                vendor: "SkyBots Demo Inc.",
                priceUsd: 85000,
                capacityPerUnit: 400,
                capacityUnit: "мест багажа/час",
                maintenanceUsdYear: 11000,
                energyUsdYear: 2500,
                licensingUsdYear: 6000,
                specs: { beltLengthM: 20, sortAccuracyPct: 99.2 },
              },
              {
                name: "CargoMate C2",
                vendor: "Placeholder Automation LLC",
                priceUsd: 72000,
                capacityPerUnit: 320,
                capacityUnit: "мест багажа/час",
                maintenanceUsdYear: 9500,
                energyUsdYear: 2100,
                licensingUsdYear: 5000,
                specs: { beltLengthM: 15, sortAccuracyPct: 98.5 },
              },
            ],
          },
          {
            slug: "autonomous-tugs",
            name: "Автономные тягачи",
            description:
              "Автономные тягачи для перемещения багажных тележек и контейнеров",
            solutions: [
              {
                name: "TugBot T500",
                vendor: "SkyBots Demo Inc.",
                priceUsd: 65000,
                capacityPerUnit: 12,
                capacityUnit: "тележек одновременно",
                maintenanceUsdYear: 8000,
                energyUsdYear: 1800,
                licensingUsdYear: 3500,
                specs: { towCapacityKg: 5000, speedMps: 3 },
              },
              {
                name: "RampRunner R1",
                vendor: "Demo Robotics Co.",
                priceUsd: 58000,
                capacityPerUnit: 10,
                capacityUnit: "тележек одновременно",
                maintenanceUsdYear: 7200,
                energyUsdYear: 1600,
                licensingUsdYear: 3000,
                specs: { towCapacityKg: 4000, speedMps: 2.5 },
              },
            ],
          },
        ],
      },
    ],
  },
  {
    slug: "social",
    name: "Социальная сфера",
    facilityTypes: [
      {
        slug: "medical",
        name: "Медучреждение",
        isGeneric: false,
        categories: [
          {
            slug: "med-delivery",
            name: "Роботы доставки медикаментов",
            description:
              "Роботы для доставки медикаментов и расходных материалов по учреждению",
            solutions: [
              {
                name: "MediCarry M1",
                vendor: "CareBots Demo Ltd.",
                priceUsd: 32000,
                capacityPerUnit: 60,
                capacityUnit: "доставок/день",
                maintenanceUsdYear: 4500,
                energyUsdYear: 800,
                licensingUsdYear: 2200,
                specs: { payloadKg: 20, batteryHours: 12 },
              },
              {
                name: "PharmRunner P2",
                vendor: "Placeholder Automation LLC",
                priceUsd: 27000,
                capacityPerUnit: 45,
                capacityUnit: "доставок/день",
                maintenanceUsdYear: 3800,
                energyUsdYear: 700,
                licensingUsdYear: 1800,
                specs: { payloadKg: 15, batteryHours: 10 },
              },
            ],
          },
          {
            slug: "disinfection",
            name: "Роботы дезинфекции",
            description: "Автономные роботы для дезинфекции помещений",
            solutions: [
              {
                name: "SaniBot UV-1",
                vendor: "CareBots Demo Ltd.",
                priceUsd: 41000,
                capacityPerUnit: 8,
                capacityUnit: "помещений/день",
                maintenanceUsdYear: 5200,
                energyUsdYear: 1500,
                licensingUsdYear: 2500,
                specs: { roomsM2Coverage: 40, cycleMinutes: 15 },
              },
              {
                name: "CleanWave C3",
                vendor: "Demo Robotics Co.",
                priceUsd: 36000,
                capacityPerUnit: 6,
                capacityUnit: "помещений/день",
                maintenanceUsdYear: 4600,
                energyUsdYear: 1300,
                licensingUsdYear: 2100,
                specs: { roomsM2Coverage: 35, cycleMinutes: 18 },
              },
            ],
          },
        ],
      },
    ],
  },
  {
    slug: "other",
    name: "Другое",
    facilityTypes: [
      {
        slug: "other",
        name: "Произвольный объект",
        isGeneric: true,
        categories: [
          {
            slug: "generic-mobile",
            name: "Универсальный мобильный робот",
            description: "Универсальный мобильный робот для произвольных объектов",
            solutions: [
              {
                name: "GenericAMR-Base",
                vendor: "Demo Robotics Co.",
                priceUsd: 40000,
                capacityPerUnit: 100,
                capacityUnit: "операций/час",
                maintenanceUsdYear: 5500,
                energyUsdYear: 1100,
                licensingUsdYear: 2800,
                specs: { payloadKg: 100, speedMps: 1.0 },
              },
            ],
          },
          {
            slug: "generic-fixed",
            name: "Универсальная стационарная автоматизация",
            description: "Универсальная стационарная роботизированная система",
            solutions: [
              {
                name: "GenericFixed-Base",
                vendor: "Demo Robotics Co.",
                priceUsd: 90000,
                capacityPerUnit: 300,
                capacityUnit: "операций/день",
                maintenanceUsdYear: 11000,
                energyUsdYear: 3000,
                licensingUsdYear: 4200,
                specs: { footprintM2: 25 },
              },
            ],
          },
        ],
      },
    ],
  },
];

async function main() {
  let industryCount = 0;
  let facilityTypeCount = 0;
  let categoryCount = 0;
  let solutionCount = 0;

  for (const industrySeed of seedData) {
    const industry = await prisma.industry.upsert({
      where: { slug: industrySeed.slug },
      update: { name: industrySeed.name },
      create: { slug: industrySeed.slug, name: industrySeed.name },
    });
    industryCount++;

    for (const facilityTypeSeed of industrySeed.facilityTypes) {
      const facilityType = await prisma.facilityType.upsert({
        where: { slug: facilityTypeSeed.slug },
        update: {
          name: facilityTypeSeed.name,
          isGeneric: facilityTypeSeed.isGeneric,
          industryId: industry.id,
        },
        create: {
          slug: facilityTypeSeed.slug,
          name: facilityTypeSeed.name,
          isGeneric: facilityTypeSeed.isGeneric,
          industryId: industry.id,
        },
      });
      facilityTypeCount++;

      for (const categorySeed of facilityTypeSeed.categories) {
        const category = await prisma.solutionCategory.upsert({
          where: { slug: categorySeed.slug },
          update: {
            name: categorySeed.name,
            description: categorySeed.description,
            facilityTypeId: facilityType.id,
          },
          create: {
            slug: categorySeed.slug,
            name: categorySeed.name,
            description: categorySeed.description,
            facilityTypeId: facilityType.id,
          },
        });
        categoryCount++;

        for (const solutionSeed of categorySeed.solutions) {
          await prisma.solution.upsert({
            where: {
              solutionCategoryId_name: {
                solutionCategoryId: category.id,
                name: solutionSeed.name,
              },
            },
            update: {
              vendor: solutionSeed.vendor,
              priceUsd: solutionSeed.priceUsd,
              capacityPerUnit: solutionSeed.capacityPerUnit,
              capacityUnit: solutionSeed.capacityUnit,
              maintenanceUsdYear: solutionSeed.maintenanceUsdYear,
              energyUsdYear: solutionSeed.energyUsdYear,
              licensingUsdYear: solutionSeed.licensingUsdYear,
              specs: solutionSeed.specs,
              source: SolutionSource.SEED,
            },
            create: {
              name: solutionSeed.name,
              vendor: solutionSeed.vendor,
              solutionCategoryId: category.id,
              priceUsd: solutionSeed.priceUsd,
              capacityPerUnit: solutionSeed.capacityPerUnit,
              capacityUnit: solutionSeed.capacityUnit,
              maintenanceUsdYear: solutionSeed.maintenanceUsdYear,
              energyUsdYear: solutionSeed.energyUsdYear,
              licensingUsdYear: solutionSeed.licensingUsdYear,
              specs: solutionSeed.specs,
              source: SolutionSource.SEED,
            },
          });
          solutionCount++;
        }
      }
    }
  }

  console.log(
    `Seeded ${industryCount} industries, ${facilityTypeCount} facility types, ${categoryCount} solution categories, ${solutionCount} solutions.`
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

- [ ] **Step 4: Run the seed script**

Run: `npm run db:seed`
Expected: exit code 0, final line reads
`Seeded 4 industries, 4 facility types, 8 solution categories, 14 solutions.`

- [ ] **Step 5: Commit**

```bash
git add scripts/seed.ts package.json package-lock.json
git commit -m "Add seed script with placeholder catalog data (4 verticals)"
```

---

### Task 5: Data access layer + tests

**Files:**
- Create: `lib/db/client.ts`, `lib/db/queries.ts`, `lib/db/queries.test.ts`,
  `vitest.config.ts`
- Modify: `package.json` (add `test` script)

**Interfaces:**
- Consumes: Prisma client from Task 3; seeded data from Task 4 (tests assert against it
  — run `npm run db:seed` before `npm test` if the DB was just reset).
- Produces: `prisma` (named export, `lib/db/client.ts`),
  `getIndustries(): Promise<(Industry & { facilityTypes: FacilityType[] })[]>` and
  `getCatalogForFacilityType(slug: string): Promise<(FacilityType & { industry: Industry;
  solutionCategories: (SolutionCategory & { solutions: Solution[] })[] }) | null>` (both
  from `lib/db/queries.ts`).

- [ ] **Step 1: Install Vitest**

```bash
npm install -D vitest
```

- [ ] **Step 2: Add test script to `package.json`**

Add to `"scripts"`: `"test": "vitest run"`

- [ ] **Step 3: Create `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
  },
});
```

- [ ] **Step 4: Write the failing tests first — `lib/db/queries.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { getIndustries, getCatalogForFacilityType } from "./queries";

describe("getIndustries", () => {
  it("returns all 4 seeded industries with their facility types", async () => {
    const industries = await getIndustries();
    expect(industries).toHaveLength(4);
    const retail = industries.find((i) => i.slug === "retail");
    expect(retail).toBeDefined();
    expect(retail!.facilityTypes.map((f) => f.slug)).toContain("warehouse");
  });
});

describe("getCatalogForFacilityType", () => {
  it("returns categories with solutions for the warehouse facility type", async () => {
    const catalog = await getCatalogForFacilityType("warehouse");
    expect(catalog).not.toBeNull();
    expect(catalog!.solutionCategories.length).toBeGreaterThanOrEqual(2);
    for (const category of catalog!.solutionCategories) {
      expect(category.solutions.length).toBeGreaterThan(0);
    }
  });

  it("returns null for an unknown facility type slug", async () => {
    const catalog = await getCatalogForFacilityType("does-not-exist");
    expect(catalog).toBeNull();
  });
});
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `npx vitest run`
Expected: FAIL — `lib/db/queries.ts` does not exist yet (module not found).

- [ ] **Step 6: Create `lib/db/client.ts`**

```typescript
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
```

- [ ] **Step 7: Create `lib/db/queries.ts`**

```typescript
import { prisma } from "./client";

export async function getIndustries() {
  return prisma.industry.findMany({
    orderBy: { name: "asc" },
    include: {
      facilityTypes: {
        orderBy: { name: "asc" },
      },
    },
  });
}

export async function getCatalogForFacilityType(facilityTypeSlug: string) {
  return prisma.facilityType.findUnique({
    where: { slug: facilityTypeSlug },
    include: {
      industry: true,
      solutionCategories: {
        orderBy: { name: "asc" },
        include: {
          solutions: {
            orderBy: { name: "asc" },
          },
        },
      },
    },
  });
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run`
Expected: PASS — 3 tests passing (ensure `npm run db:seed` has been run against the
current DB first).

- [ ] **Step 9: Commit**

```bash
git add lib/db vitest.config.ts package.json package-lock.json
git commit -m "Add Prisma client singleton, catalog queries, and tests"
```

---

### Task 6: Step 1 — industry + facility type picker

**Files:**
- Create: `app/(app)/onboarding/page.tsx`, `components/onboarding-form.tsx`
- Modify: `app/page.tsx` (replace entire contents — redirect root to `/onboarding`)

**Interfaces:**
- Consumes: `getIndustries` from `lib/db/queries.ts`; `RadioGroup`/`RadioGroupItem`
  (`@/components/ui/radio-group`), `Label` (`@/components/ui/label`), `Button`
  (`@/components/ui/button`), `Card`/`CardHeader`/`CardTitle`/`CardContent`
  (`@/components/ui/card`) from Task 2.
- Produces: `OnboardingForm` component (`@/components/onboarding-form`); route
  `/onboarding`; root `/` redirects to `/onboarding`.

- [ ] **Step 1: Create `components/onboarding-form.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type FacilityType = {
  id: string;
  slug: string;
  name: string;
};

type Industry = {
  id: string;
  slug: string;
  name: string;
  facilityTypes: FacilityType[];
};

export function OnboardingForm({ industries }: { industries: Industry[] }) {
  const router = useRouter();
  const [industrySlug, setIndustrySlug] = useState<string | null>(null);
  const [facilityTypeSlug, setFacilityTypeSlug] = useState<string | null>(null);

  const selectedIndustry = industries.find((i) => i.slug === industrySlug) ?? null;

  function handleContinue() {
    if (facilityTypeSlug) {
      router.push(`/compare/${facilityTypeSlug}`);
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 py-12">
      <Card>
        <CardHeader>
          <CardTitle>1. Выберите отрасль</CardTitle>
        </CardHeader>
        <CardContent>
          <RadioGroup
            value={industrySlug ?? undefined}
            onValueChange={(value) => {
              setIndustrySlug(value);
              setFacilityTypeSlug(null);
            }}
          >
            {industries.map((industry) => (
              <div key={industry.id} className="flex items-center space-x-2">
                <RadioGroupItem value={industry.slug} id={`industry-${industry.slug}`} />
                <Label htmlFor={`industry-${industry.slug}`}>{industry.name}</Label>
              </div>
            ))}
          </RadioGroup>
        </CardContent>
      </Card>

      {selectedIndustry && (
        <Card>
          <CardHeader>
            <CardTitle>2. Выберите тип объекта</CardTitle>
          </CardHeader>
          <CardContent>
            <RadioGroup
              value={facilityTypeSlug ?? undefined}
              onValueChange={setFacilityTypeSlug}
            >
              {selectedIndustry.facilityTypes.map((facilityType) => (
                <div key={facilityType.id} className="flex items-center space-x-2">
                  <RadioGroupItem
                    value={facilityType.slug}
                    id={`facility-${facilityType.slug}`}
                  />
                  <Label htmlFor={`facility-${facilityType.slug}`}>
                    {facilityType.name}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </CardContent>
        </Card>
      )}

      <Button onClick={handleContinue} disabled={!facilityTypeSlug}>
        Перейти к сравнению решений
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Create `app/(app)/onboarding/page.tsx`**

```tsx
import { getIndustries } from "@/lib/db/queries";
import { OnboardingForm } from "@/components/onboarding-form";

export default async function OnboardingPage() {
  const industries = await getIndustries();
  return <OnboardingForm industries={industries} />;
}
```

- [ ] **Step 3: Replace `app/page.tsx` with a redirect**

```tsx
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/onboarding");
}
```

- [ ] **Step 4: Manual verification**

```bash
npm run dev
```

1. Open `http://localhost:3000/` — expect immediate redirect to `/onboarding`.
2. On `/onboarding`, expect 4 industry options: "Торговля", "Логистика", "Социальная
   сфера", "Другое".
3. Select "Торговля" — expect a second card to appear with facility type "Склад".
4. Select "Склад", click "Перейти к сравнению решений" — expect navigation to
   `/compare/warehouse`.

Stop the dev server after verifying (Ctrl+C).

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx "app/(app)/onboarding" components/onboarding-form.tsx
git commit -m "Add Step 1: industry and facility type picker"
```

---

### Task 7: Step 2 — solution catalog / comparison

**Files:**
- Create: `app/(app)/compare/[type]/page.tsx`

**Interfaces:**
- Consumes: `getCatalogForFacilityType` from `lib/db/queries.ts`; `Card`/`CardHeader`/
  `CardTitle`/`CardContent` from `@/components/ui/card`.
- Produces: route `/compare/[type]`.

- [ ] **Step 1: Create `app/(app)/compare/[type]/page.tsx`**

```tsx
import { notFound } from "next/navigation";
import { getCatalogForFacilityType } from "@/lib/db/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function ComparePage({
  params,
}: {
  params: Promise<{ type: string }>;
}) {
  const { type } = await params;
  const catalog = await getCatalogForFacilityType(type);

  if (!catalog) {
    notFound();
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 py-12">
      <h1 className="text-2xl font-semibold">
        Решения для объекта: {catalog.name} ({catalog.industry.name})
      </h1>

      {catalog.solutionCategories.map((category) => (
        <section key={category.id} className="flex flex-col gap-4">
          <h2 className="text-xl font-medium">{category.name}</h2>
          <p className="text-sm text-muted-foreground">{category.description}</p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {category.solutions.map((solution) => (
              <Card key={solution.id}>
                <CardHeader>
                  <CardTitle>{solution.name}</CardTitle>
                  <p className="text-sm text-muted-foreground">{solution.vendor}</p>
                </CardHeader>
                <CardContent className="flex flex-col gap-1 text-sm">
                  <div>Цена: ${solution.priceUsd.toLocaleString()}</div>
                  <div>
                    Производительность: {solution.capacityPerUnit} {solution.capacityUnit}
                  </div>
                  <div>
                    Обслуживание/год: ${solution.maintenanceUsdYear.toLocaleString()}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Manual verification**

```bash
npm run dev
```

1. Visit `http://localhost:3000/compare/warehouse` — expect heading "Решения для
   объекта: Склад (Торговля)", 2 category sections, each with 2 solution cards showing
   name, vendor, price, capacity, maintenance.
2. Visit `/compare/airport`, `/compare/medical`, `/compare/other` — each should render
   its own categories/solutions from the seed data.
3. Visit `http://localhost:3000/compare/does-not-exist` — expect Next.js's 404 page.

Stop the dev server after verifying (Ctrl+C).

- [ ] **Step 3: Commit**

```bash
git add "app/(app)/compare"
git commit -m "Add Step 2: solution catalog and comparison page"
```

---

## Definition of done

- [ ] `npm run build` succeeds.
- [ ] `npm test` passes (3 tests from Task 5).
- [ ] `npm run dev` → `/` redirects to `/onboarding` → pick any of the 4 industries →
  pick a facility type → land on `/compare/[type]` showing real seeded solutions.
- [ ] All 7 tasks committed individually (7+ commits since Task 1's initial scaffold
  commit).
- [ ] `CHANGELOG.md` updated with a summary of what this plan added (do this as a final
  step after Task 7, one commit).
