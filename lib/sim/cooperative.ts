/** Scheduling changes wall time only; model steps and RNG order are unchanged. */
export type CooperativeOptions = {
  now?: () => number;
  deadline?: number;
  signal?: AbortSignal;
  sliceMs?: number;
  yieldFn?: () => Promise<void>;
};

export function checkExecution(options: CooperativeOptions): void {
  if (options.signal?.aborted) {
    const error = new Error("Расчёт отменён; изменения не записаны");
    error.name = "AbortError";
    throw error;
  }
  if (options.deadline !== undefined && !options.now) throw new Error("Для бюджета расчёта требуются внешние монотонные часы");
  if (options.deadline !== undefined && options.now!() >= options.deadline) {
    const error = new Error("Исчерпан бюджет расчёта; уменьшите парк или длительность проверки и повторите");
    error.name = "SimBudgetExceeded";
    throw error;
  }
}
