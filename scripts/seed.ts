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
    { key: "areaPerCleanerPerYear", label: "Площадь на уборщика в год", value: 600000, unit: "м²/год", description: "Порядок величины (≈300 м²/час × 2000 часов), а не цитата из источника", order: 9 },
    { key: "cleaningsPerDay", label: "Уборок площади в сутки", value: 1, unit: "раз", order: 10 },
    { key: "turnoverPerDay", label: "Оборотов в сутки (для stock-решений)", value: 8, unit: "раз", order: 11 },
    { key: "roiHorizonYears", label: "Горизонт расчёта ROI", value: 5, unit: "лет", order: 12 },
    { key: "discountRate", label: "Ставка дисконтирования", value: 0.12, unit: "доля", order: 13 },
    { key: "assetLifeYears", label: "Срок службы техники", value: 7, unit: "лет", order: 14 },
    { key: "usdToRub", label: "Курс USD→RUB", value: 90, unit: "₽/$", order: 15 },
    { key: "energyCostFactor", label: "Множитель энергозатрат (регион)", value: 1.0, unit: "коэф.", order: 16 },
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
      // Норматив прокидывается через `?? null`, а не пропуском: пропуск в update оставил бы в
      // базе старое значение после того, как его убрали из источника, и снятый норматив
      // продолжил бы предзаполнять занятость цифрой, которой больше нигде нет.
      update: {
        name: c.name,
        description: c.description,
        workloadStream: c.workloadStream,
        taskLabel: c.taskLabel,
        workerOutputPerYear: c.workerOutputPerYear ?? null,
        workerOutputSourceUrl: c.workerOutputSourceUrl ?? null,
      },
      create: {
        slug: c.slug,
        name: c.name,
        description: c.description,
        workloadStream: c.workloadStream,
        taskLabel: c.taskLabel,
        workerOutputPerYear: c.workerOutputPerYear ?? null,
        workerOutputSourceUrl: c.workerOutputSourceUrl ?? null,
      },
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
      sourceUrl: sol.sourceUrl,
      lastVerified: new Date(sol.lastVerified),
      // Цена берётся у дистрибьютора и потому всегда оценка: производители прайс не публикуют.
      priceEstimated: true,
      priceBasis: `цена по странице дистрибьютора, проверена ${sol.lastVerified}`,
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

  // Строки, которых больше нет ни в одном источнике сева, удаляются — иначе upsert их
  // сохраняет вечно, и удалённые из кода заглушки продолжают жить в базе. Та же осторожность,
  // что и у складской чистки: решение, на которое ссылается чей-то сохранённый расчёт, не
  // трогается — FK стоит на Restrict, и попытка обернулась бы падением всего сева.
  {
    const seeded = new Set([
      ...VENDOR_SOLUTIONS.map((s) => s.name),
      ...SOLUTION_CLASSES.map((c) => c.name),
      ...WAREHOUSE_REAL.map((s) => s.name),
    ]);
    const stale = await prisma.solution.findMany({
      where: {
        source: { in: [SolutionSource.SEED, SolutionSource.PARSED] },
        name: { notIn: [...seeded] },
      },
      select: { id: true, name: true, vendor: true, _count: { select: { savedAnalyses: true } } },
    });
    const deletable = stale.filter((s) => s._count.savedAnalyses === 0);
    if (deletable.length > 0) {
      await prisma.solution.deleteMany({ where: { id: { in: deletable.map((s) => s.id) } } });
      console.log(`  удалено строк, которых больше нет в источниках: ${deletable.length}`);
    }
    for (const s of stale.filter((x) => x._count.savedAnalyses > 0)) {
      console.warn(`  оставлено "${s.name}" (${s.vendor}): на него ссылаются сохранённые расчёты`);
    }
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

    // Складская чистка удалена: общая, выше, уже удаляет любую строку, которой нет ни в одном
    // источнике сева, и делает это по имени, а не по вертикали. Складская же отбирала строки
    // «применимые к складу», и после появления сквозных категорий начала съедать законные
    // вендорские решения: Gausium лежит в категории уборки, применимой в том числе к складу,
    // в складской список не входит — и исчезал из базы на каждом севе.
  }

  // Названия-задачи: DEFAULT '' в миграции существует ради существующих строк, а не ради
  // авторов данных. Тест в seed-data проверяет ИСТОЧНИК, а не базу, и пустую строку в базе он
  // не увидит — а экран сравнения задач покажет безымянную строку.
  {
    const blank = await prisma.solutionCategory.findMany({
      where: { taskLabel: "" },
      select: { slug: true },
    });
    if (blank.length > 0) {
      throw new Error(
        `категории без названия-задачи после сева: ${blank.map((c) => c.slug).join(", ")}`
      );
    }
  }

  // Норматив без источника в базе означал бы, что предзаполнение занятости опирается на
  // цифру, происхождение которой некому показать. Правило двух концов, проверенное на базе,
  // а не только на источнике.
  {
    const orphan = await prisma.solutionCategory.findMany({
      where: { workerOutputPerYear: { not: null }, workerOutputSourceUrl: null },
      select: { slug: true },
    });
    if (orphan.length > 0) {
      throw new Error(`норматив выработки без источника: ${orphan.map((c) => c.slug).join(", ")}`);
    }
  }

  // Проверка, что сев действительно оставил в базе то, что в нём объявлено. Появилась после
  // того, как складская чистка тихо удаляла Gausium на каждом севе: сев печатал успех, строка
  // из базы исчезала, и заметно это было только при ручном запросе. Дешевле, чем ещё один
  // такой раунд.
  {
    const expected = [
      ...VENDOR_SOLUTIONS.map((s) => s.name),
      ...SOLUTION_CLASSES.map((c) => c.name),
      ...WAREHOUSE_REAL.map((s) => s.name),
    ];
    const present = new Set(
      (await prisma.solution.findMany({ select: { name: true } })).map((s) => s.name)
    );
    const missing = expected.filter((name) => !present.has(name));
    if (missing.length > 0) {
      throw new Error(
        `сев объявил решения, которых после него нет в базе: ${missing.join(", ")}. ` +
          `Скорее всего, их удалила одна из чисток выше.`
      );
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
