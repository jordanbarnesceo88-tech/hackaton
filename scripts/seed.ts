// IMPORTANT: @prisma/client does NOT auto-load .env at runtime — only the Prisma CLI
// does. This script runs via `tsx scripts/seed.ts` (not `prisma db seed`), so without
// this line DATABASE_URL is undefined.
import "dotenv/config";
import { PrismaClient, SolutionSource, CapacityBasis } from "@prisma/client";
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
  capacityBasis: CapacityBasis;
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
                capacityBasis: CapacityBasis.PER_HOUR_FLOW,
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
                capacityBasis: CapacityBasis.PER_HOUR_FLOW,
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
                capacityBasis: CapacityBasis.PER_DAY_FLOW,
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
                capacityBasis: CapacityBasis.PER_DAY_FLOW,
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
                capacityBasis: CapacityBasis.PER_HOUR_FLOW,
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
                capacityBasis: CapacityBasis.PER_HOUR_FLOW,
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
                capacityBasis: CapacityBasis.CONCURRENT_STOCK,
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
                capacityBasis: CapacityBasis.CONCURRENT_STOCK,
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
                capacityBasis: CapacityBasis.PER_DAY_FLOW,
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
                capacityBasis: CapacityBasis.PER_DAY_FLOW,
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
                capacityBasis: CapacityBasis.PER_DAY_FLOW,
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
                capacityBasis: CapacityBasis.PER_DAY_FLOW,
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
                capacityBasis: CapacityBasis.PER_HOUR_FLOW,
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
                capacityBasis: CapacityBasis.PER_DAY_FLOW,
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
  ];
  for (const asmp of assumptions) {
    await prisma.assumption.upsert({
      where: { key: asmp.key },
      update: { label: asmp.label, value: asmp.value, unit: asmp.unit, order: asmp.order },
      create: asmp,
    });
  }

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
              capacityBasis: solutionSeed.capacityBasis,
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
              capacityBasis: solutionSeed.capacityBasis,
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
