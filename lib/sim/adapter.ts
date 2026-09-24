import { normDef, type NormKey, type NormValues } from "../tz/norms";
import type { HandlingClass, Origin, ParamSpec, ParamValues, ProductForCalc } from "../tz/types";
import { SIM_LIMITS, chargeThresholdsValid, expectedTasks } from "./engine";
import { LAYOUT_ASSUMPTIONS, LAYOUT_LIMITS } from "./layout";
import { SIM_MODEL_VERSION, type SimInput } from "./types";

/**
 * Адаптер: параметры проекта + снимок продукта + парк из расчёта экономики → вход имитации.
 * Заодно собирает «Откуда параметры» — происхождение каждого числа, с которым запускается
 * имитация (ТЗ §3.5.8: источники и допущения видны в интерфейсе и отчёте).
 *
 * Если чего-то не хватает, адаптер не подставляет ноль и не выдумывает значение, а возвращает
 * отказ со списком недостающих полей: интерфейс показывает, что заполнить.
 */

/** Строка «Откуда параметры»: поле, подпись, значение, единица и происхождение. */
export type SimProvenance = {
  field: string;
  label: string;
  value: number | string | null;
  unit: string | null;
  origin: Origin;
  /** Пояснение: обоснование оценки, источник или почему значение не задано. */
  note?: string;
};

/** Вход адаптера. */
export type ToSimInputArgs = {
  /** Параметры объекта проекта (ключи ParamSpec склада). */
  params: ParamValues;
  /** Снимок продукта, который закрывает процесс в сценарии. */
  product: ProductForCalc;
  /** Число роботов (N из расчёта или ручное). */
  fleet: number;
  /** Число зарядных станций (C из расчёта). */
  chargers: number;
  /** Пиковый поток заданий, ед./ч (λpk). */
  peakPerH: number;
  /** Средний поток заданий, ед./ч (λavg) — для прогрева. */
  avgPerH: number;
  /** Нормативы расчёта (после resolveNorms). */
  norms: NormValues;
  /** Зерно генератора; по умолчанию 1. */
  seed?: number;
  /**
   * Описания параметров — для подписей и происхождения: значение, равное базовому, наследует
   * происхождение описания (организатор, оценка), иное считается заданным пользователем.
   * Без описаний все параметры помечаются как заданные пользователем.
   */
  paramSpecs?: readonly ParamSpec[];
  /** Происхождение числа роботов: derived (расчёт) по умолчанию, user — ручная правка. */
  fleetOrigin?: Origin;
};

/**
 * Причина отказа адаптера: не хватает данных; класс решения не моделируется; значения за
 * защитными пределами модели (`LAYOUT_LIMITS`, `SIM_LIMITS`).
 */
export type SimAdapterRefusal = "missing_inputs" | "not_supported" | "out_of_range";

export type ToSimInputResult =
  | {
      ok: true;
      input: SimInput;
      provenance: SimProvenance[];
      /** Загрузка, заложенная в расчёт парка, % — для сравнения с загрузкой по имитации. */
      assumedUtilPct: number;
    }
  | {
      ok: false;
      /**
       * Поля, которые нужно заполнить или исправить: ключи параметров объекта (activeAreaM2 …),
       * product.<поле> — характеристики продукта, fleet, chargers, peakPerH, avgPerH — расчёт,
       * norm.<ключ> — нормативы (пороги зарядки вне допустимого диапазона).
       */
      missing: string[];
      reason: SimAdapterRefusal;
      /** Что не так и как исправить — по-русски, для интерфейса. */
      message: string;
    };

/** Норматив времени погрузки по классу погрузки. Классы без норматива имитацией не моделируются. */
const HANDLING_NORM: Partial<Record<HandlingClass, NormKey>> = {
  jacking: "handlingSecJacking",
  fork: "handlingSecFork",
  tug: "handlingSecTug",
};

/**
 * Время захвата или постановки груза для класса погрузки, с (нормативы handlingSec*); null —
 * класс имитацией и расчётом цикла не моделируется (стационарные системы, уборщики и т. п.).
 * Экономика берёт время для `cycleThroughputPerH` отсюда же — так цикл в расчёте и в
 * имитации считается с одним и тем же временем погрузки.
 */
export function handlingSecFor(handlingClass: HandlingClass, norms: NormValues): number | null {
  const key = HANDLING_NORM[handlingClass];
  return key ? norms[key] : null;
}

/** Параметры объекта, которые читает имитация, с подписями на случай, если описаний нет. */
const PARAM_FIELDS = {
  activeAreaM2: { label: "Площадь активной (роботизируемой) зоны", unit: "м²" },
  mainAisleWidthM: { label: "Ширина главных проездов", unit: "м" },
  rackAisleWidthM: { label: "Ширина рабочих проходов между стеллажами", unit: "м" },
  receivingDocksCount: { label: "Ворота приёмки", unit: "шт." },
  shippingDocksCount: { label: "Ворота отгрузки", unit: "шт." },
  avgPalletMassKg: { label: "Средняя масса грузовой единицы (паллет)", unit: "кг" },
} as const;

type ParamField = keyof typeof PARAM_FIELDS;

/** Характеристики продукта, которые читает имитация. */
const PRODUCT_FIELDS = {
  speedMps: { label: "Скорость робота", unit: "м/с" },
  payloadKg: { label: "Грузоподъёмность", unit: "кг" },
  autonomyH: { label: "Автономность", unit: "ч" },
  chargeMin: { label: "Время зарядки (полный заряд)", unit: "мин" },
} as const;

type ProductField = keyof typeof PRODUCT_FIELDS;

/** Число из значения параметра: число или строка с десятичной запятой; иначе null. */
function readNumber(v: number | string | null | undefined): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const t = v.trim().replace(/\s/g, "").replace(",", ".");
    if (t === "") return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Пояснение к числу роботов в «Откуда параметры» — по его действительному происхождению:
 * формула — только для парка из расчёта; ручная правка и «Принять парк по имитации» — ручное
 * значение из журнала изменений. Для прочих происхождений пояснения нет: бейджа
 * происхождения достаточно, а придуманное пояснение было бы неправдой.
 */
function fleetNote(origin: Origin): string | undefined {
  if (origin === "derived") {
    return "Парк из расчёта: пиковый поток / (производительность × загрузка × доступность) × (1 + резерв)";
  }
  if (origin === "user") return "Число роботов задано вручную (журнал изменений)";
  return undefined;
}

/** Происхождение характеристики из снимка продукта. */
function productOrigin(product: ProductForCalc, key: ProductField): { origin: Origin; note?: string } {
  const src = product.sources.find((s) => s.key === key);
  if (src) {
    const where = src.sourceUrl ?? src.sourceRef;
    return { origin: src.origin, note: where ? `Источник: ${where}` : undefined };
  }
  // В снимке нет строки источника по ключу: обогащённые карточки заполнены из открытых
  // источников, «Примеры решений» и карточки каталога — из данных организатора.
  return {
    origin: product.level === "enriched" ? "research" : "organizer",
    note: "Строка источника в снимке продукта не найдена; происхождение — по уровню карточки",
  };
}

/**
 * Вход имитации для позиции сценария. Отказ `not_supported` — продукт не мобильный или его
 * класс погрузки не моделируется (стационарные системы, уборщики и т. п.): интерфейс говорит
 * «имитация для этого класса не поддерживается», а не выдаёт это за подтверждение.
 * Отказ `missing_inputs` — не хватает параметров объекта, характеристик продукта или расчёта.
 */
export function toSimInput(args: ToSimInputArgs): ToSimInputResult {
  const { params, product, norms } = args;
  const seed = args.seed ?? 1;
  const fleetOrigin = args.fleetOrigin ?? "derived";

  const handlingKey = HANDLING_NORM[product.handlingClass];
  if (!product.mobile || !handlingKey) {
    return {
      ok: false,
      missing: [],
      reason: "not_supported",
      message:
        `Имитация для «${product.name}» не поддерживается: в модели ${SIM_MODEL_VERSION} моделируется только ` +
        "перевозка паллет мобильными роботами (подъёмные AMR, вилочные роботы, тягачи).",
    };
  }

  const specByKey = new Map((args.paramSpecs ?? []).map((s) => [s.key, s]));
  const missing: string[] = [];
  const missingLabels: string[] = [];
  const need = (key: string, label: string) => {
    missing.push(key);
    missingLabels.push(label);
  };

  const paramLabel = (key: ParamField) => specByKey.get(key)?.label ?? PARAM_FIELDS[key].label;
  const num = (key: ParamField) => readNumber(params[key]);

  const area = num("activeAreaM2");
  if (area === null || area <= 0) need("activeAreaM2", paramLabel("activeAreaM2"));
  const mainAisle = num("mainAisleWidthM");
  if (mainAisle === null || mainAisle <= 0) need("mainAisleWidthM", paramLabel("mainAisleWidthM"));
  const rackAisle = num("rackAisleWidthM");
  if (rackAisle === null || rackAisle <= 0) need("rackAisleWidthM", paramLabel("rackAisleWidthM"));
  const recv = num("receivingDocksCount");
  if (recv === null || Math.round(recv) < 1) need("receivingDocksCount", paramLabel("receivingDocksCount"));
  const ship = num("shippingDocksCount");
  if (ship === null || Math.round(ship) < 1) need("shippingDocksCount", paramLabel("shippingDocksCount"));
  const mass = num("avgPalletMassKg");
  if (mass !== null && mass < 0) need("avgPalletMassKg", paramLabel("avgPalletMassKg"));

  const speed = product.speedMps;
  if (speed === null || !Number.isFinite(speed) || speed <= 0) need("product.speedMps", PRODUCT_FIELDS.speedMps.label);
  const chargeModelled =
    product.autonomyH !== null && product.autonomyH > 0 && product.chargeMin !== null && product.chargeMin > 0;

  if (!Number.isInteger(args.fleet) || args.fleet < 1) need("fleet", "Число роботов");
  if (!Number.isInteger(args.chargers) || args.chargers < 0 || (chargeModelled && args.chargers < 1)) {
    need("chargers", "Число зарядных станций");
  }
  if (!Number.isFinite(args.peakPerH) || args.peakPerH < 0) need("peakPerH", "Пиковый поток заданий");
  if (!Number.isFinite(args.avgPerH) || args.avgPerH < 0) need("avgPerH", "Средний поток заданий");

  if (missing.length > 0) {
    return {
      ok: false,
      missing,
      reason: "missing_inputs",
      message: `Для имитации не хватает данных: ${missingLabels.join(", ")}. Заполните их и пересчитайте.`,
    };
  }

  // Защитные пределы: заведомо ошибочный ввод не должен занимать сервер минутами.
  const tooBig: string[] = [];
  const tooBigLabels: string[] = [];
  const over = (key: string, label: string) => {
    tooBig.push(key);
    tooBigLabels.push(label);
  };
  if (area! > LAYOUT_LIMITS.maxActiveAreaM2) {
    over("activeAreaM2", `${paramLabel("activeAreaM2")} (не больше ${LAYOUT_LIMITS.maxActiveAreaM2} м²)`);
  }
  if (Math.round(recv!) > LAYOUT_LIMITS.maxPointsPerKind) {
    over("receivingDocksCount", `${paramLabel("receivingDocksCount")} (не больше ${LAYOUT_LIMITS.maxPointsPerKind})`);
  }
  if (Math.round(ship!) > LAYOUT_LIMITS.maxPointsPerKind) {
    over("shippingDocksCount", `${paramLabel("shippingDocksCount")} (не больше ${LAYOUT_LIMITS.maxPointsPerKind})`);
  }
  if (args.chargers > LAYOUT_LIMITS.maxPointsPerKind) {
    over("chargers", `Число зарядных станций (не больше ${LAYOUT_LIMITS.maxPointsPerKind})`);
  }
  if (args.fleet > SIM_LIMITS.maxRobots) over("fleet", `Число роботов (не больше ${SIM_LIMITS.maxRobots})`);
  // resolveNorms гарантирует допустимые пороги; проверка — от нормативов, переданных в обход него.
  if (chargeModelled && !chargeThresholdsValid({ startSoc: norms.chargeStartSoc, stopSoc: norms.chargeStopSoc })) {
    over("norm.chargeStartSoc", "Пороги ухода на зарядку и возврата (доли: 0 ≤ ухода < возврата ≤ 1)");
    tooBig.push("norm.chargeStopSoc");
  }
  const demand = {
    avgPerH: args.avgPerH,
    peakPerH: args.peakPerH,
    warmupMin: norms.simWarmupMin,
    peakMin: norms.simPeakMin,
  };
  if (expectedTasks(demand) > SIM_LIMITS.maxExpectedTasks) {
    over("peakPerH", `Пиковый поток заданий (за прогон не больше ${SIM_LIMITS.maxExpectedTasks} заданий)`);
  }
  if (tooBig.length > 0) {
    return {
      ok: false,
      missing: tooBig,
      reason: "out_of_range",
      message: `Значения вне пределов модели имитации: ${tooBigLabels.join(", ")}. Проверьте единицы измерения.`,
    };
  }

  const input: SimInput = {
    seed,
    layout: {
      activeAreaM2: area!,
      mainAisleWidthM: mainAisle!,
      rackAisleWidthM: rackAisle!,
      receivingDocksCount: Math.round(recv!),
      shippingDocksCount: Math.round(ship!),
      chargers: args.chargers,
    },
    robots: {
      count: args.fleet,
      speedMps: speed!,
      loadedSpeedFactor: norms.loadedSpeedFactor,
      handlingSec: norms[handlingKey],
      autonomyH: chargeModelled ? product.autonomyH : null,
      chargeMin: chargeModelled ? product.chargeMin : null,
      payloadKg: product.payloadKg,
    },
    demand,
    loadMassKg: mass,
    thresholds: {
      servedShareMin: norms.simServedShareMin,
      p95WaitMaxMin: norms.simP95WaitMaxMin,
      oversizedIdleShare: norms.simOversizedIdleShare,
    },
    charge: { startSoc: norms.chargeStartSoc, stopSoc: norms.chargeStopSoc },
  };

  const provenance: SimProvenance[] = [];

  for (const key of Object.keys(PARAM_FIELDS) as ParamField[]) {
    const spec = specByKey.get(key);
    const value = num(key);
    const fromSpec = spec !== undefined && value !== null && readNumber(spec.base) === value;
    provenance.push({
      field: `param:${key}`,
      label: paramLabel(key),
      value,
      unit: spec?.unit ?? PARAM_FIELDS[key].unit,
      origin: fromSpec ? spec.origin : "user",
      note:
        key === "avgPalletMassKg" && value === null
          ? "Масса не задана — проверка грузоподъёмности не выполняется"
          : fromSpec
            ? (spec.sourceRef ?? spec.basis ?? undefined)
            : undefined,
    });
  }

  for (const key of Object.keys(PRODUCT_FIELDS) as ProductField[]) {
    const value = product[key];
    const { origin, note } = productOrigin(product, key);
    const unused =
      (key === "autonomyH" || key === "chargeMin") && !chargeModelled
        ? "Нет автономности или времени зарядки — зарядка в имитации не моделируется"
        : key === "payloadKg" && value === null
          ? "Грузоподъёмность не опубликована — проверка массы не выполняется"
          : undefined;
    provenance.push({
      field: `product:${key}`,
      label: `${PRODUCT_FIELDS[key].label} (${product.name})`,
      value,
      unit: PRODUCT_FIELDS[key].unit,
      origin,
      note: unused ?? note,
    });
  }

  const normKeys: NormKey[] = [
    "loadedSpeedFactor",
    handlingKey,
    "chargeStartSoc",
    "chargeStopSoc",
    "simWarmupMin",
    "simPeakMin",
    "simServedShareMin",
    "simP95WaitMaxMin",
    "simOversizedIdleShare",
  ];
  for (const key of normKeys) {
    const def = normDef(key);
    provenance.push({
      field: `norm:${key}`,
      label: def.label,
      value: norms[key],
      unit: def.unit,
      origin: def.origin,
      note: def.basis,
    });
  }

  provenance.push(
    {
      field: "calc:fleet",
      label: "Число роботов",
      value: args.fleet,
      unit: "шт.",
      origin: fleetOrigin,
      note: fleetNote(fleetOrigin),
    },
    {
      field: "calc:chargers",
      label: "Зарядные станции",
      value: args.chargers,
      unit: "шт.",
      origin: "derived",
      note: "Из расчёта экономики по доле времени на зарядке",
    },
    {
      field: "calc:peakPerH",
      label: "Пиковый поток заданий",
      value: args.peakPerH,
      unit: "ед./ч",
      origin: "derived",
      note: "Суточный объём / часы работы × пиковый коэффициент",
    },
    {
      field: "calc:avgPerH",
      label: "Средний поток заданий (прогрев)",
      value: args.avgPerH,
      unit: "ед./ч",
      origin: "derived",
      note: "Суточный объём / часы работы",
    },
    {
      field: "layout:dockStripM",
      label: "Ширина полосы ворот приёмки и отгрузки",
      value: LAYOUT_ASSUMPTIONS.dockStripM,
      unit: "м",
      origin: "estimate",
      note: "Оценка типовой планировки: буферная зона у ворот",
    },
    {
      field: "layout:rackMarginM",
      label: "Отступ крайних стеллажных проходов от стены",
      value: LAYOUT_ASSUMPTIONS.rackMarginM,
      unit: "м",
      origin: "estimate",
      note: "Оценка типовой планировки: полоса ворот плюс проезд вдоль неё",
    },
    {
      field: "layout:rackRowDepthM",
      label: "Глубина двойного ряда стеллажей",
      value: LAYOUT_ASSUMPTIONS.rackRowDepthM,
      unit: "м",
      origin: "estimate",
      note: "Два ряда «спина к спине» по 1,2 м — длина европаллеты 1200 мм (датасет организатора)",
    },
    {
      field: "layout:chargingCornerM",
      label: "Сторона угла зарядки",
      value: LAYOUT_ASSUMPTIONS.chargingCornerM,
      unit: "м",
      origin: "estimate",
      note: "Оценка типовой планировки",
    },
    {
      field: "layout:slotPitchM",
      label: "Шаг мест хранения вдоль прохода",
      value: LAYOUT_ASSUMPTIONS.slotPitchM,
      unit: "м",
      origin: "choice",
      note: "Выбор модели: представительные точки хранения, на среднее плечо почти не влияет",
    },
    {
      field: "sim:seed",
      label: "Зерно генератора",
      value: seed,
      unit: null,
      origin: "choice",
      note: "«Перезапуск» использует то же зерно — прогон повторяется в точности",
    },
  );

  return { ok: true, input, provenance, assumedUtilPct: norms.utilization * 100 };
}
