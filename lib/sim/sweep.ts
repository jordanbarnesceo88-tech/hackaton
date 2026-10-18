import { SIM_LIMITS } from "./engine";
import { assertAnalyticalWorkflow, runSim, runSimSync } from "./runner";
import type { RunOptions } from "./runner";
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
 * Первое подтверждённое целое n. Проверяем все меньшие: при фиксированных зарядках
 * добавление роботов может ухудшить результат, поэтому двоичный поиск здесь некорректен.
 */
export function firstTrue(lo: number, hi: number, pred: (n: number) => boolean): number | null {
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo > hi) return null;
  for (let n = Math.ceil(lo); n <= Math.floor(hi); n++) if (pred(n)) return n;
  return null;
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
 * Последовательный перебор ограничен диапазоном, бюджетом и SIM_LIMITS.maxRobots.
 * Timeout бросает SimBudgetExceeded, а не возвращает «решения нет». Найденный минимум
 * относится только к этому seed, окну и фиксированной инфраструктуре.
 *
 * Число зарядных станций не меняется: парк меньше расчётного обслуживается теми же станциями.
 */
export function minStableFleet(
  input: SimInput,
  range: { min: number; max: number },
  opts: MinStableFleetOptions = {},
): number | null {
  assertAnalyticalWorkflow(input);
  const lo = Math.max(1, Math.ceil(range.min));
  const hi = Math.min(SIM_LIMITS.maxRobots, Math.floor(range.max));
  const budgetMs = opts.budgetMs ?? 60_000;
  const t0 = opts.now ? opts.now() : 0;
  for (let n = lo; n <= hi; n++) {
    if (opts.signal?.aborted) throw abortError();
    const left = opts.now ? budgetMs - (opts.now() - t0) : budgetMs;
    if (!(left > 0)) throw budgetError(budgetMs);
    const summary = runSimSync(withFleet(input, n), { now: opts.now, budgetMs: left, signal: opts.signal });
    if (summary.verdict === "NOT_EVALUATED") return null;
    if (summary.verdict === "CONFIRMED") return n;
  }
  return null;
}

/** Async server equivalent: same ascending prefix, yielding within every candidate run. */
export async function minStableFleetAsync(input: SimInput, range: { min: number; max: number }, opts: RunOptions): Promise<number | null> {
  assertAnalyticalWorkflow(input);
  const deadline = opts.now() + (opts.budgetMs ?? 60_000);
  for (let n = Math.max(1, Math.ceil(range.min)); n <= Math.min(SIM_LIMITS.maxRobots, Math.floor(range.max)); n++) {
    // Even short candidate runs must not form an uninterrupted chain of resolved microtasks.
    await opts.yieldFn?.();
    const summary = await runSim(withFleet(input, n), { ...opts, budgetMs: Math.max(0, deadline - opts.now()) });
    if (summary.verdict === "NOT_EVALUATED") return null;
    if (summary.verdict === "CONFIRMED") return n;
  }
  return null;
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
  assertAnalyticalWorkflow(input);
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
