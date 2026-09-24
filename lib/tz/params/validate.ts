import type { ParamIssue, ParamSpec, ParamValues } from "../types";
import {
  duplicateKeyIssue,
  lockedChangedIssue,
  missingRequiredIssue,
  outOfRangeIssue,
  unitMismatchIssue,
  unknownKeyIssue,
} from "./messages";
import { coerce, isAbsent, isBlank, isOutOfRange, sameParamValue, unitsCompatible } from "./schema";

/**
 * Проверка параметров объекта (ТЗ §3.2.4): полнота, формат, типы, единицы и диапазоны — для
 * ручного ввода, загрузки Excel/CSV и API. Чистая функция: работает и в браузере.
 */

/**
 * Откуда пришли значения. Отличие одно: неизвестный ключ в форме ручного ввода молча
 * игнорируется (форма строится по описаниям, лишнее поле — не ошибка пользователя), а в файле
 * и в API это ошибка — пользователь должен увидеть, что строка не загрузится.
 */
export type ParamInputOrigin = "manual" | "upload" | "api";

/**
 * Одно введённое значение с контекстом из файла: единица из столбца «Единица» и номер строки.
 * Список записей, в отличие от объекта, может содержать один ключ дважды — так ловится
 * `duplicate_key`.
 */
export type RawParamEntry = {
  key: string;
  value: unknown;
  /** Единица, указанная рядом со значением; пусто — не проверяется. */
  unit?: string | null;
  /** Номер строки файла (с 1) — попадает в сообщение. */
  row?: number;
};

export type ValidateOptions = { origin: ParamInputOrigin };

/** Итог проверки: полный набор приведённых значений и найденные проблемы. */
export type ParamValidation = { values: ParamValues; issues: ParamIssue[] };

function toEntries(raw: Readonly<Record<string, unknown>> | readonly RawParamEntry[]): readonly RawParamEntry[] {
  if (Array.isArray(raw)) return raw as readonly RawParamEntry[];
  return Object.keys(raw).map((key) => ({ key, value: (raw as Readonly<Record<string, unknown>>)[key] }));
}

/**
 * Проверяет введённые значения по описаниям параметров и возвращает полный набор значений
 * (`values` содержит все ключи `defs`) и проблемы (`issues`).
 *
 * Правила:
 * - значения нет (ключ не передан или null) → базовое значение организатора; если базового нет,
 *   а параметр обязателен — `missing_required`;
 * - значение явно пустое (пустая строка) у обязательного параметра → `missing_required`, даже
 *   если есть базовое: пользователь стёр поле сам; у необязательного → базовое значение;
 * - единица рядом со значением не совпадает с единицей параметра → `unit_mismatch`;
 * - тип, формат, знак, целочисленность, вариант перечисления → `coerce` (ошибки);
 * - зафиксированный организатором параметр изменён → `locked_changed` (предупреждение,
 *   значение принимается, изменение пишется в журнал вызывающим кодом);
 * - вне диапазона организатора → `out_of_range` (предупреждение, значение принимается);
 * - неизвестный ключ → `unknown_key` (ошибка для upload и api, для manual игнорируется);
 * - повтор ключа → `duplicate_key` (ошибка), берётся первое значение.
 *
 * При ошибке в `values` остаётся базовое значение (или null), чтобы набор всегда был полным и
 * типизированным — например, для пробного расчёта. Сохранять проект при ошибках нельзя:
 * это проверяет вызывающий код через `hasErrors(issues)`.
 */
export function validateParamValues(
  defs: readonly ParamSpec[],
  raw: Readonly<Record<string, unknown>> | readonly RawParamEntry[],
  opts: ValidateOptions,
): ParamValidation {
  const byKey = new Map<string, ParamSpec>();
  for (const def of defs) if (!byKey.has(def.key)) byKey.set(def.key, def);

  const firstEntry = new Map<string, RawParamEntry>();
  const extraIssues: ParamIssue[] = [];
  for (const e of toEntries(raw)) {
    const def = byKey.get(e.key);
    if (!def) {
      if (opts.origin !== "manual" && e.value !== undefined) extraIssues.push(unknownKeyIssue(e.key, e.row));
      continue;
    }
    const first = firstEntry.get(e.key);
    if (first) {
      extraIssues.push(duplicateKeyIssue(def, first.row, e.row));
      continue;
    }
    firstEntry.set(e.key, e);
  }

  const values: ParamValues = {};
  const issues: ParamIssue[] = [];
  for (const def of byKey.values()) {
    const e = firstEntry.get(def.key);
    const fallback = def.base;
    if (!e || isAbsent(e.value)) {
      values[def.key] = fallback;
      if (fallback === null && def.required) issues.push(missingRequiredIssue(def, e?.row));
      continue;
    }
    if (isBlank(def, e.value)) {
      values[def.key] = fallback;
      if (def.required) issues.push(missingRequiredIssue(def, e.row));
      continue;
    }
    const fileUnit = typeof e.unit === "string" ? e.unit.trim() : "";
    if (fileUnit && !unitsCompatible(fileUnit, def.unit)) {
      values[def.key] = fallback;
      issues.push(unitMismatchIssue(def, fileUnit, e.row));
      continue;
    }
    const res = coerce(def, e.value, e.row);
    if (!res.ok) {
      values[def.key] = fallback;
      issues.push(res.issue);
      continue;
    }
    const v = res.value;
    values[def.key] = v;
    if (def.locked) {
      if (!sameParamValue(v, def.base)) issues.push(lockedChangedIssue(def, e.row));
    } else if (isOutOfRange(def, v)) {
      issues.push(outOfRangeIssue(def, v as number, e.row));
    }
  }
  return { values, issues: [...issues, ...extraIssues] };
}

/**
 * Есть ли среди проблем ошибки (а не только предупреждения). Принимает и проблемы проверки, и
 * строки отчёта о загрузке файла (у них есть уровень «info»).
 */
export function hasErrors(issues: readonly { severity: string }[]): boolean {
  return issues.some((i) => i.severity === "error");
}
