import type { Origin } from "./types";

/**
 * Словарь характеристик продукта по обязательным группам ТЗ §3.3.4: идентификация, технические,
 * инфраструктурные, экономические, применимость и качество данных. Один ключ — одна строка
 * ProductCharacteristic со своим источником, датой и признаком подтверждения. По обязательным
 * ключам считается полнота карточки — она видна в каталоге и снижает балл подбора.
 */

/** Группа характеристик ТЗ §3.3.4; совпадает с enum CharGroup в схеме Prisma. */
export type CharGroup =
  | "IDENTIFICATION"
  | "TECHNICAL"
  | "INFRASTRUCTURE"
  | "ECONOMICS"
  | "APPLICABILITY"
  | "DATA_QUALITY";

/**
 * Описание ключа характеристики. `kind` подсказывает форму значения: num — одно число, range —
 * диапазон или значение с оговоркой «до/от», text — текст, list — перечень.
 */
export type CharKeyDef = {
  group: CharGroup;
  label: string;
  unit: string | null;
  kind: "num" | "range" | "text" | "list";
  /** Входит в обязательный набор ТЗ (31 ключ) и в расчёт полноты. */
  required: boolean;
};

/** Названия групп для заголовков карточки продукта, в порядке показа. */
export const CHAR_GROUP_LABELS: Readonly<Record<CharGroup, string>> = {
  IDENTIFICATION: "Идентификация",
  TECHNICAL: "Технические характеристики",
  INFRASTRUCTURE: "Требования к инфраструктуре",
  ECONOMICS: "Экономика",
  APPLICABILITY: "Применимость",
  DATA_QUALITY: "Качество данных",
};

/**
 * Все ключи характеристик. Обязательные (31) покрывают перечень ТЗ §3.3.4, необязательные
 * нужны расчёту и подбору (высота подъёма, температурный режим, ставка RaaS и т. п.).
 */
export const CHARACTERISTIC_KEYS = {
  // ——— Идентификация (6) ———
  manufacturer: { group: "IDENTIFICATION", label: "Производитель", unit: null, kind: "text", required: true },
  modelName: { group: "IDENTIFICATION", label: "Наименование (модель)", unit: null, kind: "text", required: true },
  solutionType: { group: "IDENTIFICATION", label: "Тип решения", unit: null, kind: "text", required: true },
  purpose: { group: "IDENTIFICATION", label: "Назначение", unit: null, kind: "text", required: true },
  countryOfOrigin: { group: "IDENTIFICATION", label: "Страна происхождения", unit: null, kind: "text", required: true },
  availabilityStatus: {
    group: "IDENTIFICATION",
    label: "Статус доступности",
    unit: null,
    kind: "text",
    required: true,
  },

  // ——— Технические (8 обязательных) ———
  payloadKg: { group: "TECHNICAL", label: "Грузоподъёмность", unit: "кг", kind: "num", required: true },
  dimensionsMm: { group: "TECHNICAL", label: "Габариты (Д × Ш × В)", unit: "мм", kind: "text", required: true },
  speedMps: { group: "TECHNICAL", label: "Скорость", unit: "м/с", kind: "num", required: true },
  throughput: { group: "TECHNICAL", label: "Производительность", unit: null, kind: "range", required: true },
  autonomyH: { group: "TECHNICAL", label: "Автономность", unit: "ч", kind: "range", required: true },
  positioningMm: { group: "TECHNICAL", label: "Точность позиционирования", unit: "мм", kind: "num", required: true },
  navigation: { group: "TECHNICAL", label: "Навигация", unit: null, kind: "list", required: true },
  operatingConditions: {
    group: "TECHNICAL",
    label: "Условия эксплуатации",
    unit: null,
    kind: "text",
    required: true,
  },
  massKg: { group: "TECHNICAL", label: "Собственная масса", unit: "кг", kind: "num", required: false },
  liftHeightMm: { group: "TECHNICAL", label: "Высота подъёма", unit: "мм", kind: "num", required: false },
  tempMinC: { group: "TECHNICAL", label: "Минимальная температура эксплуатации", unit: "°C", kind: "num", required: false },
  tempMaxC: { group: "TECHNICAL", label: "Максимальная температура эксплуатации", unit: "°C", kind: "num", required: false },

  // ——— Инфраструктура (5 обязательных) ———
  floorRequirements: { group: "INFRASTRUCTURE", label: "Требования к полу", unit: null, kind: "text", required: true },
  minAisleM: { group: "INFRASTRUCTURE", label: "Минимальная ширина прохода", unit: "м", kind: "num", required: true },
  chargeMin: { group: "INFRASTRUCTURE", label: "Время зарядки", unit: "мин", kind: "range", required: true },
  connectivity: { group: "INFRASTRUCTURE", label: "Связь", unit: null, kind: "list", required: true },
  integration: { group: "INFRASTRUCTURE", label: "Интеграция (WMS/ERP, API)", unit: null, kind: "list", required: true },
  turnAisleM: { group: "INFRASTRUCTURE", label: "Ширина прохода для разворота", unit: "м", kind: "num", required: false },
  robotsPerStation: {
    group: "INFRASTRUCTURE",
    label: "Роботов на зарядную станцию",
    unit: "шт.",
    kind: "num",
    required: false,
  },
  chargerPowerKw: { group: "INFRASTRUCTURE", label: "Мощность зарядной станции", unit: "кВт", kind: "num", required: false },

  // ——— Экономика (6 обязательных) ———
  priceRub: { group: "ECONOMICS", label: "Цена оборудования", unit: "₽", kind: "range", required: true },
  softwareRubOneTime: { group: "ECONOMICS", label: "ПО (разово)", unit: "₽", kind: "num", required: true },
  implementationRub: { group: "ECONOMICS", label: "Внедрение и интеграция", unit: "₽", kind: "range", required: true },
  serviceRubYear: { group: "ECONOMICS", label: "Сервисное обслуживание", unit: "₽/год", kind: "range", required: true },
  acquisitionModels: { group: "ECONOMICS", label: "Модели приобретения", unit: null, kind: "list", required: true },
  serviceLifeYears: { group: "ECONOMICS", label: "Срок службы", unit: "лет", kind: "num", required: true },
  raasRubMonth: { group: "ECONOMICS", label: "Ставка RaaS (аренда)", unit: "₽/мес", kind: "range", required: false },
  trainingRub: { group: "ECONOMICS", label: "Обучение персонала", unit: "₽", kind: "num", required: false },
  batteryCostRub: { group: "ECONOMICS", label: "Стоимость комплекта АКБ", unit: "₽", kind: "num", required: false },
  batteryReplacementYears: {
    group: "ECONOMICS",
    label: "Замена АКБ, раз в",
    unit: "лет",
    kind: "num",
    required: false,
  },
  softwareRubYear: { group: "ECONOMICS", label: "ПО (в год)", unit: "₽/год", kind: "num", required: false },
  consumablesRubYear: { group: "ECONOMICS", label: "Расходные материалы", unit: "₽/год", kind: "num", required: false },

  // ——— Применимость (3) ———
  applicability: {
    group: "APPLICABILITY",
    label: "Процессы и типы объектов",
    unit: null,
    kind: "list",
    required: true,
  },
  limitations: { group: "APPLICABILITY", label: "Ограничения", unit: null, kind: "text", required: true },
  cases: { group: "APPLICABILITY", label: "Кейсы внедрения", unit: null, kind: "text", required: true },

  // ——— Качество данных (3) ———
  primarySourceUrl: { group: "DATA_QUALITY", label: "Основной источник", unit: null, kind: "text", required: true },
  verifiedAt: { group: "DATA_QUALITY", label: "Дата проверки", unit: null, kind: "text", required: true },
  confirmation: { group: "DATA_QUALITY", label: "Подтверждение", unit: null, kind: "text", required: true },
} as const satisfies Record<string, CharKeyDef>;

/** Ключ характеристики. Выводится из словаря, поэтому опечатка в ключе не компилируется. */
export type CharKey = keyof typeof CHARACTERISTIC_KEYS;

/** Обязательные ключи ТЗ §3.3.4 в порядке словаря — знаменатель полноты карточки. */
export const REQUIRED_CHARACTERISTIC_KEYS: readonly CharKey[] = (
  Object.keys(CHARACTERISTIC_KEYS) as CharKey[]
).filter((k) => CHARACTERISTIC_KEYS[k].required);

const REQUIRED_SET: ReadonlySet<string> = new Set(REQUIRED_CHARACTERISTIC_KEYS);

/**
 * Полнота карточки продукта, %: доля заполненных обязательных характеристик из 31, округлённая
 * до целого. Необязательные и неизвестные ключи не учитываются, повторы считаются один раз.
 */
export function completenessPct(presentKeys: Iterable<string>): number {
  const present = new Set<string>();
  for (const key of presentKeys) if (REQUIRED_SET.has(key)) present.add(key);
  return Math.round((100 * present.size) / REQUIRED_CHARACTERISTIC_KEYS.length);
}

/**
 * Доля подтверждённых характеристик, %: сколько значений подтверждено первоисточником.
 * Пустой список — 0 %, а не деление на ноль.
 */
export function confirmedSharePct(chars: readonly { confirmed: boolean }[]): number {
  if (chars.length === 0) return 0;
  const confirmed = chars.filter((c) => c.confirmed).length;
  return Math.round((100 * confirmed) / chars.length);
}

const ORIGIN_LABELS: Readonly<Record<Origin, string>> = {
  organizer: "Организатор",
  research: "Открытый источник",
  estimate: "Оценка",
  derived: "Расчёт",
  choice: "Наш выбор",
  tz: "ТЗ",
  admin: "Администратор",
  user: "Задано вами",
};

/** Подпись происхождения значения для бейджа «откуда число» (ТЗ §3.5.8). */
export function originLabel(origin: Origin): string {
  return ORIGIN_LABELS[origin];
}
