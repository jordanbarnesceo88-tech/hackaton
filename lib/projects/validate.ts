import { fx } from "../tz/econ/text";
import { isNormKey, normDef } from "../tz/norms";
import { processDef } from "../tz/processes";
import { facilityLabel } from "../tz/selection/text";
import type { PendingChange, ScenarioItem, ScenarioKind, ScenarioSpec } from "../tz/types";
import { stableJson } from "../tz/version";

/**
 * Проверка того, что присылает рабочая область проекта (серверные действия и API): сценарии,
 * ожидающие записи изменения журнала и название проекта. Правило то же, что у lib/analyses:
 * недопустимый ввод ОТКЛОНЯЕТСЯ с понятной причиной, а не «подчищается» молча — иначе
 * сохранённое отличалось бы от присланного, и никто бы об этом не узнал. Возвращаемые
 * объекты собираются заново только из известных полей, поэтому в БД не попадает ничего
 * постороннего. Чистые функции без Prisma — покрыты unit-тестом.
 */

/** Сколько сценариев может быть в проекте: ТЗ §3.1.3 требует не меньше трёх. */
export const SCENARIOS_MIN = 3;
export const SCENARIOS_MAX = 10;
/** Наибольшая длина названия сценария. */
export const SCENARIO_NAME_MAX = 80;
/** Ключ сценария: латиница в нижнем регистре, цифры и дефис. */
export const SCENARIO_KEY_RE = /^[a-z0-9-]{1,40}$/;
/** Ручное число роботов: целое от 1 до 500. */
export const QUANTITY_MAX = 500;
/** Длина названия проекта. */
export const PROJECT_NAME_MAX = 120;
/** Сколько изменений журнала принимается за одно сохранение. */
export const CHANGES_MAX = 300;
/** Длина причины ручного добавления или изменения. */
export const REASON_MAX = 500;

/** Результат проверки: принятое значение или список ошибок по-русски. */
export type Checked<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const SCENARIO_KINDS: ReadonlySet<string> = new Set<ScenarioKind>(["asis", "purchase", "raas"]);
const SPEC_FIELDS: ReadonlySet<string> = new Set(["key", "name", "kind", "items", "normOverrides"]);
const ITEM_FIELDS: ReadonlySet<string> = new Set([
  "process",
  "productSlug",
  "quantityOverride",
  "priceRubOverride",
  "throughputPerHOverride",
  "serviceRubYearOverride",
  "raasRubMonthOverride",
  "raasFromEstimate",
  "manuallyAdded",
  "manualReason",
]);
/** Ручные значения позиции, которые должны быть положительными числами. */
const POSITIVE_OVERRIDES = ["priceRubOverride", "throughputPerHOverride", "raasRubMonthOverride"] as const;
/** Подписи ручных значений и признаков позиции для сообщений об ошибках. */
const ITEM_FIELD_LABELS: Readonly<Record<(typeof POSITIVE_OVERRIDES)[number] | "raasFromEstimate" | "manuallyAdded", string>> = {
  priceRubOverride: "цена робота, ₽",
  throughputPerHOverride: "производительность робота в час",
  raasRubMonthOverride: "ставка RaaS в месяц за робота, ₽",
  raasFromEstimate: "ставка RaaS по оценке",
  manuallyAdded: "добавлено вручную",
};
/** Названия видов сценария для сообщений. */
const KIND_LABELS = "«Как есть» (asis), «Покупка» (purchase) или «Услуга (RaaS)» (raas)";

/** Допустимый диапазон норматива словами: «от 0,7 до 0,85 (доля)», «не меньше 0 (₽)». */
function normRangeText(min: number | null, max: number | null, unit: string): string {
  const u = unit.trim() !== "" ? ` (${unit})` : "";
  if (min !== null && max !== null) return `укажите от ${fx(min)} до ${fx(max)}${u}`;
  if (min !== null) return `укажите не меньше ${fx(min)}${u}`;
  return `укажите не больше ${fx(max ?? 0)}${u}`;
}

/** Название процесса для сообщения: из определения, иначе присланное значение. */
function processName(slug: unknown): string {
  const def = typeof slug === "string" ? processDef(slug) : undefined;
  return def ? def.name : String(slug);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}

function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Строка, обрезанная по краям, с одиночными пробелами внутри. */
function tidy(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Поля объекта, которых нет в списке допустимых. */
function unknownFields(obj: Record<string, unknown>, allowed: ReadonlySet<string>): string[] {
  return Object.keys(obj).filter((k) => !allowed.has(k) && obj[k] !== undefined);
}

/**
 * Название проекта: строка от 1 до 120 символов после обрезки пробелов. null — название
 * пустое, слишком длинное или не строка.
 */
export function sanitizeProjectName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const s = tidy(name);
  if (s.length < 1 || s.length > PROJECT_NAME_MAX) return null;
  return s;
}

/** Проверка одной позиции сценария; ошибки дописываются в `errors`. */
function checkItem(
  raw: unknown,
  where: string,
  productSlugs: ReadonlySet<string>,
  processSlugs: ReadonlySet<string>,
  errors: string[],
): ScenarioItem | null {
  if (!isPlainObject(raw)) {
    errors.push(`${where}: позиция должна быть объектом`);
    return null;
  }
  const extra = unknownFields(raw, ITEM_FIELDS);
  if (extra.length > 0) errors.push(`${where}: неизвестные поля ${extra.join(", ")}`);
  const before = errors.length;
  const process = raw.process;
  const productSlug = raw.productSlug;
  if (typeof process !== "string" || !processSlugs.has(process)) {
    errors.push(`${where}: процесс «${processName(process)}» не относится к этому типу объекта — выберите процесс объекта`);
  }
  if (typeof productSlug !== "string" || !productSlugs.has(productSlug)) {
    errors.push(`${where}: продукт «${String(productSlug)}» не найден в каталоге — выберите другой`);
  }
  const item: ScenarioItem = { process: String(process), productSlug: String(productSlug) };

  const q = raw.quantityOverride;
  if (q !== undefined) {
    if (!(finite(q) && Number.isInteger(q) && q >= 1 && q <= QUANTITY_MAX)) {
      errors.push(`${where}: число роботов должно быть целым от 1 до ${QUANTITY_MAX}`);
    } else item.quantityOverride = q;
  }
  for (const key of POSITIVE_OVERRIDES) {
    const v = raw[key];
    if (v === undefined) continue;
    if (!(finite(v) && v > 0)) errors.push(`${where}: ${ITEM_FIELD_LABELS[key]} — укажите число больше нуля`);
    else item[key] = v;
  }
  // Сервис может быть нулевым: «входит в цену» — законный ответ поставщика. Отрицательный — нет.
  const service = raw.serviceRubYearOverride;
  if (service !== undefined) {
    if (!(finite(service) && service >= 0)) errors.push(`${where}: сервис должен быть числом не меньше нуля, ₽/год`);
    else item.serviceRubYearOverride = service;
  }
  for (const key of ["raasFromEstimate", "manuallyAdded"] as const) {
    const v = raw[key];
    if (v === undefined) continue;
    if (typeof v !== "boolean") errors.push(`${where}: признак «${ITEM_FIELD_LABELS[key]}» должен быть «да» или «нет» (true или false)`);
    else if (v) item[key] = true;
  }
  const reason = raw.manualReason;
  if (reason !== undefined) {
    if (typeof reason !== "string" || tidy(reason).length > REASON_MAX) {
      errors.push(`${where}: причина — строка не длиннее ${REASON_MAX} символов`);
    } else if (tidy(reason) !== "") item.manualReason = tidy(reason);
  }
  if (item.manuallyAdded && !item.manualReason) {
    errors.push(`${where}: для решения, добавленного вручную, укажите причину`);
  }
  return errors.length === before ? item : null;
}

/**
 * Проверка сценариев проекта (ТЗ §3.1.3, §3.5.4, §3.5.5):
 * - от 3 до 10 сценариев, ровно один «Как есть» (asis) и без позиций;
 * - ключи ^[a-z0-9-]{1,40}$ и названия (1–80 символов) не повторяются;
 * - вид — asis, purchase или raas; на каждый процесс не больше одной позиции;
 * - процесс — из процессов этого типа объекта, продукт — из каталога или снимков проекта;
 * - ручные значения — конечные числа больше нуля (сервис — не меньше нуля), число роботов —
 *   целое от 1 до 500;
 * - переопределения нормативов — известные ключи NormKey с конечными значениями.
 * Возвращает сценарии, собранные заново только из известных полей.
 */
export function validateScenarioSpecs(
  specs: unknown,
  facility: string,
  productSlugs: Iterable<string>,
  processSlugs: Iterable<string>,
): Checked<ScenarioSpec[]> {
  const products = new Set(productSlugs);
  const processes = new Set(processSlugs);
  const errors: string[] = [];
  if (!Array.isArray(specs)) return { ok: false, errors: ["Сценарии должны быть списком"] };
  if (specs.length < SCENARIOS_MIN || specs.length > SCENARIOS_MAX) {
    errors.push(`В проекте должно быть от ${SCENARIOS_MIN} до ${SCENARIOS_MAX} сценариев, сейчас ${specs.length}`);
  }
  if (processes.size === 0) errors.push(`Для типа объекта «${facilityLabel(facility)}» не описаны процессы`);

  const keys = new Set<string>();
  const names = new Set<string>();
  let asisCount = 0;
  const out: ScenarioSpec[] = [];

  specs.forEach((raw, idx) => {
    const where = `Сценарий ${idx + 1}`;
    if (!isPlainObject(raw)) {
      errors.push(`${where}: должен быть объектом`);
      return;
    }
    const before = errors.length;
    const extra = unknownFields(raw, SPEC_FIELDS);
    if (extra.length > 0) errors.push(`${where}: неизвестные поля ${extra.join(", ")}`);

    const key = raw.key;
    if (typeof key !== "string" || !SCENARIO_KEY_RE.test(key)) {
      errors.push(`${where}: ключ должен состоять из латиницы в нижнем регистре, цифр и дефиса (1–40 символов)`);
    } else if (keys.has(key)) {
      errors.push(`${where}: ключ «${key}» повторяется`);
    } else keys.add(key);

    const name = typeof raw.name === "string" ? tidy(raw.name) : "";
    if (name.length < 1 || name.length > SCENARIO_NAME_MAX) {
      errors.push(`${where}: название от 1 до ${SCENARIO_NAME_MAX} символов`);
    } else if (names.has(name.toLowerCase())) {
      errors.push(`${where}: название «${name}» повторяется — названия сценариев должны различаться`);
    } else names.add(name.toLowerCase());

    const kind = raw.kind;
    if (typeof kind !== "string" || !SCENARIO_KINDS.has(kind)) {
      errors.push(`${where}: вид сценария — ${KIND_LABELS}`);
    }
    if (kind === "asis") asisCount++;

    const rawItems = raw.items === undefined ? [] : raw.items;
    const items: ScenarioItem[] = [];
    if (!Array.isArray(rawItems)) {
      errors.push(`${where}: позиции должны быть списком`);
    } else if (kind === "asis" && rawItems.length > 0) {
      errors.push(`${where}: в сценарии «Как есть» нет роботов — позиций быть не должно`);
    } else {
      const seenProcess = new Set<string>();
      rawItems.forEach((ri, j) => {
        const item = checkItem(ri, `${where}, позиция ${j + 1}`, products, processes, errors);
        if (!item) return;
        if (seenProcess.has(item.process)) {
          errors.push(`${where}: на процесс «${processName(item.process)}» уже выбрано решение — оставьте одно`);
          return;
        }
        seenProcess.add(item.process);
        items.push(item);
      });
    }

    let normOverrides: ScenarioSpec["normOverrides"];
    const no = raw.normOverrides;
    if (no !== undefined) {
      if (!isPlainObject(no)) {
        errors.push(`${where}: переопределения нормативов должны быть объектом`);
      } else {
        const entries: [string, number][] = [];
        for (const [k, v] of Object.entries(no)) {
          if (v === undefined) continue;
          if (!isNormKey(k)) {
            errors.push(`${where}: неизвестный норматив «${k}»`);
            continue;
          }
          const def = normDef(k);
          if (!finite(v)) {
            errors.push(`${where}: норматив «${def.label}» — укажите число`);
            continue;
          }
          // Вне допустимого диапазона движок молча прижал бы значение к границе, и в сценарии и
          // журнале осталось бы одно число, а в расчёте — другое. Поэтому такое значение
          // отклоняется с диапазоном.
          const low = def.min !== null && v < def.min;
          const high = def.max !== null && v > def.max;
          if (low || high) {
            errors.push(`${where}: норматив «${def.label}» — ${normRangeText(def.min, def.max, def.unit)}, сейчас ${fx(v)}`);
            continue;
          }
          entries.push([k, v]);
        }
        if (entries.length > 0) normOverrides = Object.fromEntries(entries);
      }
    }

    if (errors.length === before) {
      const spec: ScenarioSpec = { key: key as string, name, kind: kind as ScenarioKind, items };
      if (normOverrides) spec.normOverrides = normOverrides;
      out.push(spec);
    }
  });

  if (asisCount !== 1) errors.push(`Нужен ровно один сценарий «Как есть», сейчас ${asisCount}`);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: out };
}

/** Поля журнала позиции сценария (формат PendingChange.field). */
const ITEM_CHANGE_FIELDS = "quantity|price|throughput|service|raasRate|manual";
/** Допустимые значения PendingChange.field (ТЗ §3.5.4 — журнал корректировок). */
const CHANGE_FIELD_RE = new RegExp(
  `^(param:[A-Za-z][A-Za-z0-9_]{0,63}|item:[a-z0-9-]{1,60}:(${ITEM_CHANGE_FIELDS})|norm:[A-Za-z][A-Za-z0-9]{0,63}|scenario:add|scenario:remove)$`,
);
const CHANGE_FIELDS: ReadonlySet<string> = new Set(["scenarioKey", "field", "auto", "old", "new", "unit", "reason"]);
/** Наибольший размер старого или нового значения в журнале, символов JSON. */
const CHANGE_VALUE_MAX = 4000;

/** Значение, которое можно записать в журнал: сериализуется в JSON и не слишком велико. */
function jsonValue(v: unknown): { ok: true; value: unknown } | { ok: false } {
  if (v === undefined) return { ok: true, value: null };
  try {
    const s = stableJson(v);
    if (s.length > CHANGE_VALUE_MAX) return { ok: false };
    return { ok: true, value: JSON.parse(s) as unknown };
  } catch {
    return { ok: false };
  }
}

/**
 * Проверка изменений, ожидающих записи в журнал ChangeLog. Поле — из белого списка
 * ('param:<key>', 'item:<process>:quantity|price|throughput|service|raasRate|manual',
 * 'norm:<NormKey>', 'scenario:add', 'scenario:remove'); ключ сценария — в формате ключа;
 * значения — сериализуемый JSON не больше 4000 символов; единица — до 40 символов; причина —
 * до 500. Автоматическое значение (`auto`) принимается по форме, но при записи сервер
 * пересчитывает его сам (lib/projects/changes.ts).
 */
export function validatePendingChanges(changes: unknown): Checked<PendingChange[]> {
  if (changes === undefined || changes === null) return { ok: true, value: [] };
  if (!Array.isArray(changes)) return { ok: false, errors: ["Изменения должны быть списком"] };
  if (changes.length > CHANGES_MAX) {
    return { ok: false, errors: [`За одно сохранение принимается не больше ${CHANGES_MAX} изменений`] };
  }
  const errors: string[] = [];
  const out: PendingChange[] = [];
  changes.forEach((raw, idx) => {
    const where = `Изменение ${idx + 1}`;
    if (!isPlainObject(raw)) {
      errors.push(`${where}: должно быть объектом`);
      return;
    }
    const before = errors.length;
    const extra = unknownFields(raw, CHANGE_FIELDS);
    if (extra.length > 0) errors.push(`${where}: неизвестные поля ${extra.join(", ")}`);
    const field = raw.field;
    if (typeof field !== "string" || !CHANGE_FIELD_RE.test(field)) {
      errors.push(`${where}: поле «${String(field)}» не поддерживается журналом`);
    } else if (field.startsWith("norm:") && !isNormKey(field.slice("norm:".length))) {
      errors.push(`${where}: неизвестный норматив «${field.slice("norm:".length)}»`);
    }
    const sk = raw.scenarioKey;
    if (sk !== undefined && (typeof sk !== "string" || !SCENARIO_KEY_RE.test(sk))) {
      errors.push(`${where}: неверный ключ сценария`);
    }
    if (typeof field === "string" && (field.startsWith("item:") || field.startsWith("scenario:")) && sk === undefined) {
      errors.push(`${where}: для изменения сценария укажите ключ сценария`);
    }
    const auto = raw.auto;
    if (!(auto === undefined || auto === null || finite(auto) || (typeof auto === "string" && auto.length <= 200))) {
      errors.push(`${where}: автоматическое значение — число, строка или пусто`);
    }
    const oldV = jsonValue(raw.old);
    const newV = jsonValue(raw.new);
    if (!oldV.ok || !newV.ok) errors.push(`${where}: значение не записывается в журнал (не JSON или длиннее ${CHANGE_VALUE_MAX} символов)`);
    const unit = raw.unit;
    if (unit !== undefined && (typeof unit !== "string" || unit.length > 40)) errors.push(`${where}: единица — до 40 символов`);
    const reason = raw.reason;
    if (reason !== undefined && (typeof reason !== "string" || tidy(reason).length > REASON_MAX)) {
      errors.push(`${where}: причина — до ${REASON_MAX} символов`);
    }
    if (errors.length !== before || !oldV.ok || !newV.ok) return;
    const change: PendingChange = {
      field: field as string,
      auto: auto === undefined ? null : (auto as number | string | null),
      old: oldV.value,
      new: newV.value,
    };
    if (typeof sk === "string") change.scenarioKey = sk;
    if (typeof unit === "string" && unit.trim() !== "") change.unit = unit.trim();
    if (typeof reason === "string" && tidy(reason) !== "") change.reason = tidy(reason);
    out.push(change);
  });
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: out };
}
