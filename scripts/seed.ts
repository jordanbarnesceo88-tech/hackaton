// IMPORTANT: @prisma/client does NOT auto-load .env at runtime — only the Prisma CLI
// does. This script runs via `tsx scripts/seed.ts` (not `prisma db seed`), so without
// this line DATABASE_URL is undefined.
import "dotenv/config";
import { PrismaClient, SolutionSource } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { WAREHOUSE_REAL } from "./parse-sources/warehouse-real";

// Prisma 7 requires a driver adapter — `new PrismaClient()` with no adapter throws
// "A driver adapter is required to connect to your database". (Validated pattern.)
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

import { INDUSTRIES } from "./seed-data/taxonomy";
import { CATEGORIES } from "./seed-data/categories";
import { APPLICABILITY } from "./seed-data/applicability";
import { VENDOR_SOLUTIONS } from "./seed-data/vendor-solutions";
import { SOLUTION_CLASSES } from "./seed-data/solution-classes";
import { TYPICAL_PARAMS } from "./seed-data/taxonomy";


const TYPICAL_EXAMPLE_NAME = "Типовой объект";

async function main() {
  let industryCount = 0;
  let facilityTypeCount = 0;
  let categoryCount = 0;
  let solutionCount = 0;

  const assumptions = [
    { key: "laborCostPerHourUsd", label: "Стоимость труда (час)", value: 15, unit: "USD/час", order: 1 },
    { key: "hoursPerYear", label: "Рабочих часов в году (на сотрудника)", value: 2000, unit: "часов", order: 2 },
    { key: "workingDaysPerYear", label: "Рабочих дней в году", value: 250, unit: "дней", order: 3 },
    { key: "operatingHoursPerDay", label: "Часов работы объекта в сутки", value: 16, unit: "часов", order: 4 },
    { key: "installPctOfCapex", label: "Монтаж/интеграция (доля от CAPEX)", value: 0.15, unit: "доля", order: 5 },
    { key: "laborReplacementPct", label: "Замещение труда роботами", value: 0.5, unit: "доля", order: 6 },
    { key: "residualSupervisionPct", label: "Остаточный надзор персоналом", value: 0.1, unit: "доля", order: 7 },
    { key: "opsPerWorkerPerYear", label: "Операций на сотрудника в год", value: 12500, unit: "операций", order: 8 },
    { key: "turnoverPerDay", label: "Оборотов в сутки (для stock-решений)", value: 8, unit: "раз", order: 9 },
    { key: "roiHorizonYears", label: "Горизонт расчёта ROI", value: 5, unit: "лет", order: 10 },
    { key: "discountRate", label: "Ставка дисконтирования", value: 0.12, unit: "доля", order: 11 },
    { key: "assetLifeYears", label: "Срок службы техники", value: 7, unit: "лет", order: 12 },
    { key: "usdToRub", label: "Курс USD→RUB", value: 90, unit: "₽/$", order: 13 },
    { key: "energyCostFactor", label: "Множитель энергозатрат (регион)", value: 1.0, unit: "коэф.", order: 14 },
  ];
  for (const asmp of assumptions) {
    await prisma.assumption.upsert({
      where: { key: asmp.key },
      update: { label: asmp.label, value: asmp.value, unit: asmp.unit, order: asmp.order },
      create: asmp,
    });
  }

  for (const industrySeed of INDUSTRIES) {
    const industry = await prisma.industry.upsert({
      where: { slug: industrySeed.slug },
      update: { name: industrySeed.name },
      create: { slug: industrySeed.slug, name: industrySeed.name },
    });
    industryCount++;

    for (const ft of industrySeed.facilityTypes) {
      await prisma.facilityType.upsert({
        where: { slug: ft.slug },
        update: { name: ft.name, isGeneric: ft.isGeneric, industryId: industry.id },
        create: { slug: ft.slug, name: ft.name, isGeneric: ft.isGeneric, industryId: industry.id },
      });
      facilityTypeCount++;
    }
  }

  // Типовые параметры объекта: шаг ввода стартует с них, а не с пустых полей.
  for (const [slug, tp] of Object.entries(TYPICAL_PARAMS)) {
    const ft = await prisma.facilityType.findUnique({ where: { slug } });
    if (!ft) throw new Error(`Нет типа объекта ${slug} для типовых параметров`);
    const existing = await prisma.facilityExample.findFirst({
      where: { facilityTypeId: ft.id, name: TYPICAL_EXAMPLE_NAME },
    });
    if (existing) {
      await prisma.facilityExample.update({ where: { id: existing.id }, data: { params: tp } });
    } else {
      await prisma.facilityExample.create({
        data: { name: TYPICAL_EXAMPLE_NAME, facilityTypeId: ft.id, params: tp },
      });
    }
  }

  // Категории глобальны — заводятся один раз, независимо от того, скольким типам объектов
  // они служат.
  for (const c of CATEGORIES) {
    await prisma.solutionCategory.upsert({
      where: { slug: c.slug },
      update: { name: c.name, description: c.description },
      create: { slug: c.slug, name: c.name, description: c.description },
    });
    categoryCount++;
  }

  for (const link of APPLICABILITY) {
    const ft = await prisma.facilityType.findUnique({ where: { slug: link.facilityType } });
    if (!ft) throw new Error(`Нет типа объекта ${link.facilityType} для связи применимости`);
    for (const [i, categorySlug] of link.categories.entries()) {
      const category = await prisma.solutionCategory.findUnique({ where: { slug: categorySlug } });
      if (!category) throw new Error(`Нет категории ${categorySlug} для ${link.facilityType}`);
      await prisma.facilityTypeCategory.upsert({
        where: { facilityTypeId_categoryId: { facilityTypeId: ft.id, categoryId: category.id } },
        update: { order: i },
        create: { facilityTypeId: ft.id, categoryId: category.id, order: i },
      });
    }
  }

  for (const sol of VENDOR_SOLUTIONS) {
    const category = await prisma.solutionCategory.findUnique({ where: { slug: sol.categorySlug } });
    if (!category) throw new Error(`Нет категории ${sol.categorySlug} для решения ${sol.name}`);
    const data = {
      vendor: sol.vendor,
      priceUsd: sol.priceUsd,
      capacityPerUnit: sol.capacityPerUnit,
      capacityUnit: sol.capacityUnit,
      capacityBasis: sol.capacityBasis,
      maintenanceUsdYear: sol.maintenanceUsdYear,
      energyUsdYear: sol.energyUsdYear,
      licensingUsdYear: sol.licensingUsdYear,
      specs: sol.specs,
      source: SolutionSource.SEED,
    };
    await prisma.solution.upsert({
      where: { solutionCategoryId_name: { solutionCategoryId: category.id, name: sol.name } },
      update: data,
      create: { ...data, name: sol.name, solutionCategoryId: category.id },
    });
    solutionCount++;
  }

  // Классы решений: диапазоны вместо точных цифр, середина уходит в поля, которые читает
  // движок, — та же конвенция, что уже применяется к CAPEX «по середине диапазона».
  for (const c of SOLUTION_CLASSES) {
    const category = await prisma.solutionCategory.findUnique({ where: { slug: c.categorySlug } });
    if (!category) throw new Error(`Нет категории ${c.categorySlug} для класса ${c.slug}`);
    const data = {
      vendor: "—",
      isClass: true,
      priceEstimated: true,
      priceLowUsd: c.priceLowUsd,
      priceHighUsd: c.priceHighUsd,
      priceUsd: (c.priceLowUsd + c.priceHighUsd) / 2,
      priceBasis: "середина диапазона по открытым источникам",
      capacityLow: c.capacityLow,
      capacityHigh: c.capacityHigh,
      capacityPerUnit: (c.capacityLow + c.capacityHigh) / 2,
      capacityUnit: c.capacityUnit,
      capacityBasis: c.capacityBasis,
      maintenanceUsdYear: c.maintenanceUsdYear,
      energyUsdYear: c.energyUsdYear,
      licensingUsdYear: c.licensingUsdYear,
      specs: { capacitySourceUrl: c.capacitySourceUrl },
      source: SolutionSource.SEED,
      sourceUrl: c.sourceUrl,
      lastVerified: new Date(c.lastVerified),
    };
    await prisma.solution.upsert({
      where: { solutionCategoryId_name: { solutionCategoryId: category.id, name: c.name } },
      update: data,
      create: { ...data, name: c.name, solutionCategoryId: category.id },
    });
    solutionCount++;
  }

  // Real, cited warehouse products (source: PARSED) — replaces the demo warehouse rows.
  const warehouse = await prisma.facilityType.findUnique({ where: { slug: "warehouse" } });
  if (warehouse) {
    for (const s of WAREHOUSE_REAL) {
      const category = await prisma.solutionCategory.findUnique({
        where: { slug: s.categorySlug },
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

    // Prune stale demo rows: delete warehouse SEED/PARSED solutions not in the curated set.
    // Guards: skip entirely if the curated set is empty (Prisma treats `notIn: []` as "match all",
    // which would wipe the vertical); and never touch ORGANIZER data (future real imports).
    const keep = WAREHOUSE_REAL.map((s) => s.name);
    if (keep.length > 0) {
      const prunable = await prisma.solution.findMany({
        where: {
          // A category serves many facility types now, so "belongs to the warehouse" is a
          // question about the join, not about a column on the category.
          solutionCategory: { facilityTypes: { some: { facilityType: { slug: "warehouse" } } } },
          source: { in: [SolutionSource.SEED, SolutionSource.PARSED] },
          // Классы — не устаревшие демо-строки склада, а сквозной каталог: они применимы к
          // складу через join и попали бы под эту чистку, хотя она существует ради замены
          // выдуманных вендорских строк на решения с реальными источниками.
          isClass: false,
          name: { notIn: keep },
        },
        select: { id: true, name: true, _count: { select: { savedAnalyses: true } } },
      });
      // SavedAnalysis.solutionId is now a real foreign key with onDelete: Restrict, so deleting
      // a solution somebody has saved an analysis against would throw and abort the whole seed.
      // Skip those and say so: a stale demo row is a much smaller problem than either destroying
      // a user's saved analysis or leaving the reference dangling, which is what happened before
      // the constraint existed (the report then 404s with no explanation).
      const referenced = prunable.filter((s) => s._count.savedAnalyses > 0);
      const deletable = prunable.filter((s) => s._count.savedAnalyses === 0);
      if (deletable.length > 0) {
        await prisma.solution.deleteMany({ where: { id: { in: deletable.map((s) => s.id) } } });
      }
      for (const s of referenced) {
        console.warn(
          `  kept "${s.name}": ${s._count.savedAnalyses} saved analysis/analyses reference it`
        );
      }
    }
  }

  console.log(
    `Seeded ${industryCount} industries, ${facilityTypeCount} facility types, ${categoryCount} solution categories, ${solutionCount} solutions, ${assumptions.length} assumptions.`
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
