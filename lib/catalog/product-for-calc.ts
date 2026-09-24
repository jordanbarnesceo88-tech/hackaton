import { CHARACTERISTIC_KEYS, completenessPct, confirmedSharePct } from "../tz/characteristics";
import type { CharGroup, CharKey } from "../tz/characteristics";
import { PROCESS_DEFS, solutionTypeDef } from "../tz/processes";
import type {
  CharValue,
  HandlingClass,
  Origin,
  ProductFlag,
  ProductForCalc,
  ProductLevel,
  ProductSeed,
  ProductStatus,
  Range,
  Scope,
  Sourced,
} from "../tz/types";
import { formatNum } from "../format/rub";

/**
 * Сборка плоского снимка продукта для расчёта (`ProductForCalc`) из характеристик каталога.
 *
 * Одно ядро на два входа: строки таблицы ProductCharacteristic (каталог в БД, T1.8) и
 * `Sourced`-значения генератора данных организатора (ProductSeed, T1.1). Поэтому снимок,
 * посчитанный по засеянной БД и по исходным данным, совпадает, а правила «какое число идёт
 * в расчёт» записаны в одном месте:
 * - число берётся из `valueNum` — это `typical` диапазона источника;
 * - производительность «до X» без нижней границы — предел, а не типичное значение, и в расчёт
 *   не идёт; значение «на весь парк» размер парка не задаёт и тоже не идёт (ТЗ §3.4, §3.5.3);
 * - признаки «цена подтверждена» и «производительность подтверждена» — флаг `confirmed`
 *   самой характеристики; отсутствующее значение подтверждённым не бывает;
 * - null означает «не публикуется»: движок откажет или возьмёт норматив, но не подставит ноль.
 *
 * Модуль чистый: без Prisma и без обращения к БД — его импортируют запросы каталога,
 * синхронизация (T2.1) и тесты.
 */

/** Оговорка источника к числу: «до X», «от X», «≈ X». */
export type Qualifier = NonNullable<Range["qualifier"]>;

/**
 * Характеристика в форме строки ProductCharacteristic — всё, что нужно расчёту, подсчёту
 * полноты и списку источников. Строковые поля (origin, scope, qualifier) приходят из БД как
 * произвольные строки и сужаются здесь же, при сборке снимка.
 */
export type CharRow = {
  key: string;
  valueNum: number | null;
  valueMin: number | null;
  valueMax: number | null;
  qualifier: string | null;
  valueText: string | null;
  valueList: readonly string[];
  unit: string | null;
  scope: string | null;
  origin: string;
  sourceUrl: string | null;
  sourceRef: string | null;
  /** Дата проверки значения, YYYY-MM-DD; null — не указана. */
  verifiedAt: string | null;
  confirmed: boolean;
  /**
   * Другие найденные значения (JSON-колонка alternatives: массив `Sourced` без вложенных
   * альтернатив). Нужны только для поиска расхождений источников — см. promote.ts.
   */
  alternatives?: unknown;
};

/**
 * Все поля характеристики ProductCharacteristic (без id и productId) в чистом виде, без типов
 * Prisma. Её возвращает `sourcedToCharRow`, чтобы синхронизация писала в БД ровно то, из чего
 * здесь собирается снимок.
 *
 * В БД эта форма как есть не записывается — три поля нужно преобразовать, это делает
 * `toCharacteristicData` из queries.ts:
 * - `verifiedAt` — строка YYYY-MM-DD, а колонка — DateTime: пишется полночь UTC этой даты
 *   (тогда `isoDate` при чтении возвращает ту же строку);
 * - `alternatives: null` в nullable-колонку Json пишется как `Prisma.DbNull`, массив — как
 *   `Prisma.InputJsonValue`;
 * - `group` — null для ключа, которого нет в словаре CHARACTERISTIC_KEYS, а колонка
 *   обязательная: такую строку нельзя писать в случайную группу — её нужно отклонить
 *   и показать в отчёте синхронизации.
 */
export type CharRowFull = CharRow & {
  group: CharGroup | null;
  sourceType: string;
  confidence: string | null;
  asInSource: string | null;
  basis: string | null;
  formula: string | null;
  note: string | null;
  granularity: string;
  alternatives: Omit<Sourced<CharValue>, "alternatives">[] | null;
};

/**
 * Сведения о продукте, которых нет в характеристиках: идентификация, тип решения, статус,
 * пометки и уже посчитанные полнота и доля подтверждённых (в БД — вынесенные колонки).
 */
export type ProductMeta = {
  slug: string;
  name: string;
  manufacturer: string | null;
  solutionTypeSlug: string;
  handlingClass: HandlingClass;
  mobile: boolean;
  status: ProductStatus;
  level: ProductLevel;
  flags: readonly ProductFlag[];
  excluded: boolean;
  excludedReason: string | null;
  processes: readonly string[];
  facilityTypes: readonly string[];
  completenessPct: number;
  confirmedSharePct: number;
};

// ——————————————————————————— Сужение строк из БД ———————————————————————————

const ORIGINS: ReadonlySet<string> = new Set<Origin>([
  "organizer",
  "research",
  "estimate",
  "derived",
  "choice",
  "tz",
  "admin",
  "user",
]);
const SCOPES: ReadonlySet<string> = new Set<Scope>(["per-robot", "per-station", "per-channel", "per-fleet"]);
const QUALIFIERS: ReadonlySet<string> = new Set<Qualifier>(["до", "от", "≈"]);
const STATUSES: ReadonlySet<string> = new Set<ProductStatus>(["operation", "piloting", "rnd"]);
const LEVELS: ReadonlySet<string> = new Set<ProductLevel>(["identification", "enriched", "examples"]);
const HANDLING: ReadonlySet<string> = new Set<HandlingClass>(["jacking", "fork", "tug", "station", "cleaner", "other"]);
const FLAGS: ReadonlySet<string> = new Set<ProductFlag>([
  "duplicate-merged",
  "model-not-found",
  "variant-unpublished",
  "manufacturer-disputed",
  "price-disputed",
  "price-may-be-subscription",
  "price-placeholder",
  "case-unconfirmed",
  "values-from-other-product",
  "no-price",
  "rnd-exclude",
]);

/**
 * Происхождение из строки БД. Неизвестное значение считается оценкой: это самый осторожный
 * вариант — число с таким происхождением показывается как неподтверждённое и попадает
 * в риски, а не выдаётся за данные организатора или производителя.
 */
export function asOrigin(value: string | null | undefined): Origin {
  return value && ORIGINS.has(value) ? (value as Origin) : "estimate";
}

/** Область значения из строки БД; неизвестная — null (к чему относится число, не известно). */
export function asScope(value: string | null | undefined): Scope | null {
  return value && SCOPES.has(value) ? (value as Scope) : null;
}

/** Оговорка «до / от / ≈» из строки БД; всё прочее — null. */
export function asQualifier(value: string | null | undefined): Qualifier | null {
  return value && QUALIFIERS.has(value) ? (value as Qualifier) : null;
}

/**
 * Статус продукта из строки БД. Неизвестный статус считается пилотом: зрелость не доказана,
 * поэтому продукт получает пометку «пилотная эксплуатация» и пониженный балл зрелости, но и не
 * исключается с ложной причиной «НИОКР». Синхронизация пишет только известные статусы.
 */
export function asStatus(value: string | null | undefined): ProductStatus {
  return value && STATUSES.has(value) ? (value as ProductStatus) : "piloting";
}

/** Глубина описания из строки БД; неизвестная — identification (в расчёт не идёт). */
export function asLevel(value: string | null | undefined): ProductLevel {
  return value && LEVELS.has(value) ? (value as ProductLevel) : "identification";
}

/** Класс грузообработки из строки БД; неизвестный — other. */
export function asHandlingClass(value: string | null | undefined): HandlingClass {
  return value && HANDLING.has(value) ? (value as HandlingClass) : "other";
}

/**
 * Пометки качества из строк БД: только известные `ProductFlag`, без повторов, в исходном
 * порядке. Неизвестная строка отбрасывается — у неё нет ни текста, ни правила подбора.
 */
export function asFlags(values: readonly string[]): ProductFlag[] {
  const out: ProductFlag[] = [];
  for (const v of values) if (FLAGS.has(v) && !out.includes(v as ProductFlag)) out.push(v as ProductFlag);
  return out;
}

/** Число, если оно конечное; иначе null (NaN и ±∞ в снимок не попадают). */
export function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Дата в формате YYYY-MM-DD (UTC) — так хранится `Sourced.date`. */
export function isoDate(value: Date | null | undefined): string | null {
  if (!value || Number.isNaN(value.getTime())) return null;
  return value.toISOString().slice(0, 10);
}

// ——————————————————————————— Правила значений ———————————————————————————

/**
 * Заполнена ли характеристика: есть число (или граница диапазона), непустой текст или
 * непустой перечень. Пустая строка в БД полноту карточки не повышает.
 */
export function isCharPresent(c: CharRow | undefined): boolean {
  if (!c) return false;
  if (finiteOrNull(c.valueNum) !== null) return true;
  if (finiteOrNull(c.valueMin) !== null || finiteOrNull(c.valueMax) !== null) return true;
  if (c.valueText !== null && c.valueText.trim() !== "") return true;
  return c.valueList.some((s) => s.trim() !== "");
}

/**
 * Производительность, которая идёт в расчёт парка (ТЗ §3.5.3): типичное значение диапазона.
 * null, если источник даёт только предел («до X» без нижней границы) или значение на весь парк:
 * первое завышает производительность, второе — вообще не про одного робота.
 */
export function usableThroughput(c: CharRow | undefined): number | null {
  if (!c) return null;
  const value = finiteOrNull(c.valueNum);
  if (value === null) return null;
  if (asQualifier(c.qualifier) === "до" && finiteOrNull(c.valueMin) === null) return null;
  if (asScope(c.scope) === "per-fleet") return null;
  return value;
}

/**
 * Полнота карточки и доля подтверждённых значений по заполненным характеристикам —
 * функции `completenessPct` и `confirmedSharePct` словаря ТЗ §3.3.4. Пустые строки не
 * считаются ни заполненными, ни подтверждёнными.
 */
export function charStats(chars: readonly CharRow[]): { completenessPct: number; confirmedSharePct: number } {
  const present = chars.filter((c) => isCharPresent(c));
  return {
    completenessPct: completenessPct(present.map((c) => c.key)),
    confirmedSharePct: confirmedSharePct(present),
  };
}

/** Первая характеристика с данным ключом (в БД ключ уникален в пределах продукта). */
function indexByKey(chars: readonly CharRow[]): Map<string, CharRow> {
  const map = new Map<string, CharRow>();
  for (const c of chars) if (!map.has(c.key)) map.set(c.key, c);
  return map;
}

// ——————————————————————————— Форматирование для «Откуда число» ———————————————————————————

const SCOPE_LABELS: Readonly<Record<Scope, string>> = {
  "per-robot": "на робота",
  "per-station": "на станцию",
  "per-channel": "на канал",
  "per-fleet": "на весь парк",
};

/**
 * Ключ из словаря характеристик. Собственные свойства, а не оператор in: иначе «constructor»
 * или «toString» из прототипа объекта сошли бы за характеристику.
 */
export function isCharKey(key: string): key is CharKey {
  return Object.prototype.hasOwnProperty.call(CHARACTERISTIC_KEYS, key);
}

/** Подпись характеристики по-русски; ключ вне словаря показывается как есть. */
export function charLabel(key: string): string {
  return isCharKey(key) ? CHARACTERISTIC_KEYS[key].label : key;
}

/** Группа характеристики ТЗ §3.3.4; null — ключа нет в словаре. */
export function charGroupOf(key: string): CharGroup | null {
  return isCharKey(key) ? CHARACTERISTIC_KEYS[key].group : null;
}

const PROCESS_ORDER: ReadonlyMap<string, number> = new Map(PROCESS_DEFS.map((d, i) => [d.slug, i]));

/**
 * Порядок процессов продукта — один во всех путях (снимок из БД, снимок из данных генератора,
 * список и карточка каталога): как в PROCESS_DEFS (склад, аэропорт, медучреждение, внутри —
 * по порядку процессов объекта), процессы вне кода — в конце по slug. Колонка Process.order
 * для этого не годится: номер задан внутри своего типа объекта (уборка склада — 6, уборка
 * терминала — 3), и продукт с процессами разных объектов получил бы порядок «вперемешку».
 */
export function compareProcessSlugs(a: string, b: string): number {
  const ia = PROCESS_ORDER.get(a) ?? Number.MAX_SAFE_INTEGER;
  const ib = PROCESS_ORDER.get(b) ?? Number.MAX_SAFE_INTEGER;
  if (ia !== ib) return ia - ib;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Slug'и процессов в порядке `compareProcessSlugs` — новым массивом, вход не меняется. */
export function sortProcessSlugs(slugs: readonly string[]): string[] {
  return [...slugs].sort(compareProcessSlugs);
}

const KEY_ORDER: ReadonlyMap<string, number> = new Map(Object.keys(CHARACTERISTIC_KEYS).map((k, i) => [k, i]));

/** Порядок показа: как в словаре характеристик, ключи вне словаря — в конце по алфавиту. */
export function compareCharKeys(a: string, b: string): number {
  const ia = KEY_ORDER.get(a) ?? Number.MAX_SAFE_INTEGER;
  const ib = KEY_ORDER.get(b) ?? Number.MAX_SAFE_INTEGER;
  if (ia !== ib) return ia - ib;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Число в ru-RU без лишних нулей: 2700000 → «2 700 000», 1.5 → «1,5», 0.75 → «0,75».
 * Не больше трёх знаков после запятой.
 */
function formatCharNumber(n: number): string {
  for (let digits = 0; digits < 3; digits++) {
    const scaled = n * 10 ** digits;
    if (Math.abs(scaled - Math.round(scaled)) < 1e-9 * Math.max(1, Math.abs(scaled))) return formatNum(n, digits);
  }
  return formatNum(n, 3);
}

/**
 * Значение характеристики строкой для людей: «80–100 паллет/ч (на робота)», «до 10 кг»,
 * «от 100 000 ₽/мес», «2 700 000 ₽», текст или перечень через запятую; пусто — «—».
 * Разделитель разрядов — неразрывный пробел ICU, как во всех форматтерах lib/format/rub.
 */
export function formatCharValue(
  c: Pick<CharRow, "valueNum" | "valueMin" | "valueMax" | "qualifier" | "valueText" | "valueList" | "unit" | "scope">,
): string {
  const unit = c.unit && c.unit.trim() !== "" ? ` ${c.unit.trim()}` : "";
  const value = finiteOrNull(c.valueNum);
  const min = finiteOrNull(c.valueMin);
  const max = finiteOrNull(c.valueMax);
  const qualifier = asQualifier(c.qualifier);

  let numeric: string | null = null;
  if (min !== null && max !== null && min !== max) numeric = `${formatCharNumber(min)}–${formatCharNumber(max)}${unit}`;
  else if (value !== null) numeric = `${qualifier ? `${qualifier} ` : ""}${formatCharNumber(value)}${unit}`;
  else if (min !== null) numeric = `от ${formatCharNumber(min)}${unit}`;
  else if (max !== null) numeric = `до ${formatCharNumber(max)}${unit}`;

  if (numeric !== null) {
    const scope = asScope(c.scope);
    return scope ? `${numeric} (${SCOPE_LABELS[scope]})` : numeric;
  }
  if (c.valueText !== null && c.valueText.trim() !== "") return c.valueText.trim();
  const list = c.valueList.map((s) => s.trim()).filter((s) => s !== "");
  return list.length > 0 ? list.join(", ") : "—";
}

// ——————————————————————————— Снимок для расчёта ———————————————————————————

/**
 * Снимок продукта для расчёта из характеристик каталога. Возвращает новые массивы, а не
 * ссылки на входные: снимок сохраняется в проекте и не должен меняться вместе с каталогом.
 */
export function fromCharacteristics(meta: ProductMeta, chars: readonly CharRow[]): ProductForCalc {
  const byKey = indexByKey(chars);
  const num = (key: CharKey): number | null => finiteOrNull(byKey.get(key)?.valueNum);

  const price = byKey.get("priceRub");
  const priceRub = num("priceRub");
  const throughput = byKey.get("throughput");
  const throughputPerH = usableThroughput(throughput);
  const raas = byKey.get("raasRubMonth");
  const raasRubMonth = num("raasRubMonth");

  return {
    slug: meta.slug,
    name: meta.name,
    manufacturer: meta.manufacturer,
    solutionType: meta.solutionTypeSlug,
    handlingClass: meta.handlingClass,
    mobile: meta.mobile,
    status: meta.status,
    level: meta.level,
    flags: [...meta.flags],
    excluded: meta.excluded,
    excludedReason: meta.excludedReason,
    processes: [...meta.processes],
    facilityTypes: [...meta.facilityTypes],
    priceRub,
    priceConfirmed: priceRub !== null && price !== undefined && price.confirmed,
    priceOrigin: priceRub !== null && price !== undefined ? asOrigin(price.origin) : null,
    throughputPerH,
    // Единица, область и оговорка остаются и при null-значении: по ним интерфейс объясняет,
    // почему паспортная цифра («до 1 000 м²/ч», «на весь парк») не пошла в расчёт.
    throughputUnit: throughput?.unit ?? null,
    throughputScope: asScope(throughput?.scope),
    throughputQualifier: asQualifier(throughput?.qualifier),
    throughputConfirmed: throughputPerH !== null && throughput !== undefined && throughput.confirmed,
    payloadKg: num("payloadKg"),
    speedMps: num("speedMps"),
    autonomyH: num("autonomyH"),
    chargeMin: num("chargeMin"),
    minAisleM: num("minAisleM"),
    turnAisleM: num("turnAisleM"),
    liftHeightMm: num("liftHeightMm"),
    tempMinC: num("tempMinC"),
    tempMaxC: num("tempMaxC"),
    serviceRubYear: num("serviceRubYear"),
    softwareRubOneTime: num("softwareRubOneTime"),
    softwareRubYear: num("softwareRubYear"),
    implementationRub: num("implementationRub"),
    trainingRub: num("trainingRub"),
    consumablesRubYear: num("consumablesRubYear"),
    batteryCostRub: num("batteryCostRub"),
    batteryReplacementYears: num("batteryReplacementYears"),
    serviceLifeYears: num("serviceLifeYears"),
    raasRubMonth,
    raasQualifier: raasRubMonth !== null ? asQualifier(raas?.qualifier) : null,
    raasOrigin: raasRubMonth !== null && raas !== undefined ? asOrigin(raas.origin) : null,
    hasCases: isCharPresent(byKey.get("cases")),
    completenessPct: meta.completenessPct,
    confirmedSharePct: meta.confirmedSharePct,
    sources: [...chars]
      .sort((a, b) => compareCharKeys(a.key, b.key))
      .map((c) => ({
        key: c.key,
        label: charLabel(c.key),
        value: formatCharValue(c),
        origin: asOrigin(c.origin),
        sourceUrl: c.sourceUrl,
        sourceRef: c.sourceRef,
        date: c.verifiedAt,
        confirmed: c.confirmed,
      })),
  };
}

// ——————————————————————————— Адаптер данных организатора ———————————————————————————

/**
 * `Sourced`-значение генератора → строка ProductCharacteristic. Число — valueNum; диапазон —
 * typical в valueNum, границы в valueMin/valueMax, оговорка в qualifier; текст — valueText;
 * перечень — valueList. Эту же функцию может использовать синхронизация (T2.1), чтобы в БД
 * лежало ровно то, из чего `productForCalcFromSeed` собирает снимок; в БД строка пишется через
 * `toCharacteristicData` (queries.ts) — см. `CharRowFull`.
 */
export function sourcedToCharRow(key: string, s: Sourced<CharValue>): CharRowFull {
  let valueNum: number | null = null;
  let valueMin: number | null = null;
  let valueMax: number | null = null;
  let qualifier: string | null = null;
  let valueText: string | null = null;
  let valueList: string[] = [];
  const v = s.value;
  if (typeof v === "number") valueNum = finiteOrNull(v);
  else if (typeof v === "string") valueText = v;
  else if (Array.isArray(v)) valueList = [...v];
  else {
    valueNum = finiteOrNull(v.typical);
    valueMin = finiteOrNull(v.min);
    valueMax = finiteOrNull(v.max);
    qualifier = v.qualifier ?? null;
  }
  return {
    key,
    group: charGroupOf(key),
    valueNum,
    valueMin,
    valueMax,
    qualifier,
    valueText,
    valueList,
    unit: s.unit ?? null,
    scope: s.scope ?? null,
    origin: s.origin,
    sourceType: s.sourceType,
    sourceUrl: s.sourceUrl,
    sourceRef: s.sourceRef ?? null,
    verifiedAt: s.date && s.date.trim() !== "" ? s.date : null,
    confirmed: s.confirmed,
    confidence: s.confidence ?? null,
    asInSource: s.asInSource ?? null,
    basis: s.basis ?? null,
    formula: s.formula ?? null,
    note: null,
    granularity: s.granularity ?? "field",
    alternatives: s.alternatives && s.alternatives.length > 0 ? s.alternatives : null,
  };
}

/**
 * Снимок для расчёта прямо из данных генератора (без БД) — тем же ядром, что и из строк
 * каталога. Класс грузообработки и мобильность берутся из SOLUTION_TYPE_DEFS; для неизвестного
 * типа решения — other и «мобильный» (как умолчание колонки SolutionType.mobile): для
 * мобильного робота движок добавляет зарядные станции, то есть ошибка идёт в сторону большего
 * CAPEX, а не меньшего. Продукт исключён, если у него есть причина исключения. Процессы —
 * в порядке `sortProcessSlugs`, как и в снимке из БД.
 */
export function productForCalcFromSeed(seed: ProductSeed): ProductForCalc {
  const rows = Object.entries(seed.characteristics).map(([key, s]) => sourcedToCharRow(key, s));
  const stats = charStats(rows);
  const type = solutionTypeDef(seed.solutionType);
  return fromCharacteristics(
    {
      slug: seed.slug,
      name: seed.name,
      manufacturer: seed.manufacturer,
      solutionTypeSlug: seed.solutionType,
      handlingClass: type?.handlingClass ?? "other",
      mobile: type?.mobile ?? true,
      status: seed.status,
      level: seed.level,
      flags: asFlags(seed.flags),
      excluded: seed.excludedReason !== null,
      excludedReason: seed.excludedReason,
      processes: sortProcessSlugs(seed.processes),
      facilityTypes: seed.facilityTypes,
      completenessPct: stats.completenessPct,
      confirmedSharePct: stats.confirmedSharePct,
    },
    rows,
  );
}
