import { createSim, isDone, stepSim } from "@/lib/sim/engine";
import { summarize, type SimRunSummary } from "@/lib/sim/metrics";
import type { SimEngineState } from "@/lib/sim/state";
import type { SimInput } from "@/lib/sim/types";

/**
 * Прогон имитации в браузере без анимации — до конца, по частям, с прогрессом, отменой и
 * бюджетом (ТЗ §4.3.3: запуск модели не дольше 60 с с видимым статусом).
 *
 * Нарезка и ошибки повторяют `runSim` из lib/sim/runner.ts, но функция возвращает ещё и конечное
 * состояние прогона: экран показывает последний кадр схемы, а `runSim` отдаёт только сводку и
 * потребовал бы второго прогона ради картинки. Сводку считает тот же `summarize` по тому же
 * состоянию, поэтому она совпадает с `runSimSync` на сервере бит-в-бит (кроме `durationMs`).
 */

/** Результат прогона: конечное состояние (для последнего кадра), сводка и длительность. */
export type HeadlessResult = { state: SimEngineState; summary: SimRunSummary; durationMs: number };

/** Параметры прогона. */
export type HeadlessOptions = {
  /** Часы, мс (в браузере — `performance.now`). */
  now: () => number;
  /** Отмена: ошибка с name = 'AbortError'. */
  signal?: AbortSignal;
  /** Прогресс, % модельного времени; вызывается только после первой уступки управления. */
  onProgress?: (pct: number) => void;
  /** Бюджет, мс; превышение — ошибка с name = 'SimBudgetExceeded'. По умолчанию 60 000. */
  budgetMs?: number;
  /** Длительность одной части, мс. По умолчанию 10. */
  sliceMs?: number;
  /** Уступить управление странице между частями. По умолчанию — `setTimeout(…, 0)`. */
  yieldFn?: () => Promise<void>;
  /** Ключ сценария для сводки. */
  scenarioKey?: string;
  /** Загрузка, заложенная в расчёт, % — для строки «в расчёте». */
  assumedUtilPct?: number;
};

/** Сколько шагов модели выполнять между опросами часов (как в lib/sim/runner.ts). */
const STEPS_PER_CLOCK_CHECK = 64;

/** Уступка управления странице: перерисовка и обработка событий между частями прогона. */
export function yieldToPage(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

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

/** Ошибка — отмена прогона (её не показывают пользователю как сбой). */
export function isAbortError(e: unknown): boolean {
  return e instanceof Error && e.name === "AbortError";
}

/**
 * Прогон до конца по частям. Первая часть начинается только после уступки управления: так
 * вызывающий эффект React не получает обновлений состояния синхронно, в своём теле.
 */
export async function runHeadless(input: SimInput, opts: HeadlessOptions): Promise<HeadlessResult> {
  const budgetMs = opts.budgetMs ?? 60_000;
  const sliceMs = opts.sliceMs ?? 10;
  const yieldFn = opts.yieldFn ?? yieldToPage;
  const now = opts.now;

  await yieldFn();
  if (opts.signal?.aborted) throw abortError();

  const t0 = now();
  const state = createSim(input);
  const span = state.endS > 0 ? state.endS : 1;

  while (!isDone(state)) {
    if (opts.signal?.aborted) throw abortError();
    const sliceStart = now();
    let steps = 0;
    while (!isDone(state)) {
      stepSim(state);
      steps++;
      if (steps % STEPS_PER_CLOCK_CHECK === 0 && now() - sliceStart >= sliceMs) break;
    }
    opts.onProgress?.(isDone(state) ? 100 : Math.min(100, (100 * state.tS) / span));
    if (!isDone(state)) {
      if (now() - t0 > budgetMs) throw budgetError(budgetMs);
      await yieldFn();
    }
  }
  if (opts.signal?.aborted) throw abortError();
  // Прогон, отклонённый предварительной проверкой, завершён сразу — прогресс всё равно 100 %.
  if (state.tS === 0) opts.onProgress?.(100);

  const durationMs = now() - t0;
  const summary = summarize(state, {
    scenarioKey: opts.scenarioKey,
    assumedUtilPct: opts.assumedUtilPct,
    durationMs,
  });
  return { state, summary, durationMs };
}
