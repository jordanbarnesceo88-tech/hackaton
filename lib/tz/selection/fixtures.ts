import { completenessPct, type CharKey } from "../characteristics";
import type { ParamValues, ProductForCalc } from "../types";

/**
 * Фикстуры подбора: базовые параметры склада из датасета организатора и восемь продуктов
 * демо-набора. Это данные для тестов, а не каталог: каталог генерирует T1.1 из выгрузок
 * организатора и исследования, и его значения могут уточниться. Здесь каждое число ТТХ взято
 * из свода «Роботы_свод.xlsx» (лист «Справочник», номер строки n) или из «Примеров решений»
 * организатора; полнота карточки считается `completenessPct` по перечню заполненных ключей.
 * Доля подтверждённых характеристик (`confirmedSharePct`) — условное значение фикстуры: в
 * каталоге её считает генератор по признаку подтверждения каждой характеристики.
 */

/** Датасет организатора: «Датасеты_хакатон.xlsx › Склад», базовые значения (строки 1–42). */
const WAREHOUSE_ORGANIZER_BASE: ParamValues = {
  totalAreaM2: 20000,
  activeAreaM2: 10000,
  storageCeilingHeightM: 10,
  floorsCount: 1,
  mainAisleWidthM: 3.5,
  rackAisleWidthM: 2.8,
  floorType: "Промышленный бетон",
  floorFlatnessMmPer2m: 3,
  shiftsPerDay: 2,
  workDaysPerYear: 365,
  shiftDurationH: 11,
  peakFactor: 1.5,
  inboundPalletsPerDay: 1000,
  outboundPalletsPerDay: 1000,
  pickLinesPerDay: 100000,
  pickUnitsPerDay: 150000,
  piecePickSharePct: 30,
  activeSkuCount: 2000,
  fastMoverSkuSharePct: 20,
  totalStaff: 180,
  pickersCount: 100,
  forkliftOperatorsCount: 25,
  packingOperatorsCount: 20,
  pickerSalaryRubMonth: 100000,
  forkliftSalaryRubMonth: 120000,
  payrollTaxMultiplier: 1.302,
  pickerLinesPerHour: 150,
  workTimeLossPct: 25,
  pickRouteLengthPerLineM: 25,
  conveyorLengthM: 350,
  rackType: "Фронтальные паллетные",
  palletPositions: 20000,
  avgPalletMassKg: 800,
  avgUnitMassKg: 1.8,
  palletDimsMm: "1200×800×1600",
  unitDimsMm: "300×200×150",
  nonStandardCargoPct: 5,
  availablePowerKw: 500,
  // В датасете «Да » с пробелом; генератор T1.1 обрезает пробелы.
  hasWms: "Да",
  erpSystem: "1С:ERP",
  capexBudgetMRub: 80,
  horizonYears: 5,
};

/**
 * Дополнения к датасету, которые задаёт T1.1 (PARAM_EXTRAS): внутренних перемещений в
 * датасете нет (0), температурный режим — первый вариант перечня, верхний ярус — потолок
 * минус 1 м (формула генератора).
 */
const WAREHOUSE_EXTRAS: ParamValues = {
  internalPalletMovesPerDay: 0,
  storageTempRegime: "Нормальный (+5…+25 °C)",
  maxStorageLevelM: 9,
};

/** Базовые параметры склада для тестов подбора. */
export const WAREHOUSE_BASE_PARAMS: Readonly<ParamValues> = Object.freeze({
  ...WAREHOUSE_ORGANIZER_BASE,
  ...WAREHOUSE_EXTRAS,
});

/** Ключи идентификации, которые заполнены у каждого продукта каталога организатора. */
const IDENT: CharKey[] = ["manufacturer", "modelName", "solutionType", "purpose", "availabilityStatus"];

/** Продукт с пустыми необязательными полями — фикстура задаёт только то, что опубликовано. */
function product(p: Partial<ProductForCalc> & Pick<ProductForCalc, "slug" | "name" | "solutionType">): ProductForCalc {
  return {
    manufacturer: null,
    handlingClass: "jacking",
    mobile: true,
    status: "operation",
    level: "enriched",
    flags: [],
    excluded: false,
    excludedReason: null,
    processes: ["pallet-transport"],
    facilityTypes: ["warehouse"],
    priceRub: null,
    priceConfirmed: false,
    priceOrigin: null,
    throughputPerH: null,
    throughputUnit: null,
    throughputScope: null,
    throughputQualifier: null,
    throughputConfirmed: false,
    payloadKg: null,
    speedMps: null,
    autonomyH: null,
    chargeMin: null,
    minAisleM: null,
    turnAisleM: null,
    liftHeightMm: null,
    tempMinC: null,
    tempMaxC: null,
    serviceRubYear: null,
    softwareRubOneTime: null,
    softwareRubYear: null,
    implementationRub: null,
    trainingRub: null,
    consumablesRubYear: null,
    batteryCostRub: null,
    batteryReplacementYears: null,
    serviceLifeYears: null,
    raasRubMonth: null,
    raasQualifier: null,
    raasOrigin: null,
    hasCases: false,
    completenessPct: 0,
    confirmedSharePct: 0,
    sources: [],
    ...p,
  };
}

/**
 * Ronavi H1500 — строки свода 21 и 22 (дубль по id каталога). ТТХ из «Примеров решений»
 * организатора: 80–100 паллет/ч (в расчёт типичное 90), 1500 кг, 1,5 м/с, 6 ч, зарядка 18 мин,
 * +5…+25 °C; проход 0,75 м — производитель; сервис ≈300 000 ₽/год, RMS 1 млн ₽, внедрение
 * 0,5–2 млн ₽ (середина), аренда «от 100 000 ₽/мес» — исследование. Кейс: 48 роботов у
 * «Восток-Сервис». Цена 2 700 000 ₽ — из каталога организатора; первоисточником (производитель,
 * дилер) она не подтверждена, поэтому, как и в генераторе T1.1, `priceConfirmed: false`.
 */
const h1500 = product({
  slug: "ronavi-h1500",
  name: "Ronavi H1500",
  manufacturer: "Ронави Роботикс",
  solutionType: "pallet-amr",
  handlingClass: "jacking",
  flags: ["duplicate-merged"],
  facilityTypes: ["warehouse", "airport"],
  priceRub: 2_700_000,
  priceConfirmed: false,
  priceOrigin: "organizer",
  throughputPerH: 90,
  throughputUnit: "паллет/ч",
  throughputScope: "per-robot",
  throughputConfirmed: false,
  payloadKg: 1500,
  speedMps: 1.5,
  autonomyH: 6,
  chargeMin: 18,
  minAisleM: 0.75,
  tempMinC: 5,
  tempMaxC: 25,
  serviceRubYear: 300_000,
  softwareRubOneTime: 1_000_000,
  implementationRub: 1_250_000,
  raasRubMonth: 100_000,
  raasQualifier: "от",
  raasOrigin: "research",
  hasCases: true,
  completenessPct: completenessPct([
    ...IDENT,
    "countryOfOrigin",
    "payloadKg",
    "dimensionsMm",
    "speedMps",
    "throughput",
    "autonomyH",
    "positioningMm",
    "navigation",
    "operatingConditions",
    "floorRequirements",
    "minAisleM",
    "chargeMin",
    "connectivity",
    "integration",
    "priceRub",
    "softwareRubOneTime",
    "implementationRub",
    "serviceRubYear",
    "acquisitionModels",
    "serviceLifeYears",
    "applicability",
    "cases",
    "primarySourceUrl",
    "verifiedAt",
    "confirmation",
  ]),
  confirmedSharePct: 60,
});

/**
 * DMR Carrier P (FMR) — строка свода 58, «Примеры решений»: 40–60 паллет/ч (типичное 50),
 * 1500 кг, подъём вил до 1600 мм, 1,5 м/с, 10 ч; зарядка 2 ч — производитель. Пилот.
 */
const carrierP = product({
  slug: "dikom-dmr-carrier-p",
  name: "DMR Carrier P",
  manufacturer: "Диком-Сервис",
  solutionType: "fmr",
  handlingClass: "fork",
  status: "piloting",
  facilityTypes: ["warehouse", "airport"],
  priceRub: 4_300_000,
  priceOrigin: "organizer",
  throughputPerH: 50,
  throughputUnit: "паллет/ч",
  throughputScope: "per-robot",
  payloadKg: 1500,
  speedMps: 1.5,
  autonomyH: 10,
  chargeMin: 120,
  liftHeightMm: 1600,
  completenessPct: completenessPct([
    ...IDENT,
    "countryOfOrigin",
    "payloadKg",
    "dimensionsMm",
    "speedMps",
    "throughput",
    "autonomyH",
    "positioningMm",
    "navigation",
    "operatingConditions",
    "floorRequirements",
    "chargeMin",
    "integration",
    "priceRub",
    "acquisitionModels",
    "applicability",
    "cases",
    "primarySourceUrl",
    "verifiedAt",
    "confirmation",
  ]),
  confirmedSharePct: 40,
});

/**
 * Moros AMR 1500 — строка свода 19: 1500 кг, 1,5 м/с, 10 ч при максимальной нагрузке, зарядка
 * 120 мин и проход 0,7 м — пресса, +5…+40 °C. Производительность не опубликована. Пилот
 * (испытания в Сколково — это не внедрение у заказчика).
 */
const moros1500 = product({
  slug: "moros-amr-1500",
  name: "Moros AMR 1500",
  manufacturer: "Морос",
  solutionType: "pallet-amr",
  status: "piloting",
  priceRub: 2_200_000,
  priceOrigin: "organizer",
  payloadKg: 1500,
  speedMps: 1.5,
  autonomyH: 10,
  chargeMin: 120,
  minAisleM: 0.7,
  tempMinC: 5,
  tempMaxC: 40,
  completenessPct: completenessPct([
    ...IDENT,
    "countryOfOrigin",
    "payloadKg",
    "dimensionsMm",
    "speedMps",
    "autonomyH",
    "positioningMm",
    "navigation",
    "operatingConditions",
    "minAisleM",
    "chargeMin",
    "integration",
    "priceRub",
    "applicability",
    "cases",
    "primarySourceUrl",
    "verifiedAt",
    "confirmation",
  ]),
  confirmedSharePct: 30,
});

/**
 * Moros AMR 800 — строка свода 20: 800 кг (ровно масса паллеты датасета), 2 м/с, 14 ч при
 * максимальной нагрузке, зарядка 120 мин и проход 0,7 м — пресса, +5…+40 °C. «312 коробок/ч»
 * опубликовано для пилота из 12 роботов — это цифра парка, в расчёт не идёт. Кейс: 27 роботов
 * на складах e-commerce.
 */
const moros800 = product({
  slug: "moros-amr-800",
  name: "Moros AMR 800",
  manufacturer: "Морос",
  solutionType: "pallet-amr",
  priceRub: 1_800_000,
  priceOrigin: "organizer",
  payloadKg: 800,
  speedMps: 2,
  autonomyH: 14,
  chargeMin: 120,
  minAisleM: 0.7,
  tempMinC: 5,
  tempMaxC: 40,
  hasCases: true,
  completenessPct: completenessPct([
    ...IDENT,
    "countryOfOrigin",
    "payloadKg",
    "dimensionsMm",
    "speedMps",
    "autonomyH",
    "positioningMm",
    "navigation",
    "operatingConditions",
    "minAisleM",
    "chargeMin",
    "integration",
    "priceRub",
    "applicability",
    "cases",
    "primarySourceUrl",
    "verifiedAt",
    "confirmation",
  ]),
  confirmedSharePct: 30,
});

/**
 * DMR 600 — строки свода 16 и 17: грузоподъёмность 600 кг меньше массы паллеты 800 кг, 2 м/с,
 * 8 ч, зарядка 2 ч. Цена «от 3 750 000» подтверждена дилером КИИТ. Пилот на заводе
 * производителя.
 */
const dmr600 = product({
  slug: "dikom-dmr-600",
  name: "DMR 600",
  manufacturer: "Диком-Сервис",
  solutionType: "pallet-amr",
  status: "piloting",
  flags: ["duplicate-merged"],
  priceRub: 3_750_000,
  priceConfirmed: true,
  priceOrigin: "organizer",
  payloadKg: 600,
  speedMps: 2,
  autonomyH: 8,
  chargeMin: 120,
  completenessPct: completenessPct([
    ...IDENT,
    "countryOfOrigin",
    "payloadKg",
    "dimensionsMm",
    "speedMps",
    "autonomyH",
    "positioningMm",
    "navigation",
    "floorRequirements",
    "chargeMin",
    "integration",
    "priceRub",
    "softwareRubOneTime",
    "acquisitionModels",
    "applicability",
    "cases",
    "primarySourceUrl",
    "verifiedAt",
    "confirmation",
  ]),
  confirmedSharePct: 50,
});

/**
 * Робот-штабелёр RoboCV — строка свода 33: 1400 кг, 2 м/с, проход 1,9 м на полной скорости и
 * 2,9 м для разворота (PDF robocv.ru, 2021, конфликт в found_batch4), «до 40 паллет/ч» —
 * агрегатор (предел, а не типичное значение). Кейсы: ЦИКЛ, Knauf.
 */
const robocv = product({
  slug: "robocv-shtabeler",
  name: "RoboCV",
  manufacturer: "Робосиви",
  solutionType: "fmr",
  handlingClass: "fork",
  priceRub: 2_500_000,
  priceOrigin: "organizer",
  throughputPerH: 40,
  throughputUnit: "паллет/ч",
  throughputScope: "per-robot",
  throughputQualifier: "до",
  payloadKg: 1400,
  speedMps: 2,
  chargeMin: 120,
  minAisleM: 1.9,
  turnAisleM: 2.9,
  hasCases: true,
  completenessPct: completenessPct([
    ...IDENT,
    "countryOfOrigin",
    "payloadKg",
    "dimensionsMm",
    "speedMps",
    "throughput",
    "positioningMm",
    "navigation",
    "operatingConditions",
    "minAisleM",
    "chargeMin",
    "integration",
    "priceRub",
    "acquisitionModels",
    "applicability",
    "cases",
    "primarySourceUrl",
    "verifiedAt",
    "confirmation",
  ]),
  confirmedSharePct: 40,
});

/**
 * Ronavi RCM — строка свода 26: в каталоге организатора «НИОКР», 350 кг; страница модели у
 * производителя не найдена (решение T1.1: model-not-found, исключается).
 */
const rcm = product({
  slug: "ronavi-rcm",
  name: "Ronavi RCM",
  manufacturer: "Ронави Роботикс",
  solutionType: "pallet-amr",
  status: "rnd",
  flags: ["model-not-found"],
  excluded: true,
  excludedReason: "Модель не найдена у производителя",
  priceRub: 2_000_000,
  priceOrigin: "organizer",
  payloadKg: 350,
  completenessPct: completenessPct([...IDENT, "payloadKg", "priceRub", "applicability", "cases", "verifiedAt"]),
  confirmedSharePct: 0,
});

/**
 * Pallet Shuttle (Стелкон) — строка свода 50 и «Примеры решений»: 80–120 паллет/ч на канал
 * (типичное 100), 1500 кг; «работа в морозильных камерах до −35 °C» — производитель.
 * Производитель спорный (возможно, перепродажа), кейс не подтверждён. Цифра «на канал» в
 * расчёт парка движка экономики не идёт (`normThroughput` принимает только робот или станцию),
 * а цикла у стационарной системы нет — поэтому в перемещении паллет шаттл получает
 * «Недостаточно данных».
 */
const palletShuttle = product({
  slug: "stelkon-pallet-shuttle",
  name: "Pallet Shuttle",
  manufacturer: "Завод Стелкон",
  solutionType: "pallet-shuttle",
  handlingClass: "station",
  mobile: false,
  flags: ["manufacturer-disputed", "case-unconfirmed"],
  processes: ["pallet-transport", "storage"],
  priceRub: 7_000_000,
  priceOrigin: "organizer",
  throughputPerH: 100,
  throughputUnit: "паллет/ч",
  throughputScope: "per-channel",
  payloadKg: 1500,
  tempMinC: -35,
  hasCases: true,
  completenessPct: completenessPct([
    ...IDENT,
    "countryOfOrigin",
    "payloadKg",
    "dimensionsMm",
    "throughput",
    "navigation",
    "operatingConditions",
    "floorRequirements",
    "integration",
    "priceRub",
    "acquisitionModels",
    "applicability",
    "cases",
    "primarySourceUrl",
    "verifiedAt",
    "confirmation",
  ]),
  confirmedSharePct: 30,
});

/** Продукты демо-набора подбора по ключу. */
export const SELECTION_FIXTURES = {
  h1500,
  carrierP,
  moros1500,
  moros800,
  dmr600,
  robocv,
  rcm,
  palletShuttle,
} as const satisfies Record<string, ProductForCalc>;

/** Все восемь продуктов списком — в порядке, не совпадающем с ожидаемой выдачей. */
export const SELECTION_FIXTURE_LIST: readonly ProductForCalc[] = [
  rcm,
  moros800,
  palletShuttle,
  dmr600,
  h1500,
  robocv,
  moros1500,
  carrierP,
];
