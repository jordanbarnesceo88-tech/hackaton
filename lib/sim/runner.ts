import { createSim, isDone, stepSim } from "./engine";
import { summarize, type SimRunSummary, type SimSummaryMeta } from "./metrics";
import type { SimInput } from "./types";

/**
 * Запуск прогона до конца: синхронно (сервер при сохранении проекта) или по частям с
 * прогрессом, отменой и бюджетом времени (браузер, ТЗ §4.3.3 — запуск модели не дольше 60 с с
 * видимым статусом). Часы в имитации запрещены, поэтому время измеряет функция `now`, которую
 * передаёт вызывающий код (в браузере — `performance.now`).
 */

/** Параметры синхронного прогона. */
export type RunSyncOptions = Omit<SimSummaryMeta, "durationMs"> & {
  /** Часы для измерения `durationMs`; без них длительность 0. */
  now?: () => number;
};

/** Прогон до конца за один вызов. Детерминирован: одинаковый вход — одинаковая сводка. */
export function runSimSync(input: SimInput, opts: RunSyncOptions = {}): SimRunSummary {
  const t0 = opts.now ? opts.now() : 0;
  const state = createSim(input);
  while (!isDone(state)) stepSim(state);
  const durationMs = opts.now ? opts.now() - t0 : 0;
  return summarize(state, { scenarioKey: opts.scenarioKey, assumedUtilPct: opts.assumedUtilPct, durationMs });
}

/** Параметры прогона по частям. */
export type RunOptions = Omit<SimSummaryMeta, "durationMs"> & {
  /** Прогресс, % модельного времени (0–100); вызывается после каждой части. */
  onProgress?: (pct: number) => void;
  /** Отмена: прогон завершается ошибкой с name = 'AbortError'. */
  signal?: AbortSignal;
  /** Бюджет, мс; при превышении — ошибка с name = 'SimBudgetExceeded'. По умолчанию 60 000. */
  budgetMs?: number;
  /** Длительность одной части, мс, после которой управление отдаётся странице. По умолчанию 10. */
  sliceMs?: number;
  /** Часы, мс (в браузере — `performance.now`). */
  now: () => number;
  /**
   * Уступить управление между частями. В браузере — `() => new Promise(r => setTimeout(r, 0))`,
   * чтобы страница перерисовалась; по умолчанию — немедленно разрешённый промис (тесты).
   */
  yieldFn?: () => Promise<void>;
};

/** Сколько шагов модели выполнять между опросами часов. */
const STEPS_PER_CLOCK_CHECK = 64;

function abortError(): Error {
  const err = new Error("Имитация отменена");
  err.name = "AbortError";
  return err;
}

function budgetError(budgetMs: number): Error {
  const err = new Error(
    `Имитация не уложилась в ${Math.round(budgetMs / 1000)} с. Уменьшите длительность пикового окна или число роботов.`,
  );
  err.name = "SimBudgetExceeded";
  return err;
}

/**
 * Прогон по частям: каждая часть занимает не больше `sliceMs` мс, между частями вызывается
 * `onProgress` и управление уступается странице. Результат совпадает с `runSimSync` бит-в-бит
 * (кроме `durationMs`): нарезка на части не меняет последовательность шагов.
 */
export async function runSim(input: SimInput, opts: RunOptions): Promise<SimRunSummary> {
  const budgetMs = opts.budgetMs ?? 60_000;
  const sliceMs = opts.sliceMs ?? 10;
  const yieldFn = opts.yieldFn ?? (() => Promise.resolve());
  const now = opts.now;

  const t0 = now();
  const state = createSim(input);
  const span = state.endS > 0 ? state.endS : 1;
  // Прогон, отклонённый предварительной проверкой, завершён сразу — прогресс всё равно 100 %.
  if (isDone(state)) opts.onProgress?.(100);

  while (!isDone(state)) {
    if (opts.signal?.aborted) throw abortError();
    const sliceStart = now();
    let steps = 0;
    while (!isDone(state)) {
      stepSim(state);
      steps++;
      if (steps % STEPS_PER_CLOCK_CHECK === 0 && now() - sliceStart >= sliceMs) break;
    }
    const elapsed = now() - t0;
    opts.onProgress?.(isDone(state) ? 100 : Math.min(100, (100 * state.tS) / span));
    if (!isDone(state) && elapsed > budgetMs) throw budgetError(budgetMs);
    if (!isDone(state)) await yieldFn();
  }
  if (opts.signal?.aborted) throw abortError();

  return summarize(state, {
    scenarioKey: opts.scenarioKey,
    assumedUtilPct: opts.assumedUtilPct,
    durationMs: now() - t0,
  });
}
