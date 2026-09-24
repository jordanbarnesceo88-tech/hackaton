import { DEFAULT_NORMS, resolveNorms, type NormValues } from "../norms";
import { PROCESS_DEFS, type ProcessDef } from "../processes";
import type { ParamValues, ProductForCalc, ScenarioSpec } from "../types";
import type { CycleInfo, ScenarioContext } from "./context";

/**
 * Фикстуры движка экономики: базовые значения склада из датасета организатора и три продукта
 * с характеристиками из каталога организатора, «Примеров решений» и проверенных открытых
 * источников. Используются тестами экономики и эталоном сборки модели (T2.2); в расчёт
 * проекта не попадают — там продукты приходят из каталога (T1.1).
 *
 * Полнота карточки и доля подтверждённых значений (completenessPct, confirmedSharePct) здесь —
 * условные значения фикстуры для проверки правил риска, а не посчитанные по каталогу: в
 * проекте их считает генератор данных организатора по 31 обязательному ключу.
 */

/**
 * Базовые значения параметров склада — литералы датасета организатора («Датасеты_хакатон.xlsx ›
 * Склад», 2026-09-22) — плюс наши дополнения,
 * которых в датасете нет: внутренние перемещения (0 — не учитываются), ворота приёмки и
 * отгрузки, температурный режим и верхний ярус (потолок − 1 м).
 */
export const WAREHOUSE_BASE_PARAMS: Readonly<ParamValues> = Object.freeze({
  totalAreaM2: 20_000,
  activeAreaM2: 10_000,
  storageCeilingHeightM: 10,
  floorsCount: 1,
  mainAisleWidthM: 3.5,
  rackAisleWidthM: 2.8,
  floorType: "Промышленный бетон",
  shiftsPerDay: 2,
  workDaysPerYear: 365,
  shiftDurationH: 11,
  peakFactor: 1.5,
  inboundPalletsPerDay: 1000,
  outboundPalletsPerDay: 1000,
  pickLinesPerDay: 100_000,
  pickUnitsPerDay: 150_000,
  piecePickSharePct: 30,
  totalStaff: 180,
  pickersCount: 100,
  forkliftOperatorsCount: 25,
  packingOperatorsCount: 20,
  pickerSalaryRubMonth: 100_000,
  forkliftSalaryRubMonth: 120_000,
  payrollTaxMultiplier: 1.302,
  rackType: "Фронтальные паллетные",
  palletPositions: 20_000,
  avgPalletMassKg: 800,
  nonStandardCargoPct: 5,
  availablePowerKw: 500,
  hasWms: "Да",
  capexBudgetMRub: 80,
  horizonYears: 5,
  // Дополнения (в датасете нет; см. PARAM_EXTRAS в данных организатора).
  internalPalletMovesPerDay: 0,
  receivingDocksCount: 4,
  shippingDocksCount: 4,
  storageTempRegime: "Нормальный (+5…+25 °C)",
  maxStorageLevelM: 9,
});

/** Диапазоны организатора (min–max датасета) для параметров, которые двигает чувствительность. */
export const FIXTURE_PARAM_BOUNDS: Readonly<Record<string, { min: number; max: number }>> = Object.freeze({
  forkliftSalaryRubMonth: { min: 80_000, max: 170_000 },
  forkliftOperatorsCount: { min: 5, max: 80 },
  peakFactor: { min: 1.2, max: 2.5 },
  horizonYears: { min: 3, max: 10 },
  inboundPalletsPerDay: { min: 500, max: 5000 },
  outboundPalletsPerDay: { min: 500, max: 5000 },
});

const RONAVI_TCO_URL = "https://ronavi-robotics.ru/media/tpost/l8s0fty3m1-kak-schitat-stoimost-vladeniya-tco-logis";

/**
 * Ronavi H1500 — подъёмный паллетный AMR. Цена 2 700 000 ₽ — каталог организатора; норма
 * 80–100 паллет/ч (типичное 90), 1500 кг, 1,5 м/с, 6 ч работы, 18 мин зарядки — «Примеры
 * решений» организатора. Сервис ≈300 000 ₽/год, внедрение 0,5–2 млн ₽ — статья Ronavi о TCO;
 * ПО 1 млн ₽ за установку — тарифы Ronavi; RaaS «от 100 000 ₽/мес» — robotrends.ru.
 * Срок службы 10 лет в своде без публичного источника, поэтому здесь не задан (норматив 7 лет).
 */
export const FIXTURE_H1500: ProductForCalc = {
  slug: "ronavi-h1500",
  name: "Ronavi H1500",
  manufacturer: "ООО «Ронави Роботикс»",
  solutionType: "pallet-amr",
  handlingClass: "jacking",
  mobile: true,
  status: "operation",
  level: "enriched",
  flags: ["duplicate-merged"],
  excluded: false,
  excludedReason: null,
  processes: ["pallet-transport"],
  facilityTypes: ["warehouse"],
  priceRub: 2_700_000,
  priceConfirmed: true,
  priceOrigin: "organizer",
  throughputPerH: 90,
  throughputUnit: "паллет/ч",
  throughputScope: "per-robot",
  throughputQualifier: null,
  throughputConfirmed: false,
  payloadKg: 1500,
  speedMps: 1.5,
  autonomyH: 6,
  chargeMin: 18,
  minAisleM: 0.75,
  turnAisleM: null,
  liftHeightMm: null,
  tempMinC: 5,
  tempMaxC: 25,
  serviceRubYear: 300_000,
  softwareRubOneTime: 1_000_000,
  softwareRubYear: null,
  implementationRub: 1_250_000,
  trainingRub: null,
  consumablesRubYear: null,
  batteryCostRub: null,
  batteryReplacementYears: null,
  serviceLifeYears: null,
  raasRubMonth: 100_000,
  raasQualifier: "от",
  raasOrigin: "research",
  hasCases: true,
  completenessPct: 84,
  confirmedSharePct: 55,
  sources: [
    {
      key: "priceRub",
      label: "Цена оборудования",
      value: "2 700 000 ₽",
      origin: "organizer",
      sourceUrl: null,
      sourceRef: "Каталог организатора, id 5760e938-9a43-45a7-b8e8-f4f2e6383930",
      date: "2026-09-22",
      confirmed: true,
    },
    {
      key: "throughput",
      label: "Производительность",
      value: "80–100 паллет/ч",
      origin: "organizer",
      sourceUrl: null,
      sourceRef: "Примеры решений › Склад › Ronavi H1500",
      date: "2026-09-22",
      confirmed: false,
    },
    {
      key: "serviceRubYear",
      label: "Сервисное обслуживание",
      value: "≈300 000 ₽/год",
      origin: "research",
      sourceUrl: RONAVI_TCO_URL,
      sourceRef: null,
      date: "2026-09-23",
      confirmed: true,
    },
    {
      key: "softwareRubOneTime",
      label: "ПО (разово)",
      value: "1 000 000 ₽",
      origin: "research",
      sourceUrl: "https://ronavi-robotics.ru/software-information",
      sourceRef: null,
      date: "2026-09-23",
      confirmed: false,
    },
    {
      key: "implementationRub",
      label: "Внедрение и интеграция",
      value: "500 000 – 2 000 000 ₽",
      origin: "research",
      sourceUrl: RONAVI_TCO_URL,
      sourceRef: null,
      date: "2026-09-23",
      confirmed: false,
    },
    {
      key: "raasRubMonth",
      label: "Ставка RaaS (аренда)",
      value: "от 100 000 ₽/мес",
      origin: "research",
      sourceUrl: "https://robotrends.ru/robopedia/ronavi-robotics",
      sourceRef: null,
      date: "2026-09-23",
      confirmed: false,
    },
  ],
};

/**
 * DMR Carrier P (Диком) — автономный штабелёр (FMR). Цена 4 300 000 ₽ — каталог организатора
 * (дилер КИИТ: «от 4 300 000 ₽»); 40–60 паллет/ч (типичное 50), 1500 кг, 10 ч — «Примеры
 * решений»; 1,5 м/с, зарядка 2 ч — сайт производителя и дилер. Пилотная эксплуатация; ставки
 * RaaS не опубликованы.
 */
export const FIXTURE_CARRIER_P: ProductForCalc = {
  slug: "dikom-dmr-carrier-p",
  name: "DMR Carrier P",
  manufacturer: "ООО «Диком-Сервис»",
  solutionType: "fmr",
  handlingClass: "fork",
  mobile: true,
  status: "piloting",
  level: "enriched",
  flags: [],
  excluded: false,
  excludedReason: null,
  processes: ["pallet-transport", "storage"],
  facilityTypes: ["warehouse"],
  priceRub: 4_300_000,
  priceConfirmed: false,
  priceOrigin: "organizer",
  throughputPerH: 50,
  throughputUnit: "паллет/ч",
  throughputScope: "per-robot",
  throughputQualifier: null,
  throughputConfirmed: false,
  payloadKg: 1500,
  speedMps: 1.5,
  autonomyH: 10,
  chargeMin: 120,
  minAisleM: null,
  turnAisleM: null,
  liftHeightMm: 1500,
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
  completenessPct: 61,
  confirmedSharePct: 40,
  sources: [
    {
      key: "priceRub",
      label: "Цена оборудования",
      value: "4 300 000 ₽",
      origin: "organizer",
      sourceUrl: null,
      sourceRef: "Каталог организатора, id f7634ef8-0034-4c5b-b2f0-e44a14f05a76",
      date: "2026-09-22",
      confirmed: false,
    },
    {
      key: "throughput",
      label: "Производительность",
      value: "40–60 паллет/ч",
      origin: "organizer",
      sourceUrl: null,
      sourceRef: "Примеры решений › Склад › DMR Carrier P",
      date: "2026-09-22",
      confirmed: false,
    },
  ],
};

/**
 * DMR 600 (Диком) — подъёмный AMR на 600 кг. Цена 3 750 000 ₽ — каталог организатора (дилер
 * КИИТ: «от 3 750 000 ₽»); 2 м/с, 8 ч, зарядка 2 ч — производитель и дилер. Паспортной
 * производительности нет: расчёт возможен только по циклу. Для паллеты 800 кг подбор его
 * исключает (грузоподъёмность 600 кг), в экономике он нужен для проверок отказов.
 */
export const FIXTURE_DMR600: ProductForCalc = {
  slug: "dikom-dmr-600",
  name: "DMR 600",
  manufacturer: "ООО «Диком-Сервис»",
  solutionType: "pallet-amr",
  handlingClass: "jacking",
  mobile: true,
  status: "piloting",
  level: "enriched",
  flags: ["duplicate-merged"],
  excluded: false,
  excludedReason: null,
  processes: ["pallet-transport"],
  facilityTypes: ["warehouse"],
  priceRub: 3_750_000,
  priceConfirmed: false,
  priceOrigin: "organizer",
  throughputPerH: null,
  throughputUnit: null,
  throughputScope: null,
  throughputQualifier: null,
  throughputConfirmed: false,
  payloadKg: 600,
  speedMps: 2,
  autonomyH: 8,
  chargeMin: 120,
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
  hasCases: true,
  completenessPct: 55,
  confirmedSharePct: 45,
  sources: [],
};

export const FIXTURE_PRODUCTS: readonly ProductForCalc[] = [FIXTURE_H1500, FIXTURE_CARRIER_P, FIXTURE_DMR600];

/** Время захвата груза по классу погрузки (нормативы handlingSec*), с. */
function handlingSec(p: ProductForCalc, norms: NormValues): number {
  if (p.handlingClass === "fork") return norms.handlingSecFork;
  if (p.handlingClass === "tug") return norms.handlingSecTug;
  return norms.handlingSecJacking;
}

/**
 * Плечи и производительность по циклу для фикстуры. Плечо L (одинаковое с грузом и
 * порожнее) подбирается так, чтобы цикл H1500 дал ровно `cycleThr`:
 * L = (3600 / thr − 2·tзахв) / (1/v + 1/(v·kгруз)); при 20 пал./ч это ≈93,3 м. Остальные
 * мобильные продукты считаются по тому же плечу со своими скоростью и временем захвата — так
 * фикстура сохраняет общую геометрию, как в настоящей сборке модели (lib/sim/analytic).
 */
export function fixtureCycle(cycleThr: number, norms: NormValues = DEFAULT_NORMS): Record<string, CycleInfo | null> {
  const k = norms.loadedSpeedFactor;
  const v0 = FIXTURE_H1500.speedMps ?? 1.5;
  const L = Math.max(1, (3600 / cycleThr - 2 * handlingSec(FIXTURE_H1500, norms)) / (1 / v0 + 1 / (v0 * k)));
  const out: Record<string, CycleInfo | null> = {};
  for (const p of FIXTURE_PRODUCTS) {
    if (!p.mobile || p.speedMps === null) {
      out[p.slug] = null;
      continue;
    }
    const thr = p.slug === FIXTURE_H1500.slug ? cycleThr : 3600 / (L / p.speedMps + L / (p.speedMps * k) + 2 * handlingSec(p, norms));
    out[p.slug] = { thrPerH: thr, loadedM: L, emptyM: L };
  }
  return out;
}

/** Все процессы по slug. */
export function fixtureProcesses(): Record<string, ProcessDef> {
  return Object.fromEntries(PROCESS_DEFS.map((p) => [p.slug, p]));
}

/**
 * Контекст склада организатора с фикстурными продуктами. `cycleThr` — производительность
 * H1500 по циклу (эталон T1.2 подставляет 20,0 пал./ч). По умолчанию с границами
 * организатора для чувствительности.
 */
export function fixtureContext(
  cycleThr = 20,
  opts: { paramBounds?: boolean; params?: ParamValues; norms?: NormValues } = {},
): ScenarioContext {
  const norms = opts.norms ?? resolveNorms();
  return {
    facility: "warehouse",
    params: { ...WAREHOUSE_BASE_PARAMS, ...opts.params },
    norms,
    products: Object.fromEntries(FIXTURE_PRODUCTS.map((p) => [p.slug, p])),
    processes: fixtureProcesses(),
    cycle: fixtureCycle(cycleThr, norms),
    ...(opts.paramBounds === false ? {} : { paramBounds: { ...FIXTURE_PARAM_BOUNDS } }),
  };
}

/** Три сценария эталона: «Как есть», покупка H1500, услуга (RaaS) H1500. */
export function fixtureSpecs(product: ProductForCalc = FIXTURE_H1500): ScenarioSpec[] {
  return [
    { key: "asis", name: "Как есть", kind: "asis", items: [] },
    {
      key: "p1",
      name: `Покупка — ${product.name}`,
      kind: "purchase",
      items: [{ process: "pallet-transport", productSlug: product.slug }],
    },
    {
      key: "r1",
      name: `Услуга (RaaS) — ${product.name}`,
      kind: "raas",
      items: [{ process: "pallet-transport", productSlug: product.slug }],
    },
  ];
}
