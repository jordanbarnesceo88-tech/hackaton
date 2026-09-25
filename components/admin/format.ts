import { charLabel } from "@/lib/catalog/product-for-calc";
import type { CatalogCharacteristic } from "@/lib/catalog/queries";
import { fx } from "@/lib/tz/econ/text";
import { isNormKey, normDef } from "@/lib/tz/norms";

/**
 * Подписи и форматирование админки. Модуль чистый и без директивы: его используют и серверные
 * страницы, и клиентские формы (функции из модуля «use client» сервер вызвать не может).
 */

/** Статус продукта из каталога организатора. */
export const STATUS_LABELS: Readonly<Record<string, string>> = {
  operation: "Эксплуатация",
  piloting: "Пилотирование",
  rnd: "НИОКР",
};

/** Глубина описания продукта. */
export const LEVEL_LABELS: Readonly<Record<string, string>> = {
  identification: "Идентификация",
  enriched: "Обогащённый",
  examples: "Примеры решений",
};

/** Пояснение к глубине описания — подсказка в списке и карточке. */
export const LEVEL_HINTS: Readonly<Record<string, string>> = {
  identification: "только поля каталога организатора; в расчёт не идёт",
  enriched: "характеристики с источником по каждому полю; участвует в подборе",
  examples: "из «Примеров решений» организатора; участвует в подборе",
};

/** Происхождение продукта каталога. */
export const PRODUCT_ORIGIN_LABELS: Readonly<Record<string, string>> = {
  ORGANIZER: "Данные организатора",
  ADMIN: "Заведён администратором",
};

/** Область значения характеристики. */
export const SCOPE_LABELS: Readonly<Record<string, string>> = {
  "per-robot": "на робота",
  "per-station": "на станцию",
  "per-channel": "на канал",
  "per-fleet": "на весь парк",
};

/** Подписи типов объектов (для параметров и процессов). */
export const FACILITY_NAMES: Readonly<Record<string, string>> = {
  warehouse: "Склад",
  airport: "Аэропорт",
  medical: "Медучреждение",
};

/** Сущности журнала администратора. */
export const ENTITY_LABELS: Readonly<Record<string, string>> = {
  product: "Продукт",
  characteristic: "Характеристика",
  norm: "Норматив",
  paramDefinition: "Параметр объекта",
  catalog: "Каталог",
};

/** Поля продукта в журнале. */
export const PRODUCT_FIELD_LABELS: Readonly<Record<string, string>> = {
  name: "Название",
  manufacturer: "Производитель",
  country: "Страна",
  solutionType: "Тип решения",
  status: "Статус",
  excluded: "Исключён из подбора",
  excludedReason: "Причина исключения",
  archived: "В архиве",
  create: "Создание продукта",
  delete: "Удаление продукта",
  revert: "Возврат данных организатора",
};

/** Поля описания параметра объекта в журнале. */
export const PARAM_FIELD_LABELS: Readonly<Record<string, string>> = {
  base: "Базовое значение",
  min: "Минимум",
  max: "Максимум",
  required: "Обязательный",
  hint: "Подсказка",
  example: "Пример",
};

/** Ключи вложенных значений журнала (снимок характеристики, итог обновления каталога). */
const VALUE_KEY_LABELS: Readonly<Record<string, string>> = {
  display: "значение",
  unit: "единица",
  sourceUrl: "источник",
  verifiedAt: "дата проверки",
  confirmed: "подтверждено",
  note: "примечание",
  editedByAdmin: "правка администратора",
  characteristics: "характеристики",
  dataVersion: "версия данных",
  slug: "slug",
  name: "название",
  manufacturer: "производитель",
  status: "статус",
  solutionType: "тип решения",
  processes: "процессы",
  created: "создано",
  updated: "обновлено",
  skippedAdmin: "пропущено (правки администратора)",
  archived: "в архив",
  failed: "не записано",
  staleSources: "устаревших источников",
  releaseCreated: "новый выпуск",
};

/** Подпись поля строки журнала по сущности. */
export function changeFieldLabel(entity: string, field: string): string {
  switch (entity) {
    case "product":
      return PRODUCT_FIELD_LABELS[field] ?? field;
    case "characteristic":
      return charLabel(field);
    case "norm":
      return isNormKey(field) ? normDef(field).label : field === "value" ? "Значение" : field;
    case "paramDefinition":
      return PARAM_FIELD_LABELS[field] ?? field;
    case "catalog":
      return field === "refresh" ? "Обновление каталога" : field;
    default:
      return field;
  }
}

/**
 * Время записи. Часовой пояс зафиксирован (Москва) и подписан: сервер и браузер выдают одну
 * строку, а время без пояса вводит в заблуждение.
 */
const AT_FORMAT = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Moscow",
});

export function formatAdminTime(at: Date | string): string {
  const d = typeof at === "string" ? new Date(at) : at;
  if (Number.isNaN(d.getTime())) return "—";
  return `${AT_FORMAT.format(d)} МСК`;
}

/** Наибольшая длина значения журнала в таблице; длиннее — обрезается многоточием. */
const MAX_VALUE_LENGTH = 300;

function clip(s: string): string {
  return s.length > MAX_VALUE_LENGTH ? `${s.slice(0, MAX_VALUE_LENGTH - 1)}…` : s;
}

function formatScalar(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") return fx(v);
  if (typeof v === "boolean") return v ? "да" : "нет";
  if (typeof v === "string") return STATUS_LABELS[v] ?? v;
  return JSON.stringify(v);
}

/**
 * Значение журнала (Json) для людей: число по-русски, да/нет, перечень через запятую,
 * объект — «ключ: значение; …» с русскими подписями ключей.
 */
export function formatAdminValue(v: unknown): string {
  if (Array.isArray(v)) {
    if (v.length === 0) return "—";
    return clip(
      v
        .map((item) =>
          item !== null && typeof item === "object" && !Array.isArray(item)
            ? formatAdminValue(item)
            : formatScalar(item),
        )
        .join(", "),
    );
  }
  if (v !== null && typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>);
    if (entries.length === 0) return "—";
    const parts = entries.map(([k, val]) => {
      const label = VALUE_KEY_LABELS[k] ?? k;
      if (k === "display") return formatScalar(val);
      if (k === "key" && typeof val === "string") return charLabel(val);
      return `${label}: ${Array.isArray(val) ? formatAdminValue(val) : formatScalar(val)}`;
    });
    return clip(parts.join("; "));
  }
  return clip(formatScalar(v));
}

/**
 * Число для поля ввода: без разделителей групп, с десятичной запятой («0,775», «2700000»).
 * Сервер разбирает и запятую, и точку. null — пустое поле.
 */
export function numberInputValue(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "";
  // String() пишет очень малые и очень большие числа экспонентой («1e-7»), а её разбор не
  // принимает: такие числа выводятся с фиксированной точкой.
  const s = /e/i.test(String(n)) ? n.toFixed(12).replace(/\.?0+$/, "") : String(n);
  return s.replace(".", ",");
}

/** Дата для <input type="date">: ГГГГ-ММ-ДД или пусто. */
export function dateInputValue(d: Date | string | null | undefined): string {
  if (!d) return "";
  if (typeof d === "string") return /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : "";
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

// ——————————————————————————— Форма характеристики ———————————————————————————

/** Вид ключа словаря характеристик: число, диапазон, текст, перечень. */
export type CharKind = "num" | "range" | "text" | "list";

/** Текущие поля характеристики — из них форма правки берёт начальные значения. */
export type CharEditorValues = {
  valueNum: number | null;
  valueMin: number | null;
  valueMax: number | null;
  qualifier: string | null;
  valueText: string | null;
  valueList: string[];
  unit: string | null;
  scope: string | null;
  sourceUrl: string | null;
  /** YYYY-MM-DD. */
  verifiedAt: string | null;
  confirmed: boolean;
  note: string | null;
};

/** Поля характеристики карточки каталога → начальные значения формы правки. */
export function charEditorValues(c: CatalogCharacteristic): CharEditorValues {
  return {
    valueNum: c.valueNum,
    valueMin: c.valueMin,
    valueMax: c.valueMax,
    qualifier: c.qualifier,
    valueText: c.valueText,
    valueList: [...c.valueList],
    unit: c.unit,
    scope: c.scope,
    sourceUrl: c.sourceUrl,
    verifiedAt: c.verifiedAt,
    confirmed: c.confirmed,
    note: c.note,
  };
}

/** Начальные значения полей формы характеристики — строками, как их покажет и отправит форма. */
export type CharEditorDefaults = {
  valueNum: string;
  valueMin: string;
  valueMax: string;
  qualifier: string;
  scope: string;
  /** Для перечня поле единицы не показывается. */
  unit: string;
  /** Текст; у перечня — пункты по одному на строку. */
  valueText: string;
  sourceUrl: string;
  verifiedAt: string;
  confirmed: boolean;
  note: string;
};

/**
 * Начальные значения формы правки характеристики. Нажать «Сохранить» без правок — значит
 * отправить ровно сохранённое, поэтому:
 * - пункты перечня идут по одному на строку: внутри пункта бывает «;» («Wi-Fi 802.11 a/c/n;
 *   открытое API»), и разделитель «;» разрезал бы такой пункт на два;
 * - единица существующей строки — её собственная, даже пустая: единица словаря только
 *   подсказка (placeholder). Иначе пустая единица вернулась бы единицей словаря, значение
 *   считалось бы изменённым, и правка одной даты стёрла бы цитату и основание источника.
 *   Новой строке единица словаря подставляется сразу.
 */
export function charEditorDefaults(
  kind: CharKind,
  c: CharEditorValues | null,
  dictUnit: string | null,
): CharEditorDefaults {
  return {
    valueNum: numberInputValue(c?.valueNum),
    valueMin: numberInputValue(c?.valueMin),
    valueMax: numberInputValue(c?.valueMax),
    qualifier: c?.qualifier ?? "",
    scope: c?.scope ?? "",
    unit: kind === "list" ? "" : c ? (c.unit ?? "") : (dictUnit ?? ""),
    valueText: kind === "list" ? (c?.valueList ?? []).join("\n") : (c?.valueText ?? ""),
    sourceUrl: c?.sourceUrl ?? "",
    verifiedAt: dateInputValue(c?.verifiedAt),
    confirmed: c?.confirmed ?? false,
    note: c?.note ?? "",
  };
}
