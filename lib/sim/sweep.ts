import { SIM_LIMITS } from "./engine";
import { runSimSync } from "./runner";
import type { SimRunSummary } from "./metrics";
import type { SimInput } from "./types";

/**
 * Перебор по имитации: минимальный устойчивый парк и разброс результата по зёрнам генератора
 * (бонус ТЗ «оптимизация»: не формула, а проверка вариантов моделью).
 */

/** Вход с другим числом роботов (остальное, включая зерно и число зарядок, то же). */
function withFleet(input: SimInput, count: number): SimInput {
  return { ...input, robots: { ...input.robots, count } };
}

/**
 * Наименьшее n в [lo; hi], для которого `pred(n)` истинно, — двоичным поиском в предположении,
 * что `pred` монотонен (ложно, ложно, …, истинно, истинно). null — `pred` ложно во всём
 * диапазоне (при монотонности — на `hi`). Вызовов `pred` — не больше ⌈log₂(hi − lo + 2)⌉.
 *
 * Правый конец поиска — «часовой» hi + 1, условно истинный: поэтому самые дорогие прогоны
 * (наибольший парк) выполняются, только если меньшие парки не подтверждаются.
 *
 * Что гарантировано и без монотонности: результат r проверен — `pred(r)` истинно, и либо
 * r = lo, либо `pred(r − 1)` проверено и ложно. То есть r — точный порог «не держит → держит»,
 * а не непроверенная точка. Монотонность на эталонном складе проверяют тесты (sweep.test.ts).
 */
export function firstTrue(lo: number, hi: number, pred: (n: number) => boolean): number | null {
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo > hi) return null;
  // Инвариант: всё левее `a` ложно (проверено или следует из монотонности), `b` истинно
  // (проверено) или b = hi + 1 — часовой.
  let a = lo;
  let b = hi + 1;
  while (a < b) {
    const mid = a + Math.floor((b - a) / 2);
    if (pred(mid)) b = mid;
    else a = mid + 1;
  }
  return b <= hi ? b : null;
}

/** Параметры перебора парка. */
export type MinStableFleetOptions = {
  /**
   * Часы, мс (на сервере — `Date.now` или `performance.now` вызывающего кода: движку часы
   * запрещены). Без часов бюджет не проверяется.
   */
  now?: () => number;
  /**
   * Бюджет перебора, мс; по умолчанию 60 000 (ТЗ §4.3.3 — запуск модели не дольше 60 с).
   * Проверяется перед каждым прогоном: превышение — ошибка с name = 'SimBudgetExceeded'.
   */
  budgetMs?: number;
  /** Отмена между прогонами: ошибка с name = 'AbortError'. */
  signal?: AbortSignal;
};

function abortError(): Error {
  const err = new Error("Подбор минимального парка отменён");
  err.name = "AbortError";
  return err;
}

function budgetError(budgetMs: number): Error {
  const err = new Error(
    `Подбор минимального парка не уложился в ${Math.round(budgetMs / 1000)} с. ` +
      "Сузьте диапазон перебора или уменьшите длительность пикового окна.",
  );
  err.name = "SimBudgetExceeded";
  return err;
}

/**
 * Наименьшее число роботов в [min; max], при котором имитация подтверждает расчёт (вердикт
 * CONFIRMED); null — такого нет в диапазоне.
 *
 * Поиск двоичный (`firstTrue`): около log₂(max − min) прогонов вместо (max − min) — на крупном
 * объекте (50 000 м², 15 000 паллет/сут, расчётный парк 577) это ≈ 11 прогонов вместо сотен.
 * Двоичный поиск опирается на монотонность «больше роботов — не хуже». В модели она
 * ожидаема (поток заданий при одном зерне одинаков для любого парка, диспетчер без
 * случайности), тесты подтверждают её и сверяют результат с линейным перебором на эталонном
 * складе (зёрна 1–5). Даже если монотонность где-то нарушится, результат остаётся проверенным
 * порогом: при n роботов расчёт подтверждён, при n − 1 — нет (или n = min).
 *
 * Верхняя граница не выше защитного предела `SIM_LIMITS.maxRobots`: за ним прогон не
 * выполняется (NOT_SUPPORTED), и это сломало бы монотонность поиска.
 *
 * Число зарядных станций не меняется: парк меньше расчётного обслуживается теми же станциями.
 */
export function minStableFleet(
  input: SimInput,
  range: { min: number; max: number },
  opts: MinStableFleetOptions = {},
): number | null {
  const lo = Math.max(1, Math.ceil(range.min));
  const hi = Math.min(SIM_LIMITS.maxRobots, Math.floor(range.max));
  const budgetMs = opts.budgetMs ?? 60_000;
  const t0 = opts.now ? opts.now() : 0;
  return firstTrue(lo, hi, (n) => {
    if (opts.signal?.aborted) throw abortError();
    if (opts.now && opts.now() - t0 > budgetMs) throw budgetError(budgetMs);
    return runSimSync(withFleet(input, n)).verdict === "CONFIRMED";
  });
}

/** Разброс результата по зёрнам: диапазон достигнутого потока и ожидания, число подтверждений. */
export type SeedRange = {
  seeds: number[];
  achievedPerH: { min: number; max: number };
  waitP95Min: { min: number; max: number };
  /** Сколько прогонов из `seeds.length` подтвердили расчёт. */
  confirmed: number;
  summaries: SimRunSummary[];
};

/**
 * Прогоны одного входа с разными зёрнами — устойчивость вывода к случайности потока
 * («131–135 пал./ч», «подтверждён в 5 из 5 прогонов»). Пустой список зёрен — нули.
 */
export function seedRange(input: SimInput, seeds: readonly number[]): SeedRange {
  const summaries = seeds.map((seed) => runSimSync({ ...input, seed }));
  let aMin = Infinity;
  let aMax = -Infinity;
  let wMin = Infinity;
  let wMax = -Infinity;
  let confirmed = 0;
  for (const s of summaries) {
    if (s.achievedPerH < aMin) aMin = s.achievedPerH;
    if (s.achievedPerH > aMax) aMax = s.achievedPerH;
    if (s.waitP95Min < wMin) wMin = s.waitP95Min;
    if (s.waitP95Min > wMax) wMax = s.waitP95Min;
    if (s.verdict === "CONFIRMED") confirmed++;
  }
  const empty = summaries.length === 0;
  return {
    seeds: [...seeds],
    achievedPerH: { min: empty ? 0 : aMin, max: empty ? 0 : aMax },
    waitP95Min: { min: empty ? 0 : wMin, max: empty ? 0 : wMax },
    confirmed,
    summaries,
  };
}
