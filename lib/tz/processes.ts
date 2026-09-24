import type { HandlingClass } from "./types";

/**
 * Иерархия каталога ТЗ §3.3.1 «отрасль — тип объекта — процесс — тип решения — продукт»:
 * здесь заданы два средних уровня — процессы объектов и типы решений. Процесс связывает
 * параметры объекта (откуда брать спрос, персонал, ограничения) с типами решений, которые его
 * закрывают, поэтому экономика и подбор не содержат имён параметров в коде — они берут их из
 * `ProcessDef`. Сев (T2.1) переносит эти определения в таблицы Process и SolutionType.
 */

/** Slug типа объекта, для которого задана модель процессов. */
export type FacilitySlug = "warehouse" | "airport" | "medical";

/**
 * Тип решения — класс роботов с общим способом работы с грузом. `handlingClass` задаёт время
 * погрузки в цикле, `mobile` — нужны ли зарядные станции и проходы.
 */
export type SolutionTypeDef = {
  slug: string;
  name: string;
  purpose: string;
  handlingClass: HandlingClass;
  mobile: boolean;
};

/**
 * Процесс объекта: как считать спрос из параметров, какой персонал он занимает, какие
 * параметры объекта ограничивают выбор робота и какие типы решений его закрывают.
 * `calcSupported`/`simSupported` честно говорят, для каких процессов в tz-1.0.0 есть экономика
 * и имитация (остальные — прототип, ТЗ §5.7).
 */
export type ProcessDef = {
  slug: string;
  name: string;
  description: string;
  facilityTypes: string[];
  order: number;
  /** Единица суточного спроса («паллет/сут»). */
  demandUnit: string;
  /** Единица производительности робота («паллет/ч»); норма продукта идёт в расчёт только при совпадении. */
  throughputUnit: string;
  /** Формула спроса словами — для методики и отчёта. */
  demandFormula: string;
  /**
   * Как считать суточный спрос: Σ sumParams × (shareParam/100) × Π multiplierParams ×
   * (1 − excludeShareParam/100). null — спрос этого процесса в tz-1.0.0 не выражается потоком.
   */
  demand: {
    sumParams: string[];
    shareParam?: string;
    excludeShareParam?: string;
    multiplierParams?: string[];
  } | null;
  /** Параметр пикового коэффициента; null — пик не задан, расчёт по среднему потоку. */
  peakFactorParam: string | null;
  /** Параметр численности персонала процесса. */
  headcountParam: string | null;
  /** Параметр зарплаты персонала процесса, ₽/мес gross. */
  salaryParam: string | null;
  /** Параметры объекта, с которыми сравниваются характеристики продукта в подборе (ТЗ §3.4). */
  constraints: {
    /** Масса перевозимой единицы, кг — против грузоподъёмности. */
    payloadParam?: string;
    /** Ширина рабочих проходов, м — против минимальной ширины прохода и разворота. */
    aisleParam?: string;
    /** Ширина главных проездов, м. */
    mainAisleParam?: string;
    /** Температурный режим хранения (перечисление). */
    tempRegimeParam?: string;
    /** Минимальная температура среды, °C (открытые площадки). */
    tempMinParam?: string;
    /** Высота верхнего яруса, м — против высоты подъёма. */
    heightParam?: string;
  };
  calcSupported: boolean;
  simSupported: boolean;
  /** Slug'и типов решений, которые закрывают процесс. */
  solutionTypes: string[];
};

/** Типы решений. Slug'и используются в каталоге (ProductSeed.solutionType) и в таблице SolutionType. */
export const SOLUTION_TYPE_DEFS: readonly SolutionTypeDef[] = [
  {
    slug: "pallet-amr",
    name: "AMR паллетный (подъёмный)",
    purpose: "Горизонтальная перевозка паллет: подъезжает под паллету и поднимает её платформой",
    handlingClass: "jacking",
    mobile: true,
  },
  {
    slug: "fmr",
    name: "Автономный штабелёр (FMR)",
    purpose: "Перевозка паллет вилами с подъёмом на ярус стеллажа",
    handlingClass: "fork",
    mobile: true,
  },
  {
    slug: "pallet-shuttle",
    name: "Паллетный шаттл",
    purpose: "Перемещение паллет внутри каналов глубинного стеллажа",
    handlingClass: "station",
    mobile: false,
  },
  {
    slug: "pallet-asrs",
    name: "Кран-штабелёр AS/RS",
    purpose: "Автоматизированное высотное хранение и выдача паллет",
    handlingClass: "station",
    mobile: false,
  },
  {
    slug: "tote-amr",
    name: "AMR для ящиков и тележек",
    purpose: "Перевозка ящиков, коробов и тележек между зонами",
    handlingClass: "jacking",
    mobile: true,
  },
  {
    slug: "g2p",
    name: "Товар к человеку",
    purpose: "Доставка ячеек с товаром к станции отбора вместо обхода стеллажей",
    handlingClass: "station",
    mobile: false,
  },
  {
    slug: "sorter",
    name: "Сортировочный робот",
    purpose: "Сортировка отправлений по направлениям",
    handlingClass: "jacking",
    mobile: true,
  },
  {
    slug: "inventory",
    name: "Робот-инвентаризатор",
    purpose: "Сканирование стеллажей и сверка остатков",
    handlingClass: "other",
    mobile: true,
  },
  {
    slug: "cleaner",
    name: "Робот-уборщик",
    purpose: "Уборка полов и площадей",
    handlingClass: "cleaner",
    mobile: true,
  },
  {
    slug: "tug",
    name: "Тягач",
    purpose: "Буксировка тележек и прицепов по маршруту",
    handlingClass: "tug",
    mobile: true,
  },
  {
    slug: "yard",
    name: "Беспилотный грузовик двора",
    purpose: "Перевозка грузов по открытой территории объекта",
    handlingClass: "tug",
    mobile: true,
  },
  {
    slug: "patrol",
    name: "Патрульный робот",
    purpose: "Обход территории, видеонаблюдение и охрана",
    handlingClass: "other",
    mobile: true,
  },
  {
    slug: "delivery",
    name: "Робот-доставщик в помещениях",
    purpose: "Доставка небольших грузов внутри здания",
    handlingClass: "other",
    mobile: true,
  },
  {
    slug: "other",
    name: "Прочее",
    purpose: "Решения, не отнесённые к перечисленным типам",
    handlingClass: "other",
    mobile: true,
  },
];

/**
 * Процессы трёх базовых типов объектов. Экономика и имитация в tz-1.0.0 реализованы только для
 * перемещения паллет на складе; остальные процессы показываются на уровне подбора, параметров
 * и доступных решений (ТЗ §5.5). Имена параметров — ключи ParamSpec из данных организатора.
 */
export const PROCESS_DEFS: readonly ProcessDef[] = [
  // ——— Склад ———
  {
    slug: "pallet-transport",
    name: "Перемещение паллет: приёмка → хранение → отгрузка",
    description:
      "Горизонтальная перевозка паллет от ворот приёмки в зону хранения и из хранения к воротам " +
      "отгрузки — работа, которую сейчас выполняют водители погрузчиков.",
    facilityTypes: ["warehouse"],
    order: 1,
    demandUnit: "паллет/сут",
    throughputUnit: "паллет/ч",
    demandFormula: "(приёмка + отгрузка + внутренние перемещения) × (1 − доля негабарита)",
    demand: {
      sumParams: ["inboundPalletsPerDay", "outboundPalletsPerDay", "internalPalletMovesPerDay"],
      excludeShareParam: "nonStandardCargoPct",
    },
    peakFactorParam: "peakFactor",
    headcountParam: "forkliftOperatorsCount",
    salaryParam: "forkliftSalaryRubMonth",
    constraints: {
      payloadParam: "avgPalletMassKg",
      aisleParam: "rackAisleWidthM",
      mainAisleParam: "mainAisleWidthM",
      tempRegimeParam: "storageTempRegime",
      heightParam: "maxStorageLevelM",
    },
    calcSupported: true,
    simSupported: true,
    solutionTypes: ["pallet-amr", "fmr", "pallet-shuttle", "pallet-asrs", "tug"],
  },
  {
    slug: "storage",
    name: "Автоматизированное хранение",
    description:
      "Хранение паллет в автоматизированных стеллажах (шаттлы, краны-штабелёры). Определяется " +
      "ёмкостью и высотой здания, а не суточным потоком.",
    facilityTypes: ["warehouse"],
    order: 2,
    demandUnit: "паллетомест",
    throughputUnit: "паллет/ч",
    demandFormula: "ёмкость хранения (паллетоместа) — в tz-1.0.0 не рассчитывается",
    demand: null,
    peakFactorParam: null,
    headcountParam: null,
    salaryParam: null,
    constraints: {
      payloadParam: "avgPalletMassKg",
      tempRegimeParam: "storageTempRegime",
      heightParam: "maxStorageLevelM",
    },
    calcSupported: false,
    simSupported: false,
    solutionTypes: ["pallet-shuttle", "pallet-asrs", "fmr"],
  },
  {
    slug: "piece-picking",
    name: "Штучный отбор (товар к человеку)",
    description:
      "Отбор мелкоштучного товара: вместо обхода стеллажей отборщиком товар доставляется к " +
      "станции отбора.",
    facilityTypes: ["warehouse"],
    order: 3,
    demandUnit: "строк/сут",
    throughputUnit: "строк/ч",
    demandFormula: "строки отбора × доля мелкоштучного отбора",
    demand: { sumParams: ["pickLinesPerDay"], shareParam: "piecePickSharePct" },
    peakFactorParam: "peakFactor",
    headcountParam: "pickersCount",
    salaryParam: "pickerSalaryRubMonth",
    constraints: { payloadParam: "avgUnitMassKg", tempRegimeParam: "storageTempRegime" },
    calcSupported: false,
    simSupported: false,
    solutionTypes: ["g2p", "tote-amr"],
  },
  {
    slug: "sorting",
    name: "Сортировка",
    description: "Сортировка отобранных единиц по заказам и направлениям отгрузки.",
    facilityTypes: ["warehouse"],
    order: 4,
    demandUnit: "шт./сут",
    throughputUnit: "шт./ч",
    demandFormula: "штук отбора в сутки",
    demand: { sumParams: ["pickUnitsPerDay"] },
    peakFactorParam: "peakFactor",
    headcountParam: null,
    salaryParam: null,
    constraints: { payloadParam: "avgUnitMassKg" },
    calcSupported: false,
    simSupported: false,
    solutionTypes: ["sorter"],
  },
  {
    slug: "inventory",
    name: "Инвентаризация",
    description: "Сканирование стеллажей и сверка фактических остатков с учётной системой.",
    facilityTypes: ["warehouse"],
    order: 5,
    demandUnit: "паллетомест/год",
    throughputUnit: "паллетомест/ч",
    demandFormula: "паллетоместа × инвентаризаций в год — в tz-1.0.0 не рассчитывается",
    demand: null,
    peakFactorParam: null,
    headcountParam: null,
    salaryParam: null,
    constraints: { aisleParam: "rackAisleWidthM", heightParam: "maxStorageLevelM" },
    calcSupported: false,
    simSupported: false,
    solutionTypes: ["inventory"],
  },
  {
    slug: "cleaning",
    name: "Уборка склада",
    description: "Регулярная уборка полов в активной зоне склада.",
    facilityTypes: ["warehouse"],
    order: 6,
    demandUnit: "м²/сут",
    throughputUnit: "м²/ч",
    demandFormula: "площадь уборки × уборок в сутки",
    demand: { sumParams: ["cleaningAreaM2"], multiplierParams: ["cleaningsPerDay"] },
    peakFactorParam: null,
    headcountParam: "cleanersCount",
    salaryParam: "cleanerSalaryRubMonth",
    constraints: { aisleParam: "rackAisleWidthM" },
    calcSupported: false,
    simSupported: false,
    solutionTypes: ["cleaner"],
  },

  // ——— Аэропорт ———
  {
    slug: "baggage-transport",
    name: "Перемещение багажа",
    description: "Доставка багажа между зоной сортировки и местами стоянки воздушных судов.",
    facilityTypes: ["airport"],
    order: 1,
    demandUnit: "ед./сут",
    throughputUnit: "ед./ч",
    demandFormula: "единиц багажа в сутки",
    demand: { sumParams: ["baggagePerDay"] },
    peakFactorParam: null,
    headcountParam: "rampStaffCount",
    salaryParam: "rampSalaryRubMonth",
    constraints: { payloadParam: "avgBaggageKg" },
    calcSupported: false,
    simSupported: false,
    solutionTypes: ["tug"],
  },
  {
    slug: "apron-towing",
    name: "Буксировка на перроне",
    description: "Буксировка тележек и оборудования по перрону в любую погоду.",
    facilityTypes: ["airport"],
    order: 2,
    demandUnit: "операций/сут",
    throughputUnit: "операций/ч",
    demandFormula: "операции наземного обслуживания — в tz-1.0.0 не рассчитывается",
    demand: null,
    peakFactorParam: null,
    headcountParam: "rampStaffCount",
    salaryParam: "rampSalaryRubMonth",
    constraints: { tempMinParam: "apronWinterMinTempC" },
    calcSupported: false,
    simSupported: false,
    solutionTypes: ["tug", "yard"],
  },
  {
    slug: "terminal-cleaning",
    name: "Уборка терминала",
    description: "Уборка пассажирских зон терминала, доступных роботам.",
    facilityTypes: ["airport"],
    order: 3,
    demandUnit: "м²/сут",
    throughputUnit: "м²/ч",
    demandFormula: "площадь, доступная для роботизированной уборки",
    demand: { sumParams: ["robotCleanableAreaM2"] },
    peakFactorParam: null,
    headcountParam: "terminalStaffCount",
    salaryParam: "terminalCleanerSalaryRubMonth",
    constraints: {},
    calcSupported: false,
    simSupported: false,
    solutionTypes: ["cleaner"],
  },
  {
    slug: "patrol",
    name: "Патрулирование",
    description: "Обход территории и зон безопасности с видеонаблюдением.",
    facilityTypes: ["airport"],
    order: 4,
    demandUnit: "обходов/сут",
    throughputUnit: "обходов/ч",
    demandFormula: "обходы зон безопасности — в tz-1.0.0 не рассчитывается",
    demand: null,
    peakFactorParam: null,
    headcountParam: null,
    salaryParam: null,
    constraints: { tempMinParam: "apronWinterMinTempC" },
    calcSupported: false,
    simSupported: false,
    solutionTypes: ["patrol"],
  },

  // ——— Медучреждение ———
  {
    slug: "hospital-delivery",
    name: "Внутрибольничная доставка",
    description:
      "Доставка лекарств, расходных материалов и результатов анализов между аптекой, " +
      "лабораториями и отделениями.",
    facilityTypes: ["medical"],
    order: 1,
    demandUnit: "рейсов/сут",
    throughputUnit: "рейсов/ч",
    demandFormula: "заявки на лекарства + рейсы с расходниками + рейсы с результатами анализов",
    demand: { sumParams: ["drugRequestsPerDay", "suppliesTripsPerDay", "labResultTripsPerDay"] },
    peakFactorParam: null,
    headcountParam: "orderliesCount",
    salaryParam: "orderlySalaryRubMonth",
    constraints: { payloadParam: "mealTrolleyMassKg", aisleParam: "corridorWidthM" },
    calcSupported: false,
    simSupported: false,
    solutionTypes: ["delivery", "tote-amr", "tug"],
  },
  {
    slug: "hospital-cleaning",
    name: "Уборка помещений",
    description: "Уборка коридоров и общих помещений медучреждения.",
    facilityTypes: ["medical"],
    order: 2,
    demandUnit: "м²/сут",
    throughputUnit: "м²/ч",
    demandFormula: "общая площадь",
    demand: { sumParams: ["totalAreaM2"] },
    peakFactorParam: null,
    headcountParam: null,
    salaryParam: null,
    constraints: { aisleParam: "corridorWidthM" },
    calcSupported: false,
    simSupported: false,
    solutionTypes: ["cleaner"],
  },
  {
    slug: "disinfection",
    name: "Дезинфекция",
    description: "Обработка помещений и маршрутов роботами-дезинфекторами.",
    facilityTypes: ["medical"],
    order: 3,
    demandUnit: "м²/сут",
    throughputUnit: "м²/ч",
    demandFormula: "площадь обработки — в tz-1.0.0 не рассчитывается",
    demand: null,
    peakFactorParam: null,
    headcountParam: null,
    salaryParam: null,
    constraints: { aisleParam: "corridorWidthM" },
    calcSupported: false,
    simSupported: false,
    solutionTypes: ["cleaner", "other"],
  },
];

/**
 * Процессы каждого базового типа объекта в порядке показа. Выведено из PROCESS_DEFS, чтобы
 * список и принадлежность процесса объекту не могли разойтись.
 */
export const FACILITY_PROCESSES: Readonly<Record<FacilitySlug, readonly string[]>> = {
  warehouse: processesOf("warehouse"),
  airport: processesOf("airport"),
  medical: processesOf("medical"),
};

function processesOf(facility: FacilitySlug): string[] {
  return PROCESS_DEFS.filter((p) => p.facilityTypes.includes(facility))
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((p) => p.slug);
}

const PROCESS_BY_SLUG: ReadonlyMap<string, ProcessDef> = new Map(PROCESS_DEFS.map((p) => [p.slug, p]));
const SOLUTION_TYPE_BY_SLUG: ReadonlyMap<string, SolutionTypeDef> = new Map(
  SOLUTION_TYPE_DEFS.map((s) => [s.slug, s]),
);

/** Проверяет, что строка из URL или БД — один из трёх базовых типов объектов модели. */
export function isFacilitySlug(slug: string): slug is FacilitySlug {
  return slug === "warehouse" || slug === "airport" || slug === "medical";
}

/**
 * Определения процессов объекта в порядке показа; для неизвестного типа объекта — пустой
 * список (а не исключение): страница покажет «процессы для этого типа не описаны».
 */
export function processesForFacility(facility: string): ProcessDef[] {
  if (!isFacilitySlug(facility)) return [];
  return FACILITY_PROCESSES[facility].map((slug) => PROCESS_BY_SLUG.get(slug)).filter((p) => p !== undefined);
}

/** Определение процесса по slug; undefined — такого процесса нет (строка из БД или URL). */
export function processDef(slug: string): ProcessDef | undefined {
  return PROCESS_BY_SLUG.get(slug);
}

/** Определение типа решения по slug; undefined — такого типа нет. */
export function solutionTypeDef(slug: string): SolutionTypeDef | undefined {
  return SOLUTION_TYPE_BY_SLUG.get(slug);
}
