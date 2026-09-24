import type { SimSummaryStored } from "../sim/types";
import type { NormKey, NormValues } from "./norms";

/**
 * Контракты модели tz-1.0.0 — общий словарь для данных организатора (T1.1), экономики (T1.2),
 * подбора (T1.4), параметров (T1.5), каталога (T1.8), проектов, отчёта и API. Чистые типы, без
 * React и Prisma: их импортируют и сервер, и браузер. После волны W0 файл меняет только
 * оркестратор — параллельные задачи опираются на эти формы одновременно.
 */

// ——————————————————————————— Происхождение данных ———————————————————————————

/**
 * Откуда взялось число. ТЗ §3.5.1 запрещает недокументированные коэффициенты, §3.3.4 требует
 * источник у каждой характеристики, поэтому происхождение — обязательное поле везде, где число
 * попадает в расчёт или на экран:
 * - organizer — датасет, каталог или «Примеры решений» организатора;
 * - research — открытый источник со ссылкой;
 * - estimate — наша оценка (обязательно обоснование);
 * - derived — вычислено из других чисел (обязательна формула);
 * - choice — решение владельца модели, а не факт о мире;
 * - tz — требование ТЗ;
 * - admin — правка администратора;
 * - user — значение, заданное пользователем в проекте.
 */
export type Origin = "organizer" | "research" | "estimate" | "derived" | "choice" | "tz" | "admin" | "user";

/**
 * Тип источника — для приоритета при конфликте значений (организатор > PDF производителя >
 * сайт производителя > дилер > агрегатор > пресса) и для бейджа в интерфейсе.
 */
export type SourceType =
  | "organizer:dataset"
  | "organizer:catalog"
  | "organizer:examples"
  | "manufacturer"
  | "manufacturer-doc"
  | "dealer"
  | "aggregator"
  | "press"
  | "calc"
  | "team-estimate"
  | "admin-edit";

/**
 * К чему относится значение производительности. В расчёт парка идут только значения на один
 * робот, одну станцию или один канал; цифра «на весь парк» из кейса размер парка не задаёт.
 */
export type Scope = "per-robot" | "per-station" | "per-channel" | "per-fleet";

/**
 * Диапазон из источника: «80–100 паллет/ч», «до 10 кг», «от 100 000 ₽». `typical` — значение,
 * которое идёт в расчёт; `qualifier` сохраняет оговорку источника, потому что «до X» — это
 * предел, а не типичная производительность, а «от X» — нижняя граница цены.
 */
export type Range = {
  min?: number;
  max?: number;
  typical: number;
  qualifier?: "до" | "от" | "≈";
};

/**
 * Значение с провенансом (ТЗ §3.3.4: источник, дата и признак подтверждения у каждой
 * характеристики). Правила полноты по `origin` проверяются тестами данных:
 * organizer → `sourceRef`; research → https `sourceUrl`, `asInSource` и дата;
 * estimate/derived/choice → `basis`; derived → `formula`.
 */
export type Sourced<T> = {
  value: T;
  unit?: string;
  origin: Origin;
  sourceType: SourceType;
  /** Ссылка на первоисточник; null — источник не в сети (датасет организатора, наша оценка). */
  sourceUrl: string | null;
  /** Где именно у организатора: «Датасеты_хакатон.xlsx › Склад › стр. 16», id каталога и т. п. */
  sourceRef?: string;
  /** Дата проверки значения, YYYY-MM-DD. */
  date: string;
  /** Подтверждено первоисточником (производитель, организатор при совпадении с производителем). */
  confirmed: boolean;
  confidence?: "high" | "medium" | "low";
  /** Цитата из источника дословно — чтобы проверяющий нашёл число на странице. */
  asInSource?: string;
  /** Обоснование; обязательно для estimate, derived и choice. */
  basis?: string;
  /** Формула вывода; обязательна для derived. */
  formula?: string;
  scope?: Scope;
  /** field — значение найдено для этого поля; row — источник указан на всю строку продукта. */
  granularity?: "field" | "row";
  /** Другие найденные значения, проигравшие по приоритету источника. Показываются как «альтернативы». */
  alternatives?: Omit<Sourced<T>, "alternatives">[];
};

/** Значение характеристики продукта: число, диапазон, текст или список. */
export type CharValue = number | Range | string | string[];

/**
 * Пометки о качестве данных продукта. Любая пометка включает «требует проверки», а часть из
 * них (model-not-found, variant-unpublished, rnd-exclude) исключает продукт из подбора.
 */
export type ProductFlag =
  | "duplicate-merged"
  | "model-not-found"
  | "variant-unpublished"
  | "manufacturer-disputed"
  | "price-disputed"
  | "price-may-be-subscription"
  | "price-placeholder"
  | "case-unconfirmed"
  | "values-from-other-product"
  | "no-price"
  | "rnd-exclude";

/**
 * Глубина описания продукта: identification — только поля каталога организатора;
 * enriched — характеристики с источниками по каждому полю; examples — из «Примеров решений».
 * В расчёт идут только enriched и examples.
 */
export type ProductLevel = "identification" | "enriched" | "examples";

/** Статус продукта из каталога организатора: серийная эксплуатация, пилот, НИОКР. */
export type ProductStatus = "operation" | "piloting" | "rnd";

/**
 * Способ взаимодействия с грузом — от него зависит время погрузки в цикле (нормативы
 * handlingSec*) и применимые ограничения.
 */
export type HandlingClass = "jacking" | "fork" | "tug" | "station" | "cleaner" | "other";

/**
 * Продукт в том виде, в каком его пишет генератор данных организатора (T1.1) и читает сев
 * (T2.1). Характеристики — по ключам `CHARACTERISTIC_KEYS`, каждая со своим провенансом.
 */
export type ProductSeed = {
  slug: string;
  organizerCatalogId: string | null;
  /** Номера строк кураторского свода (после слияния дублей — несколько). */
  organizerRows: number[];
  level: ProductLevel;
  name: string;
  manufacturer: string | null;
  country: string | null;
  /** Slug из SOLUTION_TYPE_DEFS. */
  solutionType: string;
  status: ProductStatus;
  /** Slug'и процессов из PROCESS_DEFS. */
  processes: string[];
  /** Slug'и типов объектов (warehouse, airport, medical). */
  facilityTypes: string[];
  industries: string[];
  /** Описание не длиннее 200 символов. */
  description: string;
  characteristics: Record<string, Sourced<CharValue>>;
  flags: ProductFlag[];
  excludedReason: string | null;
};

/**
 * Плоский снимок продукта для расчёта. Сохраняется в `ProjectResults.productSnapshots`, чтобы
 * повторное открытие проекта воспроизводило расчёт бит-в-бит даже после обновления каталога
 * (ТЗ §3.1.5). null означает «не публикуется» — движок отказывает или берёт норматив, но не
 * подставляет ноль молча.
 */
export type ProductForCalc = {
  slug: string;
  name: string;
  manufacturer: string | null;
  solutionType: string;
  handlingClass: HandlingClass;
  mobile: boolean;
  status: ProductStatus;
  level: ProductLevel;
  flags: ProductFlag[];
  excluded: boolean;
  excludedReason: string | null;
  processes: string[];
  facilityTypes: string[];
  /** Цена за единицу, ₽. */
  priceRub: number | null;
  priceConfirmed: boolean;
  priceOrigin: Origin | null;
  /** Паспортная производительность (типичное значение диапазона). */
  throughputPerH: number | null;
  throughputUnit: string | null;
  throughputScope: Scope | null;
  throughputQualifier: "до" | "от" | "≈" | null;
  throughputConfirmed: boolean;
  payloadKg: number | null;
  speedMps: number | null;
  autonomyH: number | null;
  chargeMin: number | null;
  minAisleM: number | null;
  turnAisleM: number | null;
  liftHeightMm: number | null;
  tempMinC: number | null;
  tempMaxC: number | null;
  serviceRubYear: number | null;
  softwareRubOneTime: number | null;
  softwareRubYear: number | null;
  implementationRub: number | null;
  trainingRub: number | null;
  consumablesRubYear: number | null;
  batteryCostRub: number | null;
  batteryReplacementYears: number | null;
  serviceLifeYears: number | null;
  /** Ставка RaaS за робота в месяц, ₽. */
  raasRubMonth: number | null;
  raasQualifier: "до" | "от" | "≈" | null;
  raasOrigin: Origin | null;
  hasCases: boolean;
  completenessPct: number;
  confirmedSharePct: number;
  /** Все характеристики с источниками — для раскрытия «Откуда число» и отчёта. */
  sources: {
    key: string;
    label: string;
    value: string;
    origin: Origin;
    sourceUrl: string | null;
    sourceRef: string | null;
    date: string | null;
    confirmed: boolean;
  }[];
};

// ——————————————————————————— Параметры объекта ———————————————————————————

/** Вид поля параметра: от него зависят форма ввода, разбор файла и проверки. */
export type ParamKind = "number" | "integer" | "percent" | "enum" | "text" | "dims";

/**
 * Описание параметра объекта (ТЗ §3.2): подпись, единица, базовое значение и диапазон
 * организатора, пример и подсказка для формы, источник. Засевается в администрируемую таблицу
 * ParamDefinition (§3.1.4), поэтому поля совпадают с её колонками.
 */
export type ParamSpec = {
  key: string;
  /** Slug типа объекта: warehouse, airport, medical. */
  facility: string;
  section: string;
  label: string;
  unit: string | null;
  kind: ParamKind;
  /** Варианты для kind = 'enum'. */
  options: string[];
  base: number | string | null;
  min: number | null;
  max: number | null;
  /** min = max у организатора — значение зафиксировано и не редактируется. */
  locked: boolean;
  required: boolean;
  /** Какой пункт минимума ТЗ §3.2.1 покрывает параметр; null — не из минимума. */
  tzMinimum: string | null;
  /** Где используется: fleet, labour, constraints, visualization, economics. */
  usedBy: string[];
  hint: string;
  /** Пример ввода для поля («например, 1 000»). */
  example: string;
  /** Примечание организатора из датасета дословно. */
  organizerNote: string | null;
  origin: Origin;
  sourceRef: string | null;
  sourceUrl: string | null;
  basis: string | null;
  formula: string | null;
  order: number;
};

/** Значения параметров проекта по ключам ParamSpec. null — не задано. */
export type ParamValues = Record<string, number | string | null>;

/** Код проблемы проверки параметров (ручной ввод и загрузка Excel/CSV, ТЗ §3.2). */
export type ParamIssueCode =
  | "missing_required"
  | "wrong_type"
  | "bad_number_format"
  | "out_of_range"
  | "locked_changed"
  | "unknown_key"
  | "duplicate_key"
  | "unit_mismatch"
  | "negative"
  | "not_integer"
  | "bad_option";

/**
 * Проблема во введённых параметрах. `message` по-русски говорит, что не так и как исправить
 * (требование ТЗ к сообщениям об ошибках); `row` — строка файла при загрузке.
 */
export type ParamIssue = {
  key: string;
  label: string;
  code: ParamIssueCode;
  severity: "error" | "warning";
  message: string;
  row?: number;
};

// ——————————————————————————— Сценарии ———————————————————————————

/**
 * Вид сценария (ТЗ §3.5.5): текущий процесс, роботизация покупкой, роботизация услугой (RaaS).
 */
export type ScenarioKind = "asis" | "purchase" | "raas";

/**
 * Позиция сценария: какой продукт закрывает какой процесс, плюс ручные корректировки
 * автоматически рассчитанных значений (ТЗ §3.5.4 — каждая корректировка пишется в журнал).
 */
export type ScenarioItem = {
  process: string;
  productSlug: string;
  /** Ручное число роботов вместо расчётного. */
  quantityOverride?: number;
  priceRubOverride?: number;
  throughputPerHOverride?: number;
  serviceRubYearOverride?: number;
  raasRubMonthOverride?: number;
  /** Ставка RaaS подставлена оценкой raasMonthlyPctOfPrice по явному действию пользователя. */
  raasFromEstimate?: boolean;
  /** Продукт добавлен вручную, хотя подбор его исключил (показывается со значком ⚠). */
  manuallyAdded?: boolean;
  manualReason?: string;
};

/** Сценарий проекта. Ключ — ^[a-z0-9-]{1,40}$, стабилен и используется в журнале и API. */
export type ScenarioSpec = {
  key: string;
  name: string;
  kind: ScenarioKind;
  items: ScenarioItem[];
  /** Нормативы, переопределённые в этом сценарии. */
  normOverrides?: Partial<Record<NormKey, number>>;
};

// ——————————————————————————— Результаты расчёта ———————————————————————————

/**
 * Статья CAPEX или OPEX с трассировкой (ТЗ §3.5.8): формула символами, та же формула с
 * подставленными числами и происхождение значения.
 */
export type LineItem = {
  key: string;
  label: string;
  valueRub: number;
  formula: string;
  substituted: string;
  origin: Origin;
  /** Уточнение происхождения, например «аналог: Ronavi». */
  originNote?: string;
  /** Значение задано пользователем вместо расчётного. */
  overridden?: boolean;
  /** Для RaaS: статья входит в подписку (допущение — проверить в договоре). */
  includedInSubscription?: boolean;
};

/** Шаг расчёта для раскрытия «Как посчитано»: формула, подстановка, результат и единица. */
export type TraceStep = {
  key: string;
  label: string;
  formula: string;
  substituted: string;
  value: number;
  unit: string;
  origin: Origin;
};

/**
 * Причина, по которой сценарий не рассчитан. Отказ типизирован, а не выражен нулём или NaN:
 * интерфейс показывает, какое поле заполнить.
 */
export type RefusalReason =
  | "throughput_required"
  | "price_required"
  | "raas_rate_required"
  | "staffing_required"
  | "calc_not_supported"
  | "invalid_inputs";

/** Отказ расчёта: причина, поля, которые нужно заполнить, и сообщение по-русски. */
export type Refusal = {
  reason: RefusalReason;
  fields: string[];
  message: string;
};

/**
 * Расчёт одной позиции сценария: спрос, производительность (норма, цикл, принятая), парк,
 * зарядки, персонал. Показывается в таблице «Состав оборудования» и в отчёте.
 */
export type ItemResult = {
  process: string;
  productSlug: string;
  productName: string;
  manuallyAdded: boolean;
  /** Спрос процесса в сутки, ед./сут. */
  demandPerDay: number;
  avgPerHour: number;
  peakPerHour: number;
  /** Паспортная норма, ед./ч; null — нет или неприменима. */
  thrNorm: number | null;
  /** Производительность по циклу на планировке объекта, ед./ч. */
  thrCycle: number | null;
  /** Принятая производительность, ед./ч. */
  thrEff: number | null;
  thrSource: "норма" | "цикл" | "задано вами" | null;
  /** Средняя длина плеча с грузом по планировке, м. */
  routeLoadedM: number | null;
  /** Средняя длина порожнего плеча по планировке, м. */
  routeEmptyM: number | null;
  nExact: number | null;
  nAuto: number | null;
  /** Принятое число роботов (ручное или расчётное). */
  n: number | null;
  nOverridden: boolean;
  /** Доля пикового спроса, которую закрывает парк, 0–1 (κ). */
  coverage: number;
  chargers: number;
  operatorPosts: number;
  headcount: number;
  /** Годовая стоимость одной ставки с начислениями, ₽. */
  roleCostRubYear: number;
  /** Высвобождаемые ставки (F). */
  releasedFte: number;
  baselineLabourRub: number;
  remainingLabourRub: number;
  operatingStaffRub: number;
};

/** Строка денежного потока по годам (год 0 — вложения). Все суммы в ₽. */
export type CashflowRow = {
  year: number;
  capexRub: number;
  opexRub: number;
  batteryRub: number;
  reinvestRub: number;
  effectRub: number;
  cashflowRub: number;
  cumulativeRub: number;
  discountedRub: number;
  cumulativeDiscountedRub: number;
};

/**
 * Плечо анализа чувствительности (ТЗ §3.5.6): рычаг, его границы и откуда они, результат на
 * каждой границе и признак смены знака NPV внутри диапазона.
 */
export type SensitivityRow = {
  lever: string;
  label: string;
  unit: string;
  base: number;
  low: number;
  high: number;
  boundsSource: "организатор" | "норматив" | "±20 %";
  clampedLow: boolean;
  clampedHigh: boolean;
  npvBase: number | null;
  npvLow: number | null;
  npvHigh: number | null;
  paybackLow: number | null;
  paybackHigh: number | null;
  tcoLow: number;
  tcoHigh: number;
  /** Размах результата между границами (NPV, для «Как есть» — TCO), ₽. */
  swing: number;
  signFlip: boolean;
};

/**
 * Интервал окупаемости (ТЗ §3.5.7): быстрая, средняя, долгая, не окупается. Это описание
 * результата, а не критерий рекомендации.
 */
export type Band = "fast" | "moderate" | "slow" | "none";

/**
 * Риск сценария. Коды — из правил экономики, подбора и имитации (NORM_VS_CYCLE,
 * PRICE_UNCONFIRMED, RAAS_ROI_UNINFORMATIVE, SIM_NOT_CONFIRMED и др.); текст по-русски с
 * числами.
 */
export type Risk = {
  code: string;
  severity: "high" | "medium" | "low";
  text: string;
};

/** Рассчитанный сценарий: CAPEX и OPEX по статьям, эффект, окупаемость, ROI, NPV, TCO. */
export type ScenarioOk = {
  key: string;
  name: string;
  kind: ScenarioKind;
  status: "ok";
  items: ItemResult[];
  capexRub: number;
  capexLines: LineItem[];
  opexYearRub: number;
  opexLines: LineItem[];
  /** ФОТ процессов охвата в этом сценарии, ₽/год. */
  processLabourYearRub: number;
  /** Чистый годовой эффект относительно «Как есть», ₽/год. */
  effectYearRub: number;
  /** Простой срок окупаемости CAPEX / эффект; null — эффект не положителен. */
  paybackYears: number | null;
  band: Band;
  /** ROI по ТЗ: накопленный эффект за горизонт / CAPEX × 100 %. */
  roiTzPct: number | null;
  /** Чистый ROI = ROI по ТЗ − 100 %. */
  roiNetPct: number | null;
  npvRub: number | null;
  discountedPaybackYears: number | null;
  tcoRub: number;
  tcoYears: number;
  tcoDeltaVsAsIsRub: number;
  cashflows: CashflowRow[];
  sensitivity: SensitivityRow[];
  risks: Risk[];
  trace: TraceStep[];
  /** Зарплата, при которой NPV покупки равен нулю, ₽/мес; null — не считается. */
  breakEvenSalaryRubMonth: number | null;
};

/** Сценарий, который не удалось рассчитать: причина и что уже посчитано до отказа. */
export type ScenarioRefused = {
  key: string;
  name: string;
  kind: ScenarioKind;
  status: "refused";
  refusal: Refusal;
  items: ItemResult[];
  risks: Risk[];
  trace: TraceStep[];
};

/** Результат сценария: рассчитан или отказ. */
export type ScenarioResult = ScenarioOk | ScenarioRefused;

// ——————————————————————————— Подбор и сравнение ———————————————————————————

/** Статус продукта в подборе (ТЗ §3.4). */
export type SelectionStatus = "recommended" | "candidate" | "excluded" | "insufficient-data";

/**
 * Вклад фактора в балл подбора — объяснимое ранжирование (ТЗ §3.4): вес, нормированное
 * значение, очки и объяснение по-русски.
 */
export type ScoreContribution = {
  factor: "econ" | "data" | "maturity" | "margin" | "cases";
  label: string;
  weight: number;
  /** Нормированное значение фактора, 0–1. */
  value01: number;
  points: number;
  explanation: string;
};

/**
 * Результат подбора для пары процесс × продукт: статус, причины включения или исключения,
 * ограничения, недостающие данные с подсказкой, как их заполнить, и балл с разложением.
 */
export type SelectionResult = {
  process: string;
  productSlug: string;
  productName: string;
  status: SelectionStatus;
  needsVerification: boolean;
  reasons: string[];
  limitations: string[];
  missing: { key: string; label: string; howToFix: string }[];
  score: { total: number | null; contributions: ScoreContribution[] };
};

/**
 * Строка сравнения решений по единым характеристикам (ТЗ §2.2 шаг 4): технические,
 * эксплуатационные и экономические показатели в одинаковых единицах. null — нет данных.
 */
export type ComparisonRow = {
  process: string;
  productSlug: string;
  productName: string;
  status: SelectionStatus;
  manuallyAdded: boolean;
  payloadKg: number | null;
  speedMps: number | null;
  thrNorm: number | null;
  thrCycle: number | null;
  thrEff: number | null;
  autonomyH: number | null;
  chargeMin: number | null;
  minAisleM: number | null;
  n: number | null;
  chargers: number | null;
  priceRub: number | null;
  capexPurchaseRub: number | null;
  npvPurchaseRub: number | null;
  paybackPurchaseYears: number | null;
  raasRubMonth: number | null;
  completenessPct: number | null;
};

/**
 * Вывод по проекту (ТЗ §3.5.7, §3.7): рекомендуемый сценарий, заголовок, пункты (риски,
 * рычаги, смена вывода) и обязательная оговорка о предварительной оценке.
 */
export type Conclusion = {
  recommendedScenarioKey: string | null;
  headline: string;
  bullets: string[];
  disclaimer: string;
};

/**
 * Изменение, ожидающее записи в журнал ChangeLog (ТЗ §3.5.4): что изменено, автоматическое
 * значение, старое и новое. Формат `field`: 'param:<key>', 'item:<process>:quantity|price|
 * throughput|service|raasRate', 'norm:<key>', 'scenario:add', 'scenario:remove',
 * 'item:<process>:manual'.
 */
export type PendingChange = {
  scenarioKey?: string;
  field: string;
  auto: number | string | null;
  old: unknown;
  new: unknown;
  unit?: string;
  reason?: string;
};

/**
 * Всё, что сохраняется в Project.results. Хранит не только результаты, но и снимки входов —
 * параметры, нормативы, продукты, сценарии — и версии модели и данных, чтобы повторное
 * открытие воспроизводило расчёт бит-в-бит, а расхождение с живыми данными было видно (§3.1.5).
 */
export type ProjectResults = {
  modelVersion: string;
  simModelVersion: string;
  /** Хэш снимков продуктов, нормативов и версии данных организатора (dataVersionOf). */
  dataVersion: string;
  /** Момент расчёта, ISO 8601. */
  calculatedAt: string;
  facility: string;
  paramsUsed: ParamValues;
  normsUsed: NormValues;
  productSnapshots: Record<string, ProductForCalc>;
  scenarios: ScenarioSpec[];
  results: ScenarioResult[];
  selection: SelectionResult[];
  comparison: ComparisonRow[];
  conclusion: Conclusion;
  /** Сводки имитации по ключу сценария; null — сценарий имитацией не проверялся. */
  sim: Record<string, SimSummaryStored | null>;
  paramIssues: ParamIssue[];
};
