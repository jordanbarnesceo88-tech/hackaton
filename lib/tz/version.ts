/**
 * Версии модели и данных для воспроизводимости (ТЗ §3.1.5): проект хранит версию модели и хэш
 * использованных данных, и при повторном открытии видно, считался ли он на тех же данных.
 * Чистые функции без Date и случайности — одинаковый результат в Node и в браузере.
 */

export { SIM_MODEL_VERSION } from "../sim/types";

/**
 * Версия экономической модели по методике ТЗ. Повышается при любом изменении, которое меняет
 * числа результата (такое изменение помечается в CHANGELOG «МЕНЯЕТ ЧИСЛА»).
 */
export const TZ_MODEL_VERSION = "tz-1.0.0" as const;

/**
 * Канонический JSON: ключи объектов отсортированы, массивы в исходном порядке, поля со
 * значением undefined (а также функции и символы) пропускаются — как в JSON.stringify; в
 * массиве такие элементы и «дыры» разреженного массива становятся null, чтобы не сдвигать
 * индексы. Объекты с `toJSON`
 * (например, даты) сериализуются через него.
 *
 * Бросает ошибку на NaN и ±∞ (JSON.stringify молча превратил бы их в null, и хэш совпал бы у
 * разных данных), на BigInt, Map, Set и циклические ссылки — всё это нельзя однозначно
 * записать в JSON.
 */
export function stableJson(value: unknown): string {
  const out = serialize(value, new Set<object>(), "$");
  // undefined на верхнем уровне сериализуется как null: у хэша должен быть вход.
  return out ?? "null";
}

/** Сериализует значение; undefined означает «пропустить поле». */
function serialize(value: unknown, stack: Set<object>, path: string): string | undefined {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) {
        throw new Error(`stableJson: нечисловое значение ${String(value)} в ${path}`);
      }
      return JSON.stringify(value);
    case "bigint":
      throw new Error(`stableJson: BigInt не поддерживается (${path})`);
    case "undefined":
    case "function":
    case "symbol":
      return undefined;
  }

  const obj = value as object;
  if (typeof (obj as { toJSON?: unknown }).toJSON === "function") {
    return serialize((obj as { toJSON: () => unknown }).toJSON(), stack, path);
  }
  if (obj instanceof Map || obj instanceof Set) {
    throw new Error(`stableJson: Map и Set не поддерживаются — преобразуйте в массив (${path})`);
  }
  if (stack.has(obj)) throw new Error(`stableJson: циклическая ссылка в ${path}`);
  stack.add(obj);
  try {
    if (Array.isArray(obj)) {
      // Обход по индексу, а не map: map пропускает «дыры» разреженного массива ([1, , 3]), и
      // получилось бы «[1,,3]» — не JSON. Дыра читается как undefined и становится null.
      const items = obj as unknown[];
      const parts: string[] = [];
      for (let i = 0; i < items.length; i++) {
        parts.push(serialize(items[i], stack, `${path}[${i}]`) ?? "null");
      }
      return `[${parts.join(",")}]`;
    }
    const record = obj as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of Object.keys(record).sort()) {
      const s = serialize(record[key], stack, `${path}.${key}`);
      if (s !== undefined) parts.push(`${JSON.stringify(key)}:${s}`);
    }
    return `{${parts.join(",")}}`;
  } finally {
    stack.delete(obj);
  }
}

/** Кодирует строку в байты UTF-8 (без TextEncoder, чтобы функция была чистой и переносимой). */
function utf8Bytes(s: string): number[] {
  const bytes: number[] = [];
  for (const ch of s) {
    // for…of идёт по кодовым точкам, поэтому суррогатные пары уже склеены.
    const cp = ch.codePointAt(0) ?? 0xfffd;
    if (cp < 0x80) {
      bytes.push(cp);
    } else if (cp < 0x800) {
      bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    } else if (cp < 0x10000) {
      // Одиночный суррогат кодируется как U+FFFD, как это делает TextEncoder.
      const c = cp >= 0xd800 && cp <= 0xdfff ? 0xfffd : cp;
      bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    } else {
      bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    }
  }
  return bytes;
}

/**
 * 32-битный хэш FNV-1a от UTF-8 байтов строки — 8 шестнадцатеричных символов в нижнем
 * регистре. Не криптографический: нужен, чтобы коротко и детерминированно отличать версии
 * данных, а не защищать их.
 */
export function fnv1a32(s: string): string {
  let hash = 0x811c9dc5;
  for (const byte of utf8Bytes(s)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Версия данных расчёта: хэш канонического JSON снимков (продукты, нормативы, версия данных
 * организатора). Порядок ключей не влияет на результат, любое изменение значения — влияет.
 */
export function dataVersionOf(value: unknown): string {
  return fnv1a32(stableJson(value));
}
