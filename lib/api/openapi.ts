import { charGroupOf, charLabel, formatCharValue, sourcedToCharRow } from "../catalog/product-for-calc";
import { hasConflictingAlternatives, promoteColumns } from "../catalog/promote";
import { catalogProduct } from "../data/organizer/catalog";
import { paramSpecsFor } from "../data/organizer/params";
import { ORGANIZER_DATA_VERSION } from "../data/organizer/version.generated";
import { SIM_MODEL_VERSION } from "../sim/types";
import { CHAR_GROUP_LABELS, CHARACTERISTIC_KEYS } from "../tz/characteristics";
import { DISCLAIMER } from "../tz/econ/conclusion";
import { normDef } from "../tz/norms";
import { validateParamValues } from "../tz/params/validate";
import { FACILITY_LABELS } from "../tz/params/template";
import { PROCESS_DEFS, processDef, SOLUTION_TYPE_DEFS, solutionTypeDef } from "../tz/processes";
import type { CharValue, ProductSeed, Sourced } from "../tz/types";
import { TZ_MODEL_VERSION } from "../tz/version";
import { CATALOG_QUERY_PARAMS } from "./catalog";
import { ADMIN_TOKEN_MIN_LENGTH } from "./auth-constants";
import { API_IMPORT_ORIGINS, IMPORT_MAX_PRODUCTS, SOURCE_TYPES_BY_ORIGIN, validateProductSeeds } from "./import";
import { normApiRows } from "./norms";

/**
 * Описание API платформы в формате OpenAPI 3.1 (ТЗ §4.2.5 «документировать все API, OpenAPI
 * рекомендуется», §3.8). Один объект на три потребителя: GET /api/v1/openapi.json отдаёт его
 * как есть, страница /api-docs строит из него таблицу, тест lib/api/openapi.test.ts сверяет его с
 * файлами маршрутов (каждый обработчик описан, каждое описание имеет обработчик).
 *
 * Примеры запросов и ответов не выдумывают чисел: карточка продукта, нормативы и параметры
 * собираются из данных организатора (lib/data/organizer) и кода модели, примеры ошибок —
 * вызовом тех же функций проверки, что работают в обработчиках. Числа расчёта (CAPEX, NPV …) в
 * примерах не приводятся — вместо них заглушки «<число, ₽>»: демонстрационные числа печатает
 * только scripts/print-demo-numbers.ts, и документация не должна с ним расходиться.
 */

// ——————————————————————————— Типы документа ———————————————————————————

export type HttpMethod = "get" | "post" | "put" | "delete";

/** Кто может вызвать операцию (расширение x-access). */
export type ApiAccess = "public" | "user" | "admin";

export const ACCESS_LABELS: Readonly<Record<ApiAccess, string>> = {
  public: "Гость (без входа)",
  user: "Пользователь (сессия после входа)",
  admin: "Администратор (сессия или токен)",
};

type Schema = Record<string, unknown>;

export type OpenApiExample = { summary: string; value: unknown };
export type OpenApiMedia = { schema?: Schema; examples?: Record<string, OpenApiExample> };
export type OpenApiParameter = {
  name: string;
  in: "query" | "path" | "header";
  required?: boolean;
  description: string;
  schema: Schema;
  example?: unknown;
};
export type OpenApiResponse = { description: string; headers?: Record<string, Schema>; content?: Record<string, OpenApiMedia> };
export type OpenApiOperation = {
  operationId: string;
  summary: string;
  description: string;
  tags: string[];
  "x-access": ApiAccess;
  security: Record<string, string[]>[];
  parameters?: OpenApiParameter[];
  requestBody?: { required: boolean; description?: string; content: Record<string, OpenApiMedia> };
  responses: Record<string, OpenApiResponse>;
};
export type OpenApiDocument = {
  openapi: "3.1.0";
  info: { title: string; version: string; description: string };
  servers: { url: string; description: string }[];
  tags: { name: string; description: string }[];
  paths: Record<string, Partial<Record<HttpMethod, OpenApiOperation>>>;
  components: { schemas: Record<string, Schema>; securitySchemes: Record<string, Schema> };
};

// ——————————————————————————— Помощники схем ———————————————————————————

const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });
const str = (description: string, extra: Schema = {}): Schema => ({ type: "string", description, ...extra });
const num = (description: string, extra: Schema = {}): Schema => ({ type: "number", description, ...extra });
const int = (description: string, extra: Schema = {}): Schema => ({ type: "integer", description, ...extra });
const bool = (description: string): Schema => ({ type: "boolean", description });
const arr = (items: Schema, description: string, extra: Schema = {}): Schema => ({ type: "array", items, description, ...extra });
/** Тип или null (OpenAPI 3.1 — массив типов). */
const orNull = (s: Schema): Schema =>
  typeof s.type === "string" ? { ...s, type: [s.type, "null"] } : { oneOf: [s, { type: "null" }] };
const obj = (properties: Record<string, Schema>, required: string[], description: string, extra: Schema = {}): Schema => ({
  type: "object",
  description,
  properties,
  required,
  ...extra,
});

const FACILITY_SCHEMA = str("Тип объекта: warehouse — склад, airport — аэропорт, medical — медучреждение", {
  enum: ["warehouse", "airport", "medical"],
});
const ORIGIN_ENUM = ["organizer", "research", "estimate", "derived", "choice", "tz", "admin", "user"];

// ——————————————————————————— Примеры из данных ———————————————————————————

/** Продукт, на котором построены примеры каталога и импорта: Ronavi H1500 из данных организатора. */
export const EXAMPLE_PRODUCT_SLUG = "ronavi-h1500";
const EXAMPLE_SOURCE: ProductSeed | undefined = catalogProduct(EXAMPLE_PRODUCT_SLUG);

/** Характеристики, скопированные в пример импорта вместе с источниками. */
export const EXAMPLE_IMPORT_KEYS = ["manufacturer", "modelName", "countryOfOrigin", "payloadKg", "priceRub"] as const;

/**
 * Пример тела импорта: карточка уровня identification (в подбор и расчёт не попадает) под
 * отдельным slug, характеристики — копия данных организатора и открытых источников по
 * Ronavi H1500 с их провенансом. Числа не выдуманы: тест сверяет их с lib/data/organizer.
 */
export function exampleImportSeed(): ProductSeed {
  const src = EXAMPLE_SOURCE;
  const characteristics: Record<string, Sourced<CharValue>> = {};
  for (const key of EXAMPLE_IMPORT_KEYS) {
    const s = src?.characteristics[key];
    if (s) characteristics[key] = structuredClone(s);
  }
  return {
    slug: "api-example-ronavi-h1500",
    organizerCatalogId: null,
    organizerRows: [],
    level: "identification",
    name: "Ronavi H1500 — пример импорта через API",
    manufacturer: src?.manufacturer ?? null,
    country: src?.country ?? null,
    solutionType: src?.solutionType ?? "pallet-amr",
    status: src?.status ?? "operation",
    processes: [...(src?.processes ?? [])],
    facilityTypes: [...(src?.facilityTypes ?? [])],
    industries: [...(src?.industries ?? [])],
    description:
      "Пример для POST /api/v1/catalog/import: характеристики скопированы из данных организатора вместе с источниками",
    characteristics,
    flags: [],
    excludedReason: null,
  };
}

/** Строка списка каталога для примера: вынесенные колонки считает promoteColumns, как при записи. */
function exampleListItem(seed: ProductSeed): Record<string, unknown> {
  const rows = Object.entries(seed.characteristics).map(([k, s]) => sourcedToCharRow(k, s));
  const type = solutionTypeDef(seed.solutionType);
  return {
    slug: seed.slug,
    name: seed.name,
    manufacturer: seed.manufacturer,
    country: seed.country,
    level: seed.level,
    status: seed.status,
    origin: "ORGANIZER",
    solutionType: type ? { slug: type.slug, name: type.name } : null,
    processes: seed.processes.map((p) => ({ slug: p, name: processDef(p)?.name ?? p })),
    facilityTypes: [...seed.facilityTypes],
    description: seed.description,
    ...promoteColumns(rows, { flags: seed.flags }),
    excluded: seed.excludedReason !== null,
    excludedReason: seed.excludedReason,
    flags: [...seed.flags],
  };
}

/** Карточка продукта для примера: по одной характеристике на группу ТЗ §3.3.4. */
function exampleDetail(seed: ProductSeed): Record<string, unknown> {
  const item = exampleListItem(seed);
  const type = solutionTypeDef(seed.solutionType);
  const groups: Record<string, unknown[]> = Object.fromEntries(Object.keys(CHAR_GROUP_LABELS).map((g) => [g, []]));
  for (const [key, s] of Object.entries(seed.characteristics)) {
    const group = charGroupOf(key);
    if (!group || (groups[group]?.length ?? 0) > 0) continue;
    const row = sourcedToCharRow(key, s);
    groups[group]?.push({
      key,
      label: charLabel(key),
      group,
      display: formatCharValue(row),
      valueNum: row.valueNum,
      valueMin: row.valueMin,
      valueMax: row.valueMax,
      qualifier: row.qualifier,
      valueText: row.valueText,
      valueList: row.valueList,
      unit: row.unit,
      scope: row.scope,
      origin: row.origin,
      sourceType: row.sourceType,
      sourceUrl: row.sourceUrl,
      sourceRef: row.sourceRef,
      verifiedAt: row.verifiedAt,
      confirmed: row.confirmed,
      confidence: row.confidence,
      asInSource: row.asInSource,
      basis: row.basis,
      formula: row.formula,
      note: row.note,
      granularity: row.granularity,
      alternatives: (row.alternatives ?? []).map((a) => {
        const alt = sourcedToCharRow(key, a);
        return {
          value: formatCharValue(alt),
          origin: alt.origin,
          sourceType: alt.sourceType,
          sourceUrl: alt.sourceUrl,
          sourceRef: alt.sourceRef,
          date: alt.verifiedAt,
          confirmed: alt.confirmed,
          confidence: alt.confidence,
          asInSource: alt.asInSource,
        };
      }),
      hasConflict: hasConflictingAlternatives(row),
    });
  }
  return {
    ...item,
    organizerCatalogId: seed.organizerCatalogId,
    organizerRows: [...seed.organizerRows],
    industries: [...seed.industries],
    archived: false,
    editedByAdmin: false,
    dataVersion: "<версия выпуска данных>",
    updatedAt: "<дата и время ISO 8601>",
    solutionType: type
      ? { slug: type.slug, name: type.name, purpose: type.purpose, handlingClass: type.handlingClass, mobile: type.mobile }
      : null,
    processes: seed.processes.map((p) => ({ slug: p, name: processDef(p)?.name ?? p, order: processDef(p)?.order ?? 0 })),
    facilityTypes: seed.facilityTypes.map((f) => ({
      slug: f,
      name: FACILITY_LABELS[f] ?? f,
      industry: { slug: "<slug отрасли>", name: "<отрасль>" },
    })),
    characteristics: groups,
  };
}

const EXAMPLE_PARAM_KEY = "forkliftSalaryRubMonth";
const warehouseSpecs = paramSpecsFor("warehouse");
const exampleParamSpec = warehouseSpecs.find((s) => s.key === EXAMPLE_PARAM_KEY) ?? warehouseSpecs[0];
/** Верхняя граница зарплаты оператора погрузчика из датасета организатора — пример значения. */
const exampleSalary = exampleParamSpec?.max ?? exampleParamSpec?.base ?? null;

/** Пример ошибки проверки параметра — теми же функциями, что работают в обработчике. */
function exampleParamIssues(): unknown {
  return validateParamValues(warehouseSpecs, { [EXAMPLE_PARAM_KEY]: "сто двадцать тысяч" }, { origin: "api" }).issues.filter(
    (i) => i.severity === "error",
  );
}

/** Пример ошибки импорта. */
function exampleImportIssues(): unknown {
  const res = validateProductSeeds([{ slug: "Ronavi H1500", name: "Ronavi H1500", level: "enriched", characteristics: {} }]);
  return res.ok ? [] : res.issues;
}

const NUM = "<число>";
const RUB = "<число, ₽>";

const exampleScenarioSummary = {
  key: "p1",
  name: "Покупка — Ronavi H1500",
  kind: "purchase",
  status: "ok",
  recommended: "<true или false>",
  capexRub: RUB,
  opexYearRub: RUB,
  effectYearRub: RUB,
  paybackYears: NUM,
  band: "<fast | moderate | slow | none>",
  roiTzPct: NUM,
  npvRub: RUB,
  discountedPaybackYears: `${NUM} или null`,
  tcoRub: RUB,
  tcoYears: NUM,
  equipment: [
    { process: "pallet-transport", productSlug: EXAMPLE_PRODUCT_SLUG, productName: EXAMPLE_SOURCE?.name ?? "Ronavi H1500", robots: NUM, chargers: NUM },
  ],
  simVerdict: "<CONFIRMED | NOT_CONFIRMED>",
  refusal: null,
};

const exampleVersions = {
  modelVersion: TZ_MODEL_VERSION,
  simModelVersion: SIM_MODEL_VERSION,
  dataVersion: "<хэш данных расчёта>",
  calculatedAt: "<дата и время ISO 8601>",
  organizer: ORGANIZER_DATA_VERSION,
  paramDefsFrom: "db",
};

const exampleCalcResponse = {
  versions: exampleVersions,
  summary: [exampleScenarioSummary],
  conclusion: {
    recommendedScenarioKey: "<ключ сценария или null>",
    headline: "<вывод по проекту>",
    bullets: ["<риск, сильнейший рычаг, горизонт смены вывода, порог зарплаты>"],
    disclaimer: DISCLAIMER,
  },
  warnings: [],
  results: "<ProjectResults: сценарии, статьи CAPEX и OPEX с формулами, денежные потоки, чувствительность, подбор, сравнение, имитация — см. схему>",
};

const PALLET = "pallet-transport";
const exampleScenarios = [
  { key: "asis", name: "Как есть", kind: "asis", items: [] },
  { key: "p1", name: "Покупка — Ronavi H1500", kind: "purchase", items: [{ process: PALLET, productSlug: EXAMPLE_PRODUCT_SLUG }] },
  { key: "r1", name: "Услуга (RaaS) — Ronavi H1500", kind: "raas", items: [{ process: PALLET, productSlug: EXAMPLE_PRODUCT_SLUG }] },
];

const utilizationDef = normDef("utilization");
const exampleNormRows = normApiRows([]).norms.slice(0, 2).map((n) => ({ ...n, updatedAt: "<дата и время ISO 8601>" }));

// ——————————————————————————— Общие ответы ———————————————————————————

const JSON_TYPE = "application/json";

function errorResponse(description: string, example?: { summary: string; value: unknown }): OpenApiResponse {
  return {
    description,
    content: { [JSON_TYPE]: { schema: ref("Error"), ...(example ? { examples: { example } } : {}) } },
  };
}

function jsonResponse(description: string, schema: Schema, examples?: Record<string, OpenApiExample>): OpenApiResponse {
  return { description, content: { [JSON_TYPE]: { schema, ...(examples ? { examples } : {}) } } };
}

const R503 = errorResponse("База данных недоступна", {
  summary: "База не ответила",
  value: { error: "База данных временно недоступна — повторите запрос через минуту" },
});
const R415 = errorResponse("Тело не в JSON", {
  summary: "Нет Content-Type: application/json",
  value: { error: "Передайте тело запроса в формате JSON с заголовком Content-Type: application/json" },
});
const R400 = errorResponse("Тело не разобрано как JSON");
const R413 = errorResponse("Тело запроса слишком большое");
const R401_ADMIN = errorResponse("Нет доступа администратора: гость, неверный токен или вход по токену выключен", {
  summary: "Гость",
  value: {
    error:
      "Нужен доступ администратора: войдите на сайте под администратором или передайте заголовок Authorization: Bearer <ADMIN_API_TOKEN>",
  },
});
const R403 = errorResponse("Сессия пользователя без роли администратора", {
  summary: "Не администратор",
  value: { error: "Недостаточно прав: действие доступно только администратору" },
});
const R401_USER = errorResponse("Нужен вход на сайте", {
  summary: "Гость",
  value: { error: "Войдите на сайте — действие доступно после входа (cookie сессии)" },
});
const R429 = errorResponse("Превышен лимит запросов; заголовок Retry-After — через сколько секунд повторить", {
  summary: "Лимит",
  value: { error: "Слишком много запросов, повторите через 900 с", details: { retryAfterSec: 900 } },
});

const PUBLIC: Record<string, string[]>[] = [];
const USER: Record<string, string[]>[] = [{ sessionCookie: [] }];
const ADMIN: Record<string, string[]>[] = [{ sessionCookie: [] }, { adminToken: [] }];

// ——————————————————————————— Схемы ———————————————————————————

const SCHEMAS: Record<string, Schema> = {
  Error: obj(
    { error: str("Что не так и как исправить, по-русски"), details: { description: "Подробности: ошибки по полям или позициям" } },
    ["error"],
    "Ошибка API",
  ),
  ParamIssue: obj(
    {
      key: str("Ключ параметра"),
      label: str("Подпись параметра"),
      code: str("Код проблемы", {
        enum: [
          "missing_required",
          "wrong_type",
          "bad_number_format",
          "out_of_range",
          "locked_changed",
          "unknown_key",
          "duplicate_key",
          "unit_mismatch",
          "negative",
          "not_integer",
          "bad_option",
        ],
      }),
      severity: str("error — значение не принято; warning — принято с предупреждением", { enum: ["error", "warning"] }),
      message: str("Что не так и как исправить"),
      row: int("Строка файла (для загрузки файла)"),
    },
    ["key", "label", "code", "severity", "message"],
    "Проблема во введённых параметрах объекта",
  ),
  ParamSpec: obj(
    {
      key: str("Ключ параметра — используется в params"),
      facility: FACILITY_SCHEMA,
      section: str("Раздел датасета"),
      label: str("Подпись"),
      unit: orNull(str("Единица")),
      kind: str("Вид поля", { enum: ["number", "integer", "percent", "enum", "text", "dims"] }),
      options: arr(str("Вариант"), "Варианты для kind = enum"),
      base: { type: ["number", "string", "null"], description: "Базовое значение организатора (демо-данные)" },
      min: orNull(num("Нижняя граница диапазона организатора")),
      max: orNull(num("Верхняя граница диапазона организатора")),
      locked: bool("Зафиксировано организатором (min = max)"),
      required: bool("Обязательный параметр"),
      tzMinimum: orNull(str("Какой пункт минимума ТЗ §3.2.1 покрывает")),
      usedBy: arr(str("Где используется"), "fleet, labour, constraints, visualization, economics"),
      hint: str("Подсказка"),
      example: str("Пример ввода"),
      organizerNote: orNull(str("Примечание организатора дословно")),
      origin: str("Происхождение значения", { enum: ORIGIN_ENUM }),
      sourceRef: orNull(str("Где именно у организатора")),
      sourceUrl: orNull(str("Ссылка на источник")),
      basis: orNull(str("Обоснование оценки")),
      formula: orNull(str("Формула вывода")),
      order: int("Порядок показа"),
    },
    ["key", "facility", "label", "kind", "base", "min", "max", "required", "origin"],
    "Описание параметра объекта (ТЗ §3.2)",
  ),
  ParamValues: {
    type: "object",
    description: "Значения параметров объекта: ключ из ParamSpec → число, строка или null. Не заданные — базовые значения организатора",
    additionalProperties: { type: ["number", "string", "null"] },
  },
  ScenarioItem: obj(
    {
      process: str("Slug процесса", { enum: PROCESS_DEFS.map((p) => p.slug) }),
      productSlug: str("Slug продукта каталога"),
      quantityOverride: int("Ручное число роботов, 1–500"),
      priceRubOverride: num("Ручная цена робота, ₽"),
      throughputPerHOverride: num("Ручная производительность, ед./ч"),
      serviceRubYearOverride: num("Ручной сервис, ₽/год"),
      raasRubMonthOverride: num("Ручная ставка RaaS, ₽/мес за робота"),
      raasFromEstimate: bool("Ставка RaaS подставлена оценкой"),
      manuallyAdded: bool("Продукт добавлен вручную, хотя подбор его исключил"),
      manualReason: str("Причина ручного добавления (до 500 символов)"),
    },
    ["process", "productSlug"],
    "Позиция сценария: какой продукт закрывает какой процесс",
    { additionalProperties: false },
  ),
  ScenarioSpec: obj(
    {
      key: str("Ключ ^[a-z0-9-]{1,40}$", { pattern: "^[a-z0-9-]{1,40}$" }),
      name: str("Название, 1–80 символов"),
      kind: str("asis — как есть, purchase — покупка, raas — услуга", { enum: ["asis", "purchase", "raas"] }),
      items: arr(ref("ScenarioItem"), "Позиции (у «Как есть» — пусто)"),
      normOverrides: { type: "object", description: "Нормативы, переопределённые в сценарии: ключ → число в [min, max]", additionalProperties: { type: "number" } },
    },
    ["key", "name", "kind", "items"],
    "Сценарий (ТЗ §3.5.5). В проекте 3–10 сценариев, ровно один «Как есть»",
    { additionalProperties: false },
  ),
  CalculateRequest: obj(
    {
      facility: FACILITY_SCHEMA,
      params: ref("ParamValues"),
      scenarios: arr(ref("ScenarioSpec"), "Сценарии; не заданы — сценарии по умолчанию из подбора", { minItems: 3, maxItems: 10 }),
    },
    ["facility"],
    "Вход расчёта",
    { additionalProperties: false },
  ),
  Versions: obj(
    {
      modelVersion: str("Версия экономической модели"),
      simModelVersion: str("Версия модели имитации"),
      dataVersion: str("Хэш снимков продуктов, нормативов и описаний параметров"),
      calculatedAt: str("Момент расчёта", { format: "date-time" }),
      organizer: { type: "object", description: "Версии выгрузок организатора в этой сборке", additionalProperties: { type: "string" } },
      paramDefsFrom: str("Описания параметров из БД или из кода", { enum: ["db", "code"] }),
    },
    ["modelVersion", "simModelVersion", "dataVersion", "calculatedAt"],
    "Версии расчёта (ТЗ §3.1.5 — воспроизводимость)",
  ),
  ScenarioSummary: obj(
    {
      key: str("Ключ сценария"),
      name: str("Название"),
      kind: str("Вид", { enum: ["asis", "purchase", "raas"] }),
      status: str("ok — рассчитан, refused — отказ с причиной", { enum: ["ok", "refused"] }),
      recommended: bool("Рекомендуемый сценарий вывода"),
      capexRub: orNull(num("CAPEX, ₽")),
      opexYearRub: orNull(num("OPEX в год, ₽")),
      effectYearRub: orNull(num("Годовой эффект относительно «Как есть», ₽")),
      paybackYears: orNull(num("Простая окупаемость, лет (CAPEX / эффект)")),
      band: orNull(str("Интервал окупаемости", { enum: ["fast", "moderate", "slow", "none"] })),
      roiTzPct: orNull(num("ROI по ТЗ, %")),
      npvRub: orNull(num("NPV за горизонт, ₽")),
      discountedPaybackYears: orNull(num("Дисконтированная окупаемость, лет")),
      tcoRub: orNull(num("TCO, ₽")),
      tcoYears: orNull(int("Горизонт TCO, лет")),
      equipment: arr(
        obj(
          {
            process: str("Процесс"),
            productSlug: str("Продукт"),
            productName: str("Название продукта"),
            robots: orNull(int("Роботов")),
            chargers: int("Зарядных станций"),
          },
          ["process", "productSlug", "robots", "chargers"],
          "Позиция состава оборудования",
        ),
        "Состав оборудования",
      ),
      simVerdict: orNull(str("Вердикт имитации", { enum: ["CONFIRMED", "NOT_CONFIRMED"] })),
      refusal: orNull(
        obj({ reason: str("Код причины"), message: str("Что заполнить"), fields: arr(str("Поле"), "Поля") }, ["reason", "message"], "Отказ"),
      ),
    },
    ["key", "name", "kind", "status", "recommended"],
    "Сводка сценария — те же числа, что в results.results, в плоской форме",
  ),
  Conclusion: obj(
    {
      recommendedScenarioKey: orNull(str("Ключ рекомендуемого сценария")),
      headline: str("Вывод"),
      bullets: arr(str("Пункт"), "Риски, рычаги, смена вывода"),
      disclaimer: str("Оговорка о предварительной оценке"),
    },
    ["recommendedScenarioKey", "headline", "bullets", "disclaimer"],
    "Вывод по проекту (ТЗ §3.5.7, §3.7)",
  ),
  ProjectResults: obj(
    {
      modelVersion: str("Версия модели"),
      simModelVersion: str("Версия имитации"),
      dataVersion: str("Версия данных расчёта"),
      calculatedAt: str("Момент расчёта", { format: "date-time" }),
      facility: FACILITY_SCHEMA,
      paramsUsed: ref("ParamValues"),
      normsUsed: { type: "object", description: "Нормативы, с которыми выполнен расчёт", additionalProperties: { type: "number" } },
      productSnapshots: { type: "object", description: "Снимки продуктов сценариев (ProductForCalc) по slug", additionalProperties: { type: "object" } },
      scenarios: arr(ref("ScenarioSpec"), "Сценарии"),
      results: arr(
        { type: "object" },
        "Результаты сценариев: статус ok (CAPEX и OPEX по статьям с формулой и подстановкой, эффект, окупаемость, ROI, NPV, TCO, денежные потоки, чувствительность, риски, трассировка) или refused (причина)",
      ),
      selection: arr({ type: "object" }, "Подбор: статус продукта, причины, ограничения, недостающие данные, балл с разложением"),
      comparison: arr({ type: "object" }, "Сравнение решений по единым характеристикам"),
      conclusion: ref("Conclusion"),
      sim: { type: "object", description: "Сводки имитации по ключу сценария (null — не проверялся)", additionalProperties: true },
      paramIssues: arr(ref("ParamIssue"), "Предупреждения по параметрам"),
    },
    ["modelVersion", "dataVersion", "calculatedAt", "facility", "scenarios", "results", "conclusion"],
    "Полный результат расчёта с входными снимками — то же, что хранится в проекте",
  ),
  CalculateResponse: obj(
    {
      versions: ref("Versions"),
      summary: arr(ref("ScenarioSummary"), "Сводка по сценариям"),
      conclusion: ref("Conclusion"),
      warnings: arr(ref("ParamIssue"), "Предупреждения по параметрам (значение принято)"),
      results: ref("ProjectResults"),
    },
    ["versions", "summary", "conclusion", "warnings", "results"],
    "Результат расчёта",
  ),
  ProjectCreateRequest: obj(
    {
      name: str("Название проекта, 1–120 символов"),
      facility: FACILITY_SCHEMA,
      objectName: str("Название объекта, до 200 символов"),
      params: ref("ParamValues"),
      scenarios: arr(ref("ScenarioSpec"), "Сценарии; не заданы — по умолчанию из подбора", { minItems: 3, maxItems: 10 }),
    },
    ["name", "facility"],
    "Новый проект",
    { additionalProperties: false },
  ),
  ProjectCreated: obj(
    {
      id: str("Id проекта"),
      url: str("Адрес рабочей области проекта на сайте"),
      versions: ref("Versions"),
      summary: arr(ref("ScenarioSummary"), "Сводка"),
      conclusion: ref("Conclusion"),
      warnings: arr(ref("ParamIssue"), "Предупреждения"),
      results: ref("ProjectResults"),
    },
    ["id", "url", "versions", "summary", "results"],
    "Созданный проект",
  ),
  Project: obj(
    {
      id: str("Id"),
      name: str("Название"),
      objectName: orNull(str("Объект")),
      facility: FACILITY_SCHEMA,
      url: str("Адрес на сайте"),
      isDemo: bool("Засеянный демо-проект (только чтение и копирование)"),
      copiedFromId: orNull(str("Из какого проекта скопирован")),
      createdAt: str("Создан", { format: "date-time" }),
      updatedAt: str("Изменён", { format: "date-time" }),
      calculatedAt: orNull(str("Рассчитан", { format: "date-time" })),
      modelVersion: orNull(str("Версия модели расчёта")),
      dataVersion: orNull(str("Версия данных расчёта")),
      liveDataVersion: orNull(str("Версия данных на текущем каталоге и нормативах")),
      dataChanged: orNull(bool("Данные изменились после расчёта")),
      currentModelVersion: str("Версия модели в этой сборке"),
      modelChanged: orNull(bool("Проект посчитан другой версией модели")),
      params: ref("ParamValues"),
      paramsSource: obj({ kind: str("demo, manual, upload или api"), fileName: str("Имя файла") }, ["kind"], "Откуда параметры"),
      scenarios: arr(ref("ScenarioSpec"), "Сценарии"),
      results: orNull(ref("ProjectResults")),
    },
    ["id", "name", "facility", "params", "scenarios", "results"],
    "Проект пользователя",
  ),
  CatalogListItem: obj(
    {
      slug: str("Slug"),
      name: str("Название"),
      manufacturer: orNull(str("Производитель")),
      country: orNull(str("Страна")),
      level: str("Глубина описания", { enum: ["identification", "enriched", "examples"] }),
      status: str("Статус", { enum: ["operation", "piloting", "rnd"] }),
      origin: str("ORGANIZER — данные организатора; ADMIN — заведён администратором (в админке или через API)", {
        enum: ["ORGANIZER", "ADMIN"],
      }),
      solutionType: orNull(obj({ slug: str("Slug"), name: str("Название") }, ["slug", "name"], "Тип решения")),
      processes: arr(obj({ slug: str("Slug"), name: str("Название") }, ["slug", "name"], "Процесс"), "Процессы"),
      facilityTypes: arr(str("Тип объекта"), "Типы объектов"),
      description: str("Описание, до 200 символов"),
      priceRub: orNull(num("Цена, ₽")),
      raasRubMonth: orNull(num("Ставка RaaS, ₽/мес")),
      throughputPerH: orNull(num("Производительность, пригодная для расчёта парка (на робота, не «до X»)")),
      throughputUnit: orNull(str("Единица производительности")),
      payloadKg: orNull(num("Грузоподъёмность, кг")),
      speedMps: orNull(num("Скорость, м/с")),
      completenessPct: int("Полнота карточки по 31 обязательному ключу ТЗ, %"),
      confirmedSharePct: int("Доля характеристик, подтверждённых первоисточником, %"),
      needsVerification: bool("Требует проверки"),
      excluded: bool("Исключён из подбора"),
      excludedReason: orNull(str("Причина исключения")),
      flags: arr(str("Пометка качества данных"), "Пометки"),
    },
    ["slug", "name", "level", "status", "origin"],
    "Строка списка каталога",
  ),
  CatalogList: obj(
    {
      items: arr(ref("CatalogListItem"), "Строки страницы"),
      total: int("Найдено всего"),
      page: int("Номер страницы"),
      pageSize: int("Строк на странице"),
      pageCount: int("Страниц"),
      dataRelease: orNull(obj({ version: str("Версия выпуска"), seededAt: str("Когда загружен", { format: "date-time" }) }, ["version"], "Выпуск данных")),
    },
    ["items", "total", "page", "pageSize", "pageCount"],
    "Страница каталога",
  ),
  CatalogCharacteristic: obj(
    {
      key: str("Ключ характеристики", { enum: Object.keys(CHARACTERISTIC_KEYS) }),
      label: str("Подпись"),
      group: str("Группа ТЗ §3.3.4", { enum: Object.keys(CHAR_GROUP_LABELS) }),
      display: str("Значение строкой для людей"),
      valueNum: orNull(num("Число или типичное значение диапазона")),
      valueMin: orNull(num("Нижняя граница")),
      valueMax: orNull(num("Верхняя граница")),
      qualifier: orNull(str("Оговорка: до, от, ≈")),
      valueText: orNull(str("Текст")),
      valueList: arr(str("Элемент"), "Список"),
      unit: orNull(str("Единица")),
      scope: orNull(str("К чему относится (per-robot, per-fleet …)")),
      origin: str("Происхождение", { enum: ORIGIN_ENUM }),
      sourceType: str("Тип источника"),
      sourceUrl: orNull(str("Ссылка на источник")),
      sourceRef: orNull(str("Где у организатора")),
      verifiedAt: orNull(str("Дата проверки", { format: "date" })),
      confirmed: bool("Подтверждено первоисточником"),
      confidence: orNull(str("Уверенность")),
      asInSource: orNull(str("Как в источнике, дословно")),
      basis: orNull(str("Обоснование")),
      formula: orNull(str("Формула")),
      note: orNull(str("Примечание")),
      granularity: str("field или row"),
      alternatives: arr({ type: "object" }, "Другие найденные значения"),
      hasConflict: bool("Источники расходятся сильнее допуска"),
    },
    ["key", "group", "display", "origin", "confirmed"],
    "Характеристика с провенансом (ТЗ §3.3.4)",
  ),
  CatalogProductDetail: {
    allOf: [
      ref("CatalogListItem"),
      obj(
        {
          organizerCatalogId: orNull(str("Id в каталоге организатора")),
          organizerRows: arr(int("Строка"), "Строки кураторского свода"),
          industries: arr(str("Отрасль"), "Отрасли"),
          archived: bool("В архиве"),
          editedByAdmin: bool("Правлен администратором"),
          dataVersion: str("Версия данных строки"),
          updatedAt: str("Изменён", { format: "date-time" }),
          characteristics: {
            type: "object",
            description: "Характеристики по группам ТЗ §3.3.4 (все шесть групп, пустая — [])",
            additionalProperties: arr(ref("CatalogCharacteristic"), "Характеристики группы"),
          },
        },
        ["characteristics"],
        "Поля карточки",
      ),
    ],
    description: "Карточка продукта: колонки, иерархия и характеристики с провенансом",
  },
  Range: obj(
    {
      min: num("Нижняя граница"),
      max: num("Верхняя граница"),
      typical: num("Значение, которое идёт в расчёт"),
      qualifier: str("Оговорка источника", { enum: ["до", "от", "≈"] }),
    },
    ["typical"],
    "Диапазон из источника: min ≤ typical ≤ max",
    { additionalProperties: false },
  ),
  Sourced: obj(
    {
      value: { oneOf: [{ type: "number" }, ref("Range"), { type: "string" }, { type: "array", items: { type: "string" } }], description: "Значение" },
      unit: str("Единица"),
      origin: str("Происхождение: organizer, research, estimate, derived, choice (admin и user ставит платформа)", {
        enum: [...API_IMPORT_ORIGINS],
      }),
      sourceType: str(
        "Тип источника; допустим при своём origin: " +
          Object.entries(SOURCE_TYPES_BY_ORIGIN)
            .map(([o, types]) => `${o} → ${types.join(" | ")}`)
            .join("; "),
      ),
      sourceUrl: orNull(str("Ссылка http(s); обязательна для research")),
      sourceRef: str("Где у организатора; обязательно для organizer"),
      date: str("Дата проверки ГГГГ-ММ-ДД", { format: "date" }),
      confirmed: bool("Подтверждено первоисточником; у estimate — всегда false"),
      confidence: str("Уверенность", { enum: ["high", "medium", "low"] }),
      asInSource: str("Цитата из источника; обязательна для research"),
      basis: str("Обоснование; обязательно для estimate, derived, choice"),
      formula: str("Формула; обязательна для derived"),
      scope: str("К чему относится значение", { enum: ["per-robot", "per-station", "per-channel", "per-fleet"] }),
      granularity: str("field — значение для поля, row — источник на всю строку", { enum: ["field", "row"] }),
      alternatives: arr({ type: "object", description: "Sourced без alternatives" }, "Другие найденные значения, до 10"),
    },
    ["value", "origin", "sourceType", "sourceUrl", "date", "confirmed"],
    "Значение характеристики с провенансом (ТЗ §3.3.4)",
    { additionalProperties: false },
  ),
  ProductSeed: obj(
    {
      slug: str("Slug: латиница, цифры, дефис, 1–80 символов; не из данных организатора", { pattern: "^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$" }),
      organizerCatalogId: { type: "null", description: "Только null: id организатора задаёт синхронизация" },
      organizerRows: { type: "array", maxItems: 0, description: "Только []" },
      level: str("identification — в подбор не идёт; enriched, examples — идут в подбор и расчёт", {
        enum: ["identification", "enriched", "examples"],
      }),
      name: str("Название, 1–200 символов"),
      manufacturer: orNull(str("Производитель")),
      country: orNull(str("Страна")),
      solutionType: str("Тип решения", { enum: SOLUTION_TYPE_DEFS.map((t) => t.slug) }),
      status: str("Статус", { enum: ["operation", "piloting", "rnd"] }),
      processes: arr(str("Процесс", { enum: PROCESS_DEFS.map((p) => p.slug) }), "Процессы, которые закрывает продукт"),
      facilityTypes: arr(FACILITY_SCHEMA, "Типы объектов; каждый процесс должен относиться к одному из них"),
      industries: arr(str("Отрасль"), "Отрасли"),
      description: str("Описание, до 200 символов"),
      characteristics: {
        type: "object",
        description: "Ключ словаря характеристик ТЗ §3.3.4 → Sourced",
        propertyNames: { enum: Object.keys(CHARACTERISTIC_KEYS) },
        additionalProperties: ref("Sourced"),
      },
      flags: arr(str("Пометка качества данных"), "Пометки: любая включает «требует проверки»"),
      excludedReason: orNull(str("Причина исключения из подбора")),
    },
    ["slug", "level", "name", "solutionType", "status", "characteristics"],
    "Продукт для импорта (та же форма, что у данных организатора)",
    { additionalProperties: false },
  ),
  ImportReport: obj(
    {
      dryRun: bool("Пробный прогон — без записи"),
      total: int("Позиций во входе"),
      created: int("Создано"),
      updated: int("Обновлено"),
      unchanged: int("Без изменений"),
      refused: int("Отказано (slug организатора, данные не засеяны)"),
      failed: int("Не записано из-за ошибки базы"),
      valid: int("Прошли проверку (пробный прогон)"),
      items: arr(
        obj(
          {
            index: int("Позиция во входе, с 0"),
            slug: str("Slug"),
            status: str("Итог", { enum: ["created", "updated", "unchanged", "refused", "failed", "valid"] }),
            action: str("create или update"),
            message: str("Пояснение"),
            adminCharacteristicsKept: int("Правок администратора сохранено"),
          },
          ["index", "slug", "status"],
          "Итог по позиции",
        ),
        "Итоги по позициям",
      ),
      via: str("session или bearer — как подтверждён доступ"),
    },
    ["dryRun", "total", "items"],
    "Отчёт импорта",
  ),
  NormRow: obj(
    {
      key: str("Ключ"),
      label: str("Название"),
      group: str("Группа"),
      order: int("Порядок"),
      unit: orNull(str("Единица")),
      value: num("Значение в таблице (или из кода)"),
      defaultValue: orNull(num("Значение по умолчанию из кода модели")),
      effectiveValue: orNull(num("Значение, с которым считает модель (после границ и взаимных ограничений)")),
      min: orNull(num("Нижняя граница")),
      max: orNull(num("Верхняя граница")),
      origin: str("Происхождение"),
      basis: str("Обоснование"),
      sourceRef: orNull(str("Источник у организатора или в ТЗ")),
      sourceUrl: orNull(str("Ссылка")),
      editedByAdmin: bool("Правлен администратором"),
      updatedAt: orNull(str("Изменён", { format: "date-time" })),
    },
    ["key", "label", "value", "min", "max", "origin", "basis"],
    "Норматив модели",
  ),
  NormsResponse: obj(
    { source: str("db — таблица Norm; code — таблица пуста, значения из кода", { enum: ["db", "code"] }), norms: arr(ref("NormRow"), "Нормативы") },
    ["source", "norms"],
    "Нормативы",
  ),
  NormsUpdateRequest: obj(
    {
      values: { type: "object", description: "Ключ норматива → новое значение", additionalProperties: { type: "number" }, minProperties: 1 },
      reason: str("Причина изменения, до 500 символов — попадает в журнал"),
    },
    ["values"],
    "Изменение нормативов",
    { additionalProperties: false },
  ),
  NormsUpdateResponse: obj(
    {
      changes: arr(
        obj(
          {
            key: str("Ключ"),
            label: str("Название"),
            unit: str("Единица"),
            requested: num("Запрошено"),
            oldValue: num("Было"),
            newValue: num("Записано"),
            clamped: bool("Запрошенное вне [min, max] — записана граница"),
            min: orNull(num("Нижняя граница")),
            max: orNull(num("Верхняя граница")),
            status: str("updated или unchanged", { enum: ["updated", "unchanged"] }),
            message: str("Пояснение к прижатию"),
            effectiveValue: orNull(num("Значение в расчёте после изменения")),
          },
          ["key", "requested", "oldValue", "newValue", "clamped", "status"],
          "Итог по нормативу",
        ),
        "Итоги",
      ),
      updated: int("Изменено"),
      unchanged: int("Без изменений"),
    },
    ["changes", "updated", "unchanged"],
    "Итог изменения нормативов",
  ),
  ParamsResponse: obj(
    { facility: FACILITY_SCHEMA, source: str("db или code", { enum: ["db", "code"] }), params: arr(ref("ParamSpec"), "Параметры") },
    ["facility", "source", "params"],
    "Параметры типа объекта",
  ),
  Health: obj(
    { ok: bool("Приложение и база доступны"), db: bool("База ответила"), modelVersion: str("Версия модели"), simModelVersion: str("Версия имитации") },
    ["ok", "db", "modelVersion", "simModelVersion"],
    "Состояние сервиса",
  ),
};

// ——————————————————————————— Документ ———————————————————————————

const importSeedExample = exampleImportSeed();
const listItemExample = EXAMPLE_SOURCE ? exampleListItem(EXAMPLE_SOURCE) : {};
const detailExample = EXAMPLE_SOURCE ? exampleDetail(EXAMPLE_SOURCE) : {};

export const OPENAPI: OpenApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "API платформы оценки роботизации",
    version: `v1 (модель ${TZ_MODEL_VERSION}, имитация ${SIM_MODEL_VERSION})`,
    description:
      "API для интеграций (ТЗ §3.8): каталог решений, нормативы, параметры объектов, расчёт сценариев и проекты. " +
      "Все ответы — JSON; ошибка — { error, details? } с сообщением по-русски. Денежные величины — в рублях. " +
      "Доступ: гость — чтение и расчёт без сохранения; пользователь — cookie сессии после входа на сайте; " +
      `администратор — сессия с ролью ADMIN или заголовок Authorization: Bearer <ADMIN_API_TOKEN> (не короче ${ADMIN_TOKEN_MIN_LENGTH} символов). ` +
      "Результат расчёта является предварительной оценкой и требует верификации при обследовании объекта.",
  },
  servers: [{ url: "/", description: "Тот же сервер, что и сайт (на стенде — через HTTPS)" }],
  tags: [
    { name: "Каталог", description: "Каталог решений с провенансом характеристик (ТЗ §3.3)" },
    { name: "Нормативы", description: "Нормативы экономической модели (ТЗ §3.5.1)" },
    { name: "Параметры объектов", description: "Описания параметров склада, аэропорта и медучреждения (ТЗ §3.2)" },
    { name: "Расчёт и проекты", description: "Расчёт сценариев и проекты пользователя (ТЗ §3.5, §3.1.3)" },
    { name: "Служебные", description: "Описание API, состояние сервиса, шаблоны загрузки" },
  ],
  paths: {
    "/api/v1/catalog": {
      get: {
        operationId: "listCatalog",
        summary: "Список каталога",
        description:
          "Каталог решений с фильтрами, поиском по названию, производителю и описанию, сортировкой и страницами по 50 (ТЗ §3.3.7). " +
          "Выгрузка для аналитики ФЦ БАС: пройдите страницы page=1…pageCount. Неизвестный параметр или значение — 422.",
        tags: ["Каталог"],
        "x-access": "public",
        security: PUBLIC,
        parameters: [
          { name: "facility", in: "query", description: "Тип объекта", schema: FACILITY_SCHEMA, example: "warehouse" },
          { name: "process", in: "query", description: "Slug процесса", schema: str("Процесс", { enum: PROCESS_DEFS.map((p) => p.slug) }), example: PALLET },
          { name: "solutionType", in: "query", description: "Slug типа решения", schema: str("Тип решения", { enum: SOLUTION_TYPE_DEFS.map((t) => t.slug) }) },
          { name: "status", in: "query", description: "Статус", schema: str("Статус", { enum: ["operation", "piloting", "rnd"] }) },
          { name: "level", in: "query", description: "Глубина описания", schema: str("Уровень", { enum: ["identification", "enriched", "examples"] }) },
          { name: "q", in: "query", description: "Поиск: все слова в названии, производителе, описании или slug, до 100 символов", schema: str("Запрос"), example: "Ronavi" },
          { name: "sort", in: "query", description: "Сортировка", schema: str("Порядок", { enum: ["name", "price", "throughput", "completeness"] }) },
          { name: "page", in: "query", description: "Страница, с 1", schema: int("Страница", { minimum: 1 }) },
          { name: "confirmedOnly", in: "query", description: "Только продукты с данными, подтверждёнными первоисточником (1 или 0)", schema: str("Флаг", { enum: ["1", "0"] }) },
          { name: "raas", in: "query", description: "Только продукты с опубликованной ставкой RaaS (1 или 0)", schema: str("Флаг", { enum: ["1", "0"] }) },
        ],
        responses: {
          "200": jsonResponse("Страница каталога", ref("CatalogList"), {
            example: {
              summary: "Склад, перемещение паллет (одна строка из страницы)",
              value: { items: [listItemExample], total: "<число>", page: 1, pageSize: 50, pageCount: "<число>", dataRelease: { version: "<версия выпуска>", seededAt: "<дата и время ISO 8601>" } },
            },
          }),
          "422": errorResponse("Неверные параметры запроса", {
            summary: "Опечатка в параметре",
            value: {
              error: "Неверные параметры запроса каталога — исправьте и повторите",
              details: { errors: [`Параметр «facilty» не поддерживается — допустимы ${CATALOG_QUERY_PARAMS.join(", ")}`] },
            },
          }),
          "503": R503,
        },
      },
    },
    "/api/v1/catalog/{slug}": {
      get: {
        operationId: "getCatalogProduct",
        summary: "Карточка продукта",
        description:
          "Все характеристики продукта по шести группам ТЗ §3.3.4, у каждой — значение как в источнике, ссылка, дата проверки, " +
          "признак подтверждения и альтернативные значения. Архивный продукт тоже отдаётся (archived: true).",
        tags: ["Каталог"],
        "x-access": "public",
        security: PUBLIC,
        parameters: [{ name: "slug", in: "path", required: true, description: "Slug продукта", schema: str("Slug"), example: EXAMPLE_PRODUCT_SLUG }],
        responses: {
          "200": jsonResponse("Карточка", ref("CatalogProductDetail"), {
            example: { summary: "Ronavi H1500 (в примере — по одной характеристике на группу)", value: detailExample },
          }),
          "404": errorResponse("Нет такого продукта", {
            summary: "Неизвестный slug",
            value: { error: "Продукт «no-such-robot» не найден — список продуктов: GET /api/v1/catalog" },
          }),
          "503": R503,
        },
      },
    },
    "/api/v1/catalog/import": {
      post: {
        operationId: "importCatalog",
        summary: "Импорт продуктов каталога",
        description:
          `Создаёт или обновляет до ${IMPORT_MAX_PRODUCTS} продуктов по списку ProductSeed (ТЗ §3.3.2, §3.3.6, §3.8.2). ` +
          "Проверка всё-или-ничего: при ошибке в любой позиции ничего не пишется (422). У каждой характеристики — провенанс: " +
          "organizer → sourceRef; research → sourceUrl, asInSource и дата; estimate, derived, choice → basis; derived → formula. " +
          "Продукты записываются с origin ADMIN: синхронизация данных организатора их не трогает, правки администратора в админке импорт не перезаписывает. " +
          "Slug из данных организатора не принимается — такой продукт дополняют в админке. ?dryRun=1 — только проверить, без записи.",
        tags: ["Каталог"],
        "x-access": "admin",
        security: ADMIN,
        parameters: [
          { name: "dryRun", in: "query", description: "1 — только проверить, 0 — записать (по умолчанию)", schema: str("Флаг", { enum: ["1", "0"] }), example: "1" },
        ],
        requestBody: {
          required: true,
          description: "Список ProductSeed",
          content: {
            [JSON_TYPE]: {
              schema: arr(ref("ProductSeed"), "Продукты", { minItems: 1, maxItems: IMPORT_MAX_PRODUCTS }),
              examples: {
                example: {
                  summary: "Карточка уровня identification (в подбор не идёт), характеристики — копия данных организатора с источниками",
                  value: [importSeedExample],
                },
              },
            },
          },
        },
        responses: {
          "200": jsonResponse("Отчёт по позициям", ref("ImportReport"), {
            example: {
              summary: "Пробный прогон ?dryRun=1",
              value: {
                dryRun: true,
                total: 1,
                created: 0,
                updated: 0,
                unchanged: 0,
                refused: 0,
                failed: 0,
                valid: 1,
                items: [{ index: 0, slug: importSeedExample.slug, status: "valid", action: "create" }],
                via: "bearer",
              },
            },
          }),
          "400": R400,
          "401": R401_ADMIN,
          "403": R403,
          "413": R413,
          "415": R415,
          "422": errorResponse("Позиции не прошли проверку — ничего не записано", {
            summary: "Неверный slug и не хватает полей",
            value: {
              error: "Импорт не выполнен: ошибки в 1 из 1 продуктов — исправьте и повторите",
              details: { issues: exampleImportIssues(), maxProducts: IMPORT_MAX_PRODUCTS },
            },
          }),
          "503": R503,
        },
      },
    },
    "/api/v1/norms": {
      get: {
        operationId: "listNorms",
        summary: "Нормативы модели",
        description:
          "Все нормативы расчёта с метаданными: значение, значение по умолчанию, итоговое значение расчёта, границы, происхождение, " +
          "обоснование и источник (ТЗ §3.5.1: без недокументированных коэффициентов).",
        tags: ["Нормативы"],
        "x-access": "public",
        security: PUBLIC,
        responses: {
          "200": jsonResponse("Нормативы", ref("NormsResponse"), {
            example: { summary: "Первые два норматива (значения по умолчанию)", value: { source: "db", norms: exampleNormRows } },
          }),
          "503": R503,
        },
      },
      put: {
        operationId: "updateNorms",
        summary: "Изменить нормативы",
        description:
          "Записывает новые значения нормативов одной транзакцией. Значение вне [min, max] прижимается к границе (clamped: true), " +
          "зафиксированный организатором норматив не меняется. Строка помечается правкой администратора — синхронизация данных её не перезаписывает. " +
          "Каждое изменение пишется в журнал ChangeLog (кто, когда, было, стало, причина). Расчёты новых и пересчитанных проектов используют новые значения.",
        tags: ["Нормативы"],
        "x-access": "admin",
        security: ADMIN,
        requestBody: {
          required: true,
          content: {
            [JSON_TYPE]: {
              schema: ref("NormsUpdateRequest"),
              examples: {
                example: {
                  summary: "Загрузка робота — верхняя граница диапазона организатора",
                  value: { values: { utilization: utilizationDef.max }, reason: "Загрузка по данным пилота" },
                },
              },
            },
          },
        },
        responses: {
          "200": jsonResponse("Итог по каждому нормативу", ref("NormsUpdateResponse"), {
            example: {
              summary: "Изменено одно значение",
              value: {
                changes: [
                  {
                    key: utilizationDef.key,
                    label: utilizationDef.label,
                    unit: utilizationDef.unit,
                    requested: utilizationDef.max,
                    oldValue: utilizationDef.value,
                    newValue: utilizationDef.max,
                    clamped: false,
                    min: utilizationDef.min,
                    max: utilizationDef.max,
                    status: "updated",
                    effectiveValue: utilizationDef.max,
                  },
                ],
                updated: 1,
                unchanged: 0,
              },
            },
          }),
          "400": R400,
          "401": R401_ADMIN,
          "403": R403,
          "413": R413,
          "415": R415,
          "422": errorResponse("Неизвестный ключ или не число", {
            summary: "Опечатка в ключе",
            value: { error: "Нормативы не изменены — исправьте запрос", details: { errors: ["Норматив «utilisation» неизвестен — ключи в GET /api/v1/norms"] } },
          }),
          "503": R503,
        },
      },
    },
    "/api/v1/facility-types/{slug}/params": {
      get: {
        operationId: "listFacilityParams",
        summary: "Параметры типа объекта",
        description:
          "Описания параметров объекта (ТЗ §3.2): ключ, раздел, подпись, единица, базовое значение и диапазон организатора, пример, подсказка, источник. " +
          "По этим ключам заполняется params в расчёте и проекте.",
        tags: ["Параметры объектов"],
        "x-access": "public",
        security: PUBLIC,
        parameters: [{ name: "slug", in: "path", required: true, description: "Тип объекта", schema: FACILITY_SCHEMA, example: "warehouse" }],
        responses: {
          "200": jsonResponse("Параметры", ref("ParamsResponse"), {
            example: {
              summary: "Склад (один параметр из списка)",
              value: { facility: "warehouse", source: "db", params: exampleParamSpec ? [exampleParamSpec] : [] },
            },
          }),
          "404": errorResponse("Неизвестный тип объекта"),
          "503": R503,
        },
      },
    },
    "/api/v1/calculate": {
      post: {
        operationId: "calculate",
        summary: "Расчёт сценариев без сохранения",
        description:
          "Считает сценарии для объекта: подбор решений, состав оборудования, CAPEX, OPEX, эффект, окупаемость, ROI, NPV, TCO, чувствительность, " +
          "вывод и проверку парка имитацией — те же функции, что у «Нового проекта», поэтому числа совпадают с проектом на тех же параметрах. " +
          "Без params — базовые значения организатора; без scenarios — сценарии по умолчанию из подбора. В БД ничего не пишется. " +
          "Лимит: 60 запросов за 15 минут с одного IP.",
        tags: ["Расчёт и проекты"],
        "x-access": "public",
        security: PUBLIC,
        requestBody: {
          required: true,
          content: {
            [JSON_TYPE]: {
              schema: ref("CalculateRequest"),
              examples: {
                demo: { summary: "Склад на демо-данных организатора", value: { facility: "warehouse" } },
                ...(exampleSalary !== null
                  ? {
                      salary: {
                        summary: "Зарплата оператора погрузчика — верхняя граница диапазона организатора",
                        value: { facility: "warehouse", params: { [EXAMPLE_PARAM_KEY]: exampleSalary } },
                      },
                    }
                  : {}),
                scenarios: { summary: "Свои сценарии: как есть, покупка и услуга одного робота", value: { facility: "warehouse", scenarios: exampleScenarios } },
              },
            },
          },
        },
        responses: {
          "200": jsonResponse("Результат расчёта", ref("CalculateResponse"), {
            example: { summary: "Структура ответа (числа расчёта заменены заглушками)", value: exampleCalcResponse },
          }),
          "400": R400,
          "413": R413,
          "415": R415,
          "422": errorResponse("Параметры или сценарии не прошли проверку", {
            summary: "Зарплата передана текстом",
            value: {
              error: `Параметры объекта не прошли проверку — исправьте: «${exampleParamSpec?.label ?? EXAMPLE_PARAM_KEY}»`,
              details: { issues: exampleParamIssues() },
            },
          }),
          "429": R429,
          "503": R503,
        },
      },
    },
    "/api/v1/projects": {
      post: {
        operationId: "createProject",
        summary: "Создать проект",
        description:
          "Создаёт проект пользователя с расчётом и сохраняет его с версиями модели и данных (ТЗ §3.1.3, §3.1.5). Путь для WMS, ERP и 1С: " +
          "объёмы и режим работы объекта передаются в params. Проверка — как у формы «Новый проект»; сервер сам считает модель и имитацию. " +
          "Проект открывается на сайте по адресу из поля url. Лимит: 30 проектов за 15 минут на пользователя.",
        tags: ["Расчёт и проекты"],
        "x-access": "user",
        security: USER,
        requestBody: {
          required: true,
          content: {
            [JSON_TYPE]: {
              schema: ref("ProjectCreateRequest"),
              examples: {
                example: {
                  summary: "Склад из WMS: демо-данные организатора и своя зарплата",
                  value: {
                    name: "РЦ Подольск",
                    facility: "warehouse",
                    objectName: "Распределительный центр",
                    params: exampleSalary !== null ? { [EXAMPLE_PARAM_KEY]: exampleSalary } : {},
                  },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Проект создан; заголовок Location — адрес проекта в API",
            headers: { Location: str("/api/v1/projects/{id}") },
            content: {
              [JSON_TYPE]: {
                schema: ref("ProjectCreated"),
                examples: {
                  example: {
                    summary: "Структура ответа (числа расчёта заменены заглушками)",
                    value: { id: "<id проекта>", url: "/projects/<id проекта>", ...exampleCalcResponse },
                  },
                },
              },
            },
          },
          "400": R400,
          "401": R401_USER,
          "413": R413,
          "415": R415,
          "422": errorResponse("Название, тип объекта, параметры или сценарии не прошли проверку"),
          "429": R429,
          "503": R503,
        },
      },
    },
    "/api/v1/projects/{id}": {
      get: {
        operationId: "getProject",
        summary: "Проект пользователя",
        description:
          "Параметры, сценарии и сохранённые результаты проекта с версиями. dataChanged — данные каталога или нормативов изменились после расчёта; " +
          "modelChanged — проект посчитан другой версией модели. Чужой проект неотличим от несуществующего (404).",
        tags: ["Расчёт и проекты"],
        "x-access": "user",
        security: USER,
        parameters: [{ name: "id", in: "path", required: true, description: "Id проекта", schema: str("Id") }],
        responses: {
          "200": jsonResponse("Проект", ref("Project")),
          "401": R401_USER,
          "404": errorResponse("Нет такого проекта у этого пользователя"),
          "503": R503,
        },
      },
    },
    "/api/v1/openapi.json": {
      get: {
        operationId: "getOpenApi",
        summary: "Описание API (OpenAPI 3.1)",
        description: "Этот документ в формате OpenAPI 3.1 — для генераторов клиентов и Swagger/Redoc. Человекочитаемая версия — страница /api-docs.",
        tags: ["Служебные"],
        "x-access": "public",
        security: PUBLIC,
        responses: { "200": jsonResponse("Документ OpenAPI", { type: "object" }) },
      },
    },
    "/api/health": {
      get: {
        operationId: "health",
        summary: "Состояние сервиса",
        description: "Проверка живости для Docker, CI и внешнего мониторинга: приложение отвечает и база доступна. Возвращает версии моделей.",
        tags: ["Служебные"],
        "x-access": "public",
        security: PUBLIC,
        responses: {
          "200": jsonResponse("Сервис и база доступны", ref("Health"), {
            example: { summary: "Всё в порядке", value: { ok: true, db: true, modelVersion: TZ_MODEL_VERSION, simModelVersion: SIM_MODEL_VERSION } },
          }),
          "503": jsonResponse("База недоступна", ref("Health"), {
            example: { summary: "База не ответила", value: { ok: false, db: false, modelVersion: TZ_MODEL_VERSION, simModelVersion: SIM_MODEL_VERSION } },
          }),
        },
      },
    },
    "/api/templates/{facility}": {
      get: {
        operationId: "getParamsTemplate",
        summary: "Шаблон загрузки параметров",
        description:
          "Шаблон файла параметров объекта (ТЗ §3.2.3): CSV для русского Excel (BOM, «;», десятичная запятая) или книга XLSX с листом «Как заполнить». " +
          "Заполненный шаблон загружается при создании проекта.",
        tags: ["Служебные"],
        "x-access": "public",
        security: PUBLIC,
        parameters: [
          { name: "facility", in: "path", required: true, description: "Тип объекта", schema: FACILITY_SCHEMA, example: "warehouse" },
          { name: "format", in: "query", description: "csv (по умолчанию) или xlsx", schema: str("Формат", { enum: ["csv", "xlsx"] }) },
        ],
        responses: {
          "200": {
            description: "Файл шаблона",
            content: {
              "text/csv": { schema: { type: "string" } },
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { schema: { type: "string", format: "binary" } },
            },
          },
          "404": { description: "Неизвестный тип объекта (текст по-русски)", content: { "text/plain": { schema: { type: "string" } } } },
          "503": { description: "Параметры не загружены в базу или база недоступна (текст по-русски)", content: { "text/plain": { schema: { type: "string" } } } },
        },
      },
    },
  },
  components: {
    schemas: SCHEMAS,
    securitySchemes: {
      sessionCookie: {
        type: "apiKey",
        in: "cookie",
        name: "authjs.session-token",
        description: "Cookie сессии Auth.js после входа на сайте (при HTTPS — __Secure-authjs.session-token)",
      },
      adminToken: {
        type: "http",
        scheme: "bearer",
        description: `Токен администратора из переменной окружения ADMIN_API_TOKEN (не короче ${ADMIN_TOKEN_MIN_LENGTH} символов); не задан — вход по токену выключен`,
      },
    },
  },
};

/** Операция документа в плоском виде — для страницы /api-docs и тестов. */
export type FlatOperation = { path: string; method: HttpMethod; op: OpenApiOperation };

/** Все операции в порядке документа. */
export function listOperations(doc: OpenApiDocument = OPENAPI): FlatOperation[] {
  const out: FlatOperation[] = [];
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const method of ["get", "post", "put", "delete"] as const) {
      const op = item[method];
      if (op) out.push({ path, method, op });
    }
  }
  return out;
}
