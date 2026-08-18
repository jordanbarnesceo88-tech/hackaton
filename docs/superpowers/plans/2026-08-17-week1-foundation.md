# Week 1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Next.js app, database, and seed data, then ship Steps 1-2 of the
user flow (industry/facility-type picker → solution catalog/comparison) as working,
demoable pages.

**Architecture:** Single Next.js App Router project, TypeScript, Tailwind + shadcn/ui
for components, Postgres (local via Docker) accessed through Prisma. Server components
fetch data directly via Prisma; a small client component handles the two-step picker's
interactive state.

**Tech Stack (as actually installed — verified against `package.json`):** Next.js
**16.3.1**, React **19.2.8**, **Tailwind CSS v4** (CSS-based config in `app/globals.css`
via `@import "tailwindcss"` + `@theme` — there is NO `tailwind.config.ts`), shadcn/ui
(built on Base UI `@base-ui/react`, not Radix, on current versions), Prisma ORM,
PostgreSQL 16 (Docker Compose for local dev), Vitest for unit/integration tests. The
scaffold's `AGENTS.md` warns Next 16 differs from older Next — consult
`node_modules/next/dist/docs/` before writing Next-specific code.

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
- **Prisma 7 / local-DB realities (discovered during Task 3 — do NOT "correct" these):**
  - Postgres runs on host port **5433**, not 5432 (a pre-existing native Postgres on this
    machine holds 5432). `DATABASE_URL` in `.env`/`.env.example` is the source of truth and
    already points to 5433. Do not change it back to 5432.
  - The datasource URL lives in **`prisma.config.ts`** (root), not in `schema.prisma` —
    Prisma 7 removed inline `datasource.url`. `schema.prisma` intentionally has no `url`.
  - Runtime code connects via a **driver adapter**: `new PrismaClient({ adapter: new
    PrismaPg({ connectionString: process.env.DATABASE_URL }) })`. Plain `new
    PrismaClient()` throws under Prisma 7. Deps `@prisma/adapter-pg` + `pg` are installed.
  - `npx prisma generate` must be run to produce the client at `@prisma/client` (Prisma 7's
    `migrate dev` does not leave a usable one). It's already generated in this environment.

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

- [ ] **Step 4: Ensure `.env` is gitignored but `.env.example` is NOT**

The scaffold's `.gitignore` already ignores `.env` via the pattern `.env*` (line ~34).
That pattern ALSO ignores `.env.example`, which we DO want to commit (it documents the
required env vars and has no real secret — only a local-only dev password). Add a negation
line immediately after the `.env*` line so the example file is trackable:

```
!.env.example
```

Verify: `git check-ignore .env.example` must now print nothing (exit 1). If it still
reports the file as ignored, the negation line is missing or misordered.

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
  slug           String
  name           String
  description    String
  facilityTypeId String
  facilityType   FacilityType @relation(fields: [facilityTypeId], references: [id])
  solutions      Solution[]

  // slug is unique PER facility type, not globally: two facility types may legitimately
  // share a category slug (e.g. both a warehouse and an airport having "agv"). A global
  // @unique would collide once organizer data with repeated category names is imported.
  @@unique([facilityTypeId, slug])
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

- [ ] **Step 9: Fix the scaffold's package name**

`create-next-app` set `"name": "rrp-scaffold"` in `package.json` (carried in from the
temp scaffold directory). Change it to the real project name:

```
"name": "robotization-roi-platform",
```

- [ ] **Step 10: Commit**

```bash
git add docker-compose.yml .env.example .gitignore prisma/ package.json
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

- [ ] **Step 1: Install a TS script runner and dotenv**

`dotenv` is needed so the seed script (and, in Task 5, Vitest) can load `DATABASE_URL`
at runtime — neither runs through the Prisma CLI, which is the only thing that loads
`.env` automatically.

```bash
npm install -D tsx dotenv
```

Note: `@prisma/adapter-pg` and `pg` (the Prisma 7 driver adapter) are already installed
and committed (see commit `chore(db): sync lockfile + add Prisma 7 driver adapter deps`),
so no additional runtime deps are needed here. If for some reason they are missing, run
`npm install @prisma/adapter-pg pg`.

- [ ] **Step 1b: Generate the Prisma client**

The runtime client must be generated before any code (`seed.ts`, tests, the app) can use
it — Prisma 7's `migrate dev` does NOT leave a usable client at `@prisma/client`.

```bash
npx --yes prisma generate
```

Expected: "Generated Prisma Client (v7.x) to ./node_modules/@prisma/client".

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
// IMPORTANT: @prisma/client does NOT auto-load .env at runtime — only the Prisma CLI
// does. This script runs via `tsx scripts/seed.ts` (not `prisma db seed`), so without
// this line DATABASE_URL is undefined.
import "dotenv/config";
import { PrismaClient, SolutionSource } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Prisma 7 requires a driver adapter — `new PrismaClient()` with no adapter throws
// "A driver adapter is required to connect to your database". (Validated pattern.)
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

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
          // Category slug is unique per facility type (@@unique([facilityTypeId, slug])),
          // so the upsert key is the composite, not the bare slug.
          where: {
            facilityTypeId_slug: {
              facilityTypeId: facilityType.id,
              slug: categorySeed.slug,
            },
          },
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
    // These are integration tests against a live Postgres via Prisma. Vitest does not
    // load .env the way Next.js does, and @prisma/client reads process.env directly, so
    // load .env before any test constructs the client — otherwise DATABASE_URL is
    // undefined and PrismaClient throws.
    setupFiles: ["dotenv/config"],
  },
});
```

Note: these tests require Postgres to be up (`docker compose up -d`) and seeded
(`npm run db:seed`) first — they assert against real seeded rows, not mocks.

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
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Prisma 7 requires a driver adapter to connect (plain `new PrismaClient()` throws).
function createPrismaClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
```

Note: in the Next.js app (server components), `DATABASE_URL` is loaded by Next from
`.env` automatically. In Vitest, it's loaded by the `dotenv/config` setup file (Step 3).
The runtime client must have been generated first (`npx prisma generate`, done in Task 4
Step 1b — it persists in `node_modules` for this and later tasks).

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

> **Next.js 16 note:** this repo runs Next.js 16 (see the scaffold's `AGENTS.md`), which
> may differ from older Next in App Router / server-vs-client conventions. The code below
> uses the correct patterns for 16, but if something behaves unexpectedly, consult
> `node_modules/next/dist/docs/` per `AGENTS.md` rather than assuming Next 14 behavior.

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
- Create: `lib/format/currency.ts`, `lib/format/currency.test.ts`
- Create: `app/(app)/compare/[type]/page.tsx`

**Interfaces:**
- Consumes: `getCatalogForFacilityType` from `lib/db/queries.ts`; `Card`/`CardHeader`/
  `CardTitle`/`CardContent` from `@/components/ui/card`; `formatCost` from
  `@/lib/format/currency`.
- Produces: `formatCost(usd: number): string` (`@/lib/format/currency`); route
  `/compare/[type]`.

> **Next.js 16 note (read before writing the page):** this repo runs Next.js 16, which
> the scaffold's `AGENTS.md` warns differs from older Next. Route `params` is a Promise
> and must be `await`ed (already reflected below). If anything about App Router / server
> components behaves unexpectedly, consult `node_modules/next/dist/docs/` per `AGENTS.md`
> rather than assuming Next 14 behavior.

> **Currency (product decision):** costs are STORED in USD (`priceUsd`, etc.) but
> DISPLAYED as RUB primary with USD in parentheses, e.g. `4 050 000 ₽ (US$45 000)`.
> Formatting is centralized in `lib/format/currency.ts` with a PINNED locale so server
> and client render identical strings (a bare `.toLocaleString()` with no locale uses the
> runtime locale and can cause a React hydration mismatch). The USD→RUB rate is a
> documented constant for now; Week 2 moves it into the `Assumption` table as an
> editable value.

- [ ] **Step 1: Create `lib/format/currency.ts` (+ test)**

Write the failing test first (`lib/format/currency.test.ts`):

```typescript
import { describe, it, expect } from "vitest";
import { formatCost, USD_TO_RUB } from "./currency";

describe("formatCost", () => {
  it("shows RUB primary with USD in parentheses, using a fixed ru-RU format", () => {
    // 45000 USD at the pinned rate. Assert on the computed RUB figure so the test
    // tracks the constant rather than hardcoding a rate.
    const rub = 45000 * USD_TO_RUB;
    const result = formatCost(45000);
    expect(result).toContain("₽");
    expect(result).toContain("US$");
    // ru-RU groups thousands with a non-breaking space ( ); no fractional part.
    expect(result).toContain(Math.round(rub).toLocaleString("ru-RU"));
  });

  it("rounds to whole currency units (no kopecks/cents)", () => {
    expect(formatCost(45000)).not.toMatch(/[.,]\d{2}\b/);
  });

  it("formats zero without throwing", () => {
    expect(formatCost(0)).toContain("0");
  });
});
```

Run `npx vitest run lib/format/currency.test.ts` → expect FAIL (module not found).

Then implement `lib/format/currency.ts`:

```typescript
// USD→RUB conversion rate. Placeholder constant for Week 1; Week 2 replaces this with an
// editable value from the Assumption table (see execution plan §4 / Opus review C1-cluster).
// Update to a current rate before any live client demo.
export const USD_TO_RUB = 90;

const rubFormatter = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/**
 * Format a USD amount for display: RUB primary (converted at USD_TO_RUB), USD in parens.
 * Uses pinned locales so server and client produce byte-identical output (no hydration
 * mismatch). Example: formatCost(45000) -> "4 050 000 ₽ (US$45,000)".
 */
export function formatCost(usd: number): string {
  const rub = rubFormatter.format(usd * USD_TO_RUB);
  const usdStr = usdFormatter.format(usd);
  return `${rub} (${usdStr})`;
}
```

Run `npx vitest run lib/format/currency.test.ts` → expect PASS (3 tests).

- [ ] **Step 2: Create `app/(app)/compare/[type]/page.tsx`**

```tsx
import { notFound } from "next/navigation";
import { getCatalogForFacilityType } from "@/lib/db/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCost } from "@/lib/format/currency";

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
                  <div>Цена: {formatCost(solution.priceUsd)}</div>
                  <div>
                    Производительность: {solution.capacityPerUnit} {solution.capacityUnit}
                  </div>
                  <div>
                    Обслуживание/год: {formatCost(solution.maintenanceUsdYear)}
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

- [ ] **Step 3: Manual verification**

```bash
npm run dev
```

1. Visit `http://localhost:3000/compare/warehouse` — expect heading "Решения для
   объекта: Склад (Торговля)", 2 category sections, each with 2 solution cards showing
   name, vendor, price, capacity, maintenance. Prices show RUB primary with USD in
   parens, e.g. `4 050 000 ₽ (US$45,000)`.
2. Visit `/compare/airport`, `/compare/medical`, `/compare/other` — each should render
   its own categories/solutions from the seed data.
3. Visit `http://localhost:3000/compare/does-not-exist` — expect Next.js's 404 page.
4. Check the browser console — there must be NO React hydration-mismatch warning for the
   price strings (this is the whole point of the pinned-locale formatter).

Stop the dev server after verifying (Ctrl+C).

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/compare" lib/format
git commit -m "Add Step 2: solution catalog and comparison page"
```

---

## Definition of done

- [ ] `npm run build` succeeds.
- [ ] With Postgres up (`docker compose up -d`) and seeded (`npm run db:seed`),
  `npm test` passes (6 tests: 3 DB-query tests from Task 5 + 3 currency-format tests from
  Task 7). The DB-query tests are integration tests against a live Postgres, not mocks.
- [ ] `npm run dev` → `/` redirects to `/onboarding` → pick any of the 4 industries →
  pick a facility type → land on `/compare/[type]` showing real seeded solutions, with
  prices as RUB primary + USD in parens and no hydration warning.
- [ ] All 7 tasks committed individually (8+ commits since Task 1's initial scaffold
  commit — Task 3 now has an extra config-fix step).
- [ ] `CHANGELOG.md` updated with a summary of what this plan added (do this as a final
  step after Task 7, one commit).
