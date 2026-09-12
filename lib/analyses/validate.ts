import type { FacilityParams, AssumptionValues } from "@/lib/economics/types";
// Остаток Ч-3: набор «только целые годы» берётся из модели, а не заводится здесь заново —
// поле панели приводит к целому по тому же списку, и разойтись им нельзя.
import {
  DEFAULT_ASSUMPTIONS,
  ASSUMPTION_BOUNDS,
  WHOLE_YEAR_ASSUMPTIONS,
} from "@/lib/economics/assumptions";

// Saved-analysis payloads arrive from the client and are persisted as-is (jsonb), so validate
// shape and bound sizes here before they touch the DB. Pure + framework-free so it's unit
// testable; the solution-existence check lives in the server action (needs DB access).

export const NAME_MAX_LEN = 120;

/**
 * Потолки на карту занятости. Она приходит от клиента и ложится в jsonb как есть, поэтому у
 * неё обязан быть размер: без него подделанный payload кладёт в сохранённый расчёт — и в
 * клиентский отчёт — произвольный объём произвольных ключей.
 *
 * Сорок с запасом: применимых задач у типа объекта единицы. Те же числа применяет разбор
 * query-строки (`lib/wizard/steps.ts`) — граница у сохранения и у ссылки обязана быть одна.
 */
export const MAX_TASK_KEYS = 40;
export const MAX_TASK_SLUG_LEN = 200;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Параметр объекта: конечный и строго положительный.
 *
 * Раньше проверялась только конечность, и ноль с отрицательными сохранялись — объект площадью
 * −5000 м² попадал в документ, который показывают клиенту. Правило то же, что у `num()` в
 * `lib/wizard/steps.ts`: два места, решающие, что такое годный параметр, обязаны решать
 * одинаково, иначе ссылка, отклонённая визардом, сохраняется как ни в чём не бывало.
 *
 * Верхней границы нет намеренно: её нет нигде в приложении, и завести её здесь значило бы
 * придумать правило, которого не знает остальной код.
 */
function isPositiveNumber(v: unknown): v is number {
  return isFiniteNumber(v) && v > 0;
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
  if (!isPositiveNumber(areaM2) || !isPositiveNumber(opsPerDay) || !isPositiveNumber(staffCount)) {
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
    const entries = Object.entries(taskStaffing);
    if (entries.length > MAX_TASK_KEYS) return null;
    let claimed = 0;
    for (const [slug, v] of entries) {
      if (slug.length === 0 || slug.length > MAX_TASK_SLUG_LEN) return null;
      if (!isFiniteNumber(v) || v < 0) return null;
      claimed += v;
    }
    // Г-2 на границе СОХРАНЕНИЯ, а не только на экране.
    //
    // Экран занятости складывает то же самое и блокирует «Далее», но экран — не граница:
    // сохранение принимает payload, а не нажатие кнопки. Потолок в движке стоит НА РЕШЕНИЕ
    // (`min(staffCount, …)` в calculate.ts), суммы по задачам не проверял никто, и занятости,
    // сложившиеся больше штата, ложились в jsonb молча — а строка «остальные N человек не
    // роботизируем» показала бы по ним отрицательное N.
    //
    // Допуск в одну сотую: занятость по нормативу дробная (6,3 человека на отборе), и сумма
    // трёх таких чисел не обязана попадать в штат до последнего разряда с плавающей точкой.
    if (claimed > staffCount + 0.01) return null;
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
    if (WHOLE_YEAR_ASSUMPTIONS.has(k) && !Number.isInteger(v)) return null;
    out[k] = v;
  }
  return out;
}
