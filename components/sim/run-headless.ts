import { runSimState, type RunOptions } from "@/lib/sim/runner";
import type { SimInput } from "@/lib/sim/types";

export type HeadlessResult = Awaited<ReturnType<typeof runSimState>>;
export type HeadlessOptions = RunOptions;

/** Отдать управление React перед запуском и между частями прогона. */
export function yieldToPage(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export function isAbortError(e: unknown): boolean {
  return e instanceof Error && e.name === "AbortError";
}

/** Тот же runner и бюджет, что у расчёта, с конечным состоянием для схемы. */
export async function runHeadless(input: SimInput, opts: HeadlessOptions): Promise<HeadlessResult> {
  const yieldFn = opts.yieldFn ?? yieldToPage;
  await yieldFn();
  return runSimState(input, { ...opts, yieldFn });
}
