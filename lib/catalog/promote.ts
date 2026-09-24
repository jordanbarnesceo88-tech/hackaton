import { FLAG_NOTES } from "../tz/selection/missing";
import {
  asFlags,
  asQualifier,
  asScope,
  charLabel,
  charStats,
  compareCharKeys,
  finiteOrNull,
  formatCharValue,
  isCharPresent,
  usableThroughput,
} from "./product-for-calc";
import type { CharRow } from "./product-for-calc";

/**
 * Вынесенные колонки продукта каталога (CatalogProduct.priceRub, throughputPerH, …,
 * needsVerification). Источник правды — характеристики с провенансом (ProductCharacteristic);
 * колонки — их копии для фильтров, сортировки и списка каталога (ТЗ §3.3.7), и руками их не
 * правят. Их пересчитывает синхронизация (T2.1) и правка администратора (T3.4) этой функцией,
 * поэтому в колонку попадает ровно то число, что и в расчёт: производительность «до X» без
 * нижней границы и значение «на весь парк» не выносятся (см. `usableThroughput`).
 *
 * Модуль чистый: без Prisma и без обращения к БД.
 */

/** Колонки CatalogProduct, которые вычисляются из характеристик. */
export type PromotedColumns = {
  priceRub: number | null;
  raasRubMonth: number | null;
  throughputPerH: number | null;
  throughputUnit: string | null;
  payloadKg: number | null;
  speedMps: number | null;
  completenessPct: number;
  confirmedSharePct: number;
  needsVerification: boolean;
};

/**
 * Порог полноты карточки, ниже которого продукт «требует проверки», %. Это решение модели
 * (origin choice), а не факт о мире: утверждённый план, раздел 4 «Подбор», задаёт условие
 * «полнота < 60 %», и подбор T1.4 применяет тот же порог к своему признаку needsVerification.
 * 60 % из 31 обязательного ключа ТЗ §3.3.4 — не меньше 19 заполненных характеристик.
 */
export const NEEDS_VERIFICATION_COMPLETENESS_PCT = 60;

/**
 * Допуск, в пределах которого другое найденное значение считается согласным с основным, доля.
 * Решение модели (origin choice): тот же допуск 10 %, по которому генератор данных (T1.1)
 * признаёт значение организатора подтверждённым, если первоисточник совпадает с ним. Значение,
 * отличающееся сильнее, — расхождение источников, и продукт получает «требует проверки».
 */
export const ALTERNATIVE_AGREEMENT_TOLERANCE = 0.1;

/**
 * Параметры пересчёта: пометки качества продукта (CatalogProduct.flags). Обязательны: любая
 * пометка включает «требует проверки» (утверждённый план, раздел 4), и вызов без них дал бы
 * помеченному продукту needsVerification = false — колонка каталога разошлась бы с подбором.
 * Продукт без пометок передаёт `{ flags: [] }`.
 */
export type PromoteOptions = {
  flags: readonly string[];
};

/** Число из значения альтернативы: число или typical диапазона; прочее — null. */
function alternativeNumber(value: unknown): number | null {
  if (typeof value === "number") return finiteOrNull(value);
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const typical = (value as { typical?: unknown }).typical;
    return typeof typical === "number" ? finiteOrNull(typical) : null;
  }
  return null;
}

/**
 * Есть ли у характеристики расхождение источников: другое найденное числовое значение
 * отличается от основного больше чем на `ALTERNATIVE_AGREEMENT_TOLERANCE`, или записано в
 * другой единице (сравнить нельзя — нужна проверка человеком). Текстовые альтернативы
 * расхождением не считаются: разная формулировка одного факта — не конфликт чисел.
 * Альтернативы берутся из JSON-колонки как есть, поэтому разбор защищён от любой формы.
 */
export function hasConflictingAlternatives(c: Pick<CharRow, "valueNum" | "unit" | "alternatives">): boolean {
  const primary = finiteOrNull(c.valueNum);
  if (primary === null || !Array.isArray(c.alternatives)) return false;
  for (const alt of c.alternatives as unknown[]) {
    if (alt === null || typeof alt !== "object") continue;
    const record = alt as { value?: unknown; unit?: unknown };
    const value = alternativeNumber(record.value);
    if (value === null) continue;
    const altUnit = typeof record.unit === "string" && record.unit.trim() !== "" ? record.unit.trim() : null;
    const unit = c.unit !== null && c.unit.trim() !== "" ? c.unit.trim() : null;
    if (altUnit !== null && unit !== null && altUnit !== unit) return true;
    if (primary === 0) {
      if (value !== 0) return true;
      continue;
    }
    if (Math.abs(value - primary) / Math.abs(primary) > ALTERNATIVE_AGREEMENT_TOLERANCE) return true;
  }
  return false;
}

/**
 * Почему паспортная производительность не идёт в расчёт — по-русски, в том же порядке проверок,
 * что и `usableThroughput`; null — значение пригодно для расчёта.
 */
function unusableThroughputReason(c: CharRow): string | null {
  if (finiteOrNull(c.valueNum) === null) {
    if (finiteOrNull(c.valueMin) !== null || finiteOrNull(c.valueMax) !== null) {
      return `производительность указана без типичного значения («${formatCharValue(c)}») — числа для расчёта нет`;
    }
    return "производительность указана только текстом, числа для расчёта нет";
  }
  if (asQualifier(c.qualifier) === "до" && finiteOrNull(c.valueMin) === null) {
    return `указан только предел производительности («${formatCharValue(c)}»), а не типичное значение — в расчёт не идёт`;
  }
  if (asScope(c.scope) === "per-fleet") {
    return "производительность указана на весь парк, а не на одного робота — в расчёт не идёт";
  }
  return null;
}

/**
 * Почему продукт «требует проверки» (ТЗ §3.4) — причины по-русски, без повторов; пустой
 * список — проверка не нужна. Условия утверждённого плана (раздел 4): любая пометка качества,
 * неподтверждённая (или отсутствующая) цена, неподтверждённая (или непригодная для расчёта)
 * производительность, полнота карточки ниже порога и расхождение источников по какой-либо
 * характеристике.
 *
 * Пометки сужаются `asFlags`: неизвестная строка отбрасывается — у неё нет текста, и она не
 * может включить «требует проверки» без видимой причины. Тексты пометок — `FLAG_NOTES` подбора
 * (lib/tz/selection/missing.ts), чтобы каталог и подбор объясняли одну пометку одинаково.
 */
export function verificationReasons(chars: readonly CharRow[], opts: PromoteOptions): string[] {
  const reasons: string[] = [];
  const add = (reason: string) => {
    if (!reasons.includes(reason)) reasons.push(reason);
  };
  for (const flag of asFlags(opts.flags)) add(FLAG_NOTES[flag]);

  const price = chars.find((c) => c.key === "priceRub");
  const priceRub = finiteOrNull(price?.valueNum);
  if (priceRub === null) add("цена не опубликована");
  else if (!price?.confirmed) add("цена не подтверждена первоисточником");

  const throughput = chars.find((c) => c.key === "throughput");
  if (throughput === undefined || !isCharPresent(throughput)) add("производительность не опубликована");
  else {
    const unusable = unusableThroughputReason(throughput);
    if (unusable !== null) add(unusable);
    else if (!throughput.confirmed) add("производительность не подтверждена первоисточником");
  }

  const { completenessPct } = charStats(chars);
  if (completenessPct < NEEDS_VERIFICATION_COMPLETENESS_PCT) {
    add(`полнота карточки ${completenessPct} % — ниже ${NEEDS_VERIFICATION_COMPLETENESS_PCT} %`);
  }

  // Подписи по-русски в порядке словаря — от порядка строк в БД текст не зависит.
  const conflicts = chars
    .filter((c) => hasConflictingAlternatives(c))
    .map((c) => c.key)
    .sort(compareCharKeys)
    .map(charLabel);
  if (conflicts.length > 0) add(`источники расходятся: ${[...new Set(conflicts)].join(", ")}`);
  return reasons;
}

/**
 * Вынесенные колонки из характеристик продукта и его пометок качества (`flags` обязательны —
 * см. `PromoteOptions`).
 */
export function promoteColumns(chars: readonly CharRow[], opts: PromoteOptions): PromotedColumns {
  const byKey = new Map<string, CharRow>();
  for (const c of chars) if (!byKey.has(c.key)) byKey.set(c.key, c);
  const num = (key: string): number | null => finiteOrNull(byKey.get(key)?.valueNum);

  const throughput = byKey.get("throughput");
  const throughputPerH = usableThroughput(throughput);
  const stats = charStats(chars);
  return {
    priceRub: num("priceRub"),
    raasRubMonth: num("raasRubMonth"),
    throughputPerH,
    // Единица в колонке — только вместе с числом: без числа ей нечего подписывать.
    throughputUnit: throughputPerH !== null ? (throughput?.unit ?? null) : null,
    payloadKg: num("payloadKg"),
    speedMps: num("speedMps"),
    completenessPct: stats.completenessPct,
    confirmedSharePct: stats.confirmedSharePct,
    needsVerification: verificationReasons(chars, opts).length > 0,
  };
}
