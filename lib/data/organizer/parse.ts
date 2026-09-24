import type { Range } from "../../tz/types";

/**
 * Разбор «грязных» значений из выгрузок организатора и кураторского свода: цены в формате
 * «2 700 000,00», числа с запятой, диапазоны «80–100», оговорки «до 10», «от 100 000»,
 * «≈300 000». Используется генератором scripts/gen-organizer-seed.ts; чистые функции без
 * зависимостей, поэтому их же проверяют тесты данных.
 *
 * Правило разбора строгое: если после отбрасывания пояснения в скобках и единицы остаётся
 * что-то кроме числа или диапазона, функция возвращает null, и значение сохраняется как текст.
 * Лучше показать «0,75 (750 мм); для разворота 900 мм» текстом, чем молча выбрать одно из чисел.
 */

/** Числовое значение характеристики: число или диапазон с оговоркой. */
export type ParsedNumber = number | Range;

const MINUS = /[−–—]/g;

/**
 * Число в русской записи: пробелы (в т. ч. неразрывные и узкие) как разделители разрядов,
 * запятая или точка как десятичный знак, «−» как минус. «2 700 000,00» → 2700000.
 * null — строка не является одним числом.
 */
export function parseRuNumber(raw: string): number | null {
  const s = raw
    .replace(/[\s   ]/g, "")
    .replace(MINUS, "-")
    .replace(",", ".");
  if (!/^[-+]?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Округление для середины диапазона: без хвостов двоичной арифметики (0.875, а не 0.8750000001). */
function mid(a: number, b: number): number {
  return Math.round(((a + b) / 2) * 1e6) / 1e6;
}

/** Хвост после числа, который допустим как «единица»: без цифр и не длиннее 16 символов. */
function isUnitTail(tail: string): boolean {
  const t = tail.trim();
  return t.length <= 16 && !/\d/.test(t);
}

/** Одно число с возможной единицей после него: «1500», «1,5 м/с», «±3», «5 лет». */
function parseSingle(s: string): number | null {
  const m = /^[±]?\s*([-+−]?\d[\d\s  ]*(?:[.,]\d+)?)(.*)$/.exec(s.trim());
  if (!m || m[1] === undefined) return null;
  if (!isUnitTail(m[2] ?? "")) return null;
  return parseRuNumber(m[1]);
}

/**
 * Разбирает текст ячейки в число или диапазон по строгой грамматике:
 * - «1500», «1,5», «±10», «5 лет» → число;
 * - «до 10», «до 10 (с 80% до 20% заряда)» → { max: 10, typical: 10, qualifier: "до" };
 * - «от 100 000» → { min: 100000, typical: 100000, qualifier: "от" };
 * - «≈300 000», «около 18» → { typical, qualifier: "≈" };
 * - «80–100», «1.4–7», «6-8» → { min, max, typical: середина };
 * - «20 (при средних нагрузках) / 10 (при максимальных)» → { min: 10, max: 20, typical: 15 }.
 * Пояснение в скобках и всё после «;» отбрасываются (исходный текст хранится в asInSource).
 * null — текст не сводится к числу; вызывающий сохраняет его как строку.
 */
export function parseNumericText(raw: string | number | null | undefined): ParsedNumber | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  // Сначала пояснения в скобках (внутри них бывает «;»), затем всё после «;», затем
  // незакрытая скобка — хвост пояснения.
  let s = raw.replace(/\([^)]*\)/g, " ");
  s = (s.split(";")[0] ?? "").replace(/\(.*$/, " ").replace(/\s+/g, " ").trim();
  if (!s) return null;

  // «A / B» — два значения при разных условиях → диапазон.
  const slash = s.split(" / ");
  if (slash.length === 2) {
    const a = parseSingle(slash[0] ?? "");
    const b = parseSingle(slash[1] ?? "");
    if (a === null || b === null) return null;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    return { min: lo, max: hi, typical: mid(lo, hi) };
  }

  let qualifier: Range["qualifier"];
  const q = /^(до|от|≈|~|около|примерно|не более|не менее|≥|≤)\s*/i.exec(s);
  if (q && q[1] !== undefined) {
    const word = q[1].toLowerCase();
    qualifier =
      word === "до" || word === "не более" || word === "≤"
        ? "до"
        : word === "от" || word === "не менее" || word === "≥"
          ? "от"
          : "≈";
    s = s.slice(q[0].length);
  }

  // Диапазон «A–B» (тире, дефис или «…»).
  const range = /^([-+−]?\d[\d\s  ]*(?:[.,]\d+)?)\s*(?:–|—|-|…|\.\.\.)\s*(\d[\d\s  ]*(?:[.,]\d+)?)(.*)$/.exec(s);
  if (range && range[1] !== undefined && range[2] !== undefined) {
    if (!isUnitTail(range[3] ?? "")) return null;
    const lo = parseRuNumber(range[1]);
    const hi = parseRuNumber(range[2]);
    if (lo === null || hi === null || hi < lo) return null;
    const r: Range = { min: lo, max: hi, typical: mid(lo, hi) };
    if (qualifier === "≈") r.qualifier = "≈";
    return r;
  }

  const single = parseSingle(s);
  if (single === null) return null;
  if (qualifier === "до") return { max: single, typical: single, qualifier: "до" };
  if (qualifier === "от") return { min: single, typical: single, qualifier: "от" };
  if (qualifier === "≈") return { typical: single, qualifier: "≈" };
  return single;
}

/** Типичное значение числа или диапазона. */
export function typicalOf(v: ParsedNumber): number {
  return typeof v === "number" ? v : v.typical;
}

/**
 * Температурный диапазон из текста условий эксплуатации: «+5…+25 °C», «от -10 до +30 °C»,
 * «−40…+50 °C». null — диапазон в тексте не найден (одна граница не считается диапазоном).
 */
export function parseTempRange(raw: string): { min: number; max: number } | null {
  const s = raw.replace(MINUS, "-").replace(/˚/g, "°");
  const m =
    /(?:от\s*)?([-+]?\d+)\s*°?\s*[CС]?\s*(?:…|\.\.\.|до|-)\s*([-+]?\d+)\s*°\s*[CС]/i.exec(s) ??
    /от\s*([-+]?\d+)\s*°?\s*[CС]?\s*до\s*([-+]?\d+)/i.exec(s);
  if (!m || m[1] === undefined || m[2] === undefined) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a >= b) return null;
  return { min: a, max: b };
}

const TRANSLIT: Readonly<Record<string, string>> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
  х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

/** Шаблон slug: латиница и цифры, слова через дефис. */
export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Slug из названия: часть до первой скобки, транслитерация, kebab-case, не длиннее `maxLen`
 * (обрезка по границе слова). Пустая строка — в названии нет латиницы, кириллицы и цифр.
 */
export function slugify(name: string, maxLen = 48): string {
  const head = name.split("(")[0]?.trim() || name;
  const lat = [...head.toLowerCase()].map((ch) => TRANSLIT[ch] ?? ch).join("");
  let slug = lat.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (slug.length > maxLen) {
    const cut = slug.slice(0, maxLen);
    const at = cut.lastIndexOf("-");
    slug = at > 0 ? cut.slice(0, at) : cut;
  }
  return slug;
}

/**
 * Описание не длиннее `max` символов: обрезка по границе слова с многоточием. Пробелы и
 * переводы строк схлопываются.
 */
export function cutDescription(raw: string, max = 200): string {
  const s = raw.replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const at = cut.lastIndexOf(" ");
  const base = (at > max / 2 ? cut.slice(0, at) : cut).replace(/[\s,.;:—–-]+$/, "");
  return `${base}…`;
}

/**
 * Пример значения для подсказки поля: «например, 20 000», «например, 1,302». Разряды
 * разделяются обычным пробелом, дробная часть — запятой. Своя реализация вместо Intl, чтобы
 * сгенерированный файл не зависел от версии ICU в Node.
 */
export function formatExample(value: number | string): string {
  if (typeof value === "string") return `например, ${value}`;
  const neg = value < 0;
  const [int = "0", frac] = String(Math.abs(value)).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `например, ${neg ? "−" : ""}${grouped}${frac ? `,${frac}` : ""}`;
}
