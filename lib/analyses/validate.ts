import type { FacilityParams, AssumptionValues } from "@/lib/economics/types";
import { DEFAULT_ASSUMPTIONS, ASSUMPTION_BOUNDS } from "@/lib/economics/assumptions";

// Saved-analysis payloads arrive from the client and are persisted as-is (jsonb), so validate
// shape and bound sizes here before they touch the DB. Pure + framework-free so it's unit
// testable; the solution-existence check lives in the server action (needs DB access).

export const NAME_MAX_LEN = 120;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Trim and length-cap a user-supplied name; null if not a non-empty string. */
export function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (t.length === 0) return null;
  return t.slice(0, NAME_MAX_LEN);
}

/**
 * Validate facility params: three required finite numbers, optional finite peakConcurrent, and
 * the optional user overrides.
 *
 * Переопределения обязаны пройти отсюда до отчёта. Собирая объект из перечисленных полей, эта
 * функция МОЛЧА отбрасывала всё остальное — и сохранённый отчёт показывал введённые руками
 * количество и цену как вычисленные. Это ровно то, что спека переопределений запрещает: клиент
 * получает документ, где число выдано за расчётное.
 *
 * Негодное значение отклоняет весь платёж, а не отбрасывается: так же ведёт себя
 * peakConcurrent, и по той же причине — молча сохранить не то, что прислали, хуже, чем
 * отказать.
 */
export function validateParams(raw: unknown): FacilityParams | null {
  if (!isPlainObject(raw)) return null;
  const { areaM2, opsPerDay, staffCount, peakConcurrent } = raw;
  const { quantityOverride, capexPerUnitUsdOverride, taskStaffing } = raw;
  if (!isFiniteNumber(areaM2) || !isFiniteNumber(opsPerDay) || !isFiniteNumber(staffCount)) {
    return null;
  }
  if (peakConcurrent !== undefined && !isFiniteNumber(peakConcurrent)) return null;
  // Те же правила, что и в движке: целое ≥ 1 для количества, положительное для цены.
  if (
    quantityOverride !== undefined &&
    !(typeof quantityOverride === "number" && Number.isInteger(quantityOverride) && quantityOverride >= 1)
  ) {
    return null;
  }
  if (
    capexPerUnitUsdOverride !== undefined &&
    !(isFiniteNumber(capexPerUnitUsdOverride) && capexPerUnitUsdOverride > 0)
  ) {
    return null;
  }
  // Занятость по задачам: на сохранении ОТКЛОНЯЕМ негодное, а не подчищаем. Подчистка означала
  // бы, что сохранённый расчёт отличается от того, что человек отправил, и никто ему об этом не
  // сказал. Ноль допустим — это ответ «никто не занят», а не пропуск.
  if (taskStaffing !== undefined) {
    if (!isPlainObject(taskStaffing)) return null;
    for (const v of Object.values(taskStaffing)) {
      if (!isFiniteNumber(v) || v < 0) return null;
    }
  }

  const out: FacilityParams = { areaM2, opsPerDay, staffCount };
  if (peakConcurrent !== undefined) out.peakConcurrent = peakConcurrent;
  if (quantityOverride !== undefined) out.quantityOverride = quantityOverride;
  if (capexPerUnitUsdOverride !== undefined) {
    out.capexPerUnitUsdOverride = capexPerUnitUsdOverride;
  }
  if (taskStaffing !== undefined) {
    out.taskStaffing = taskStaffing as Record<string, number>;
  }
  return out;
}

// Derive the key list from DEFAULT_ASSUMPTIONS (which is typed AssumptionValues, so it is
// exhaustive by construction) rather than hand-maintaining a parallel list — a new assumption
// added to the model is then validated automatically instead of being silently stripped.
const ASSUMPTION_KEYS = Object.keys(DEFAULT_ASSUMPTIONS) as (keyof AssumptionValues)[];

/**
 * Validate the assumptions bag: every known key present, a finite number, and inside its
 * accepted range. The range check is defence in depth — the panel already clamps on input, so
 * only a crafted payload reaches here out of bounds, and persisting one would put an
 * unreachable-by-UI figure into a saved analysis and its client-facing report.
 */
export function validateAssumptions(raw: unknown): AssumptionValues | null {
  if (!isPlainObject(raw)) return null;
  const out = {} as AssumptionValues;
  for (const k of ASSUMPTION_KEYS) {
    const v = raw[k];
    if (!isFiniteNumber(v)) return null;
    const { min, max } = ASSUMPTION_BOUNDS[k];
    if (v < min || v > max) return null;
    out[k] = v;
  }
  return out;
}
