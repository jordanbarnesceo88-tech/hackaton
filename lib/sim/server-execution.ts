import { setImmediate } from "node:timers/promises";
import { checkExecution, type CooperativeOptions } from "./cooperative";

const key = Symbol.for("alfa-robot.server-calculation-admission");
const registry = globalThis as typeof globalThis & { [key]?: { active: number } };
const state = registry[key] ??= { active: 0 };

export class CalculationBusy extends Error {
  constructor() { super("Сервер уже выполняет два расчёта. Подождите и повторите; ваши изменения не записаны"); this.name = "CalculationBusy"; }
}

/** One process-wide admission limit shared by API, server actions and server-rendered examples. */
export async function withServerCalculation<T>(run: () => Promise<T>, options: CooperativeOptions = {}): Promise<T> {
  checkExecution(options);
  if (state.active >= 2) throw new CalculationBusy();
  state.active++;
  try { return await run(); } finally { state.active--; }
}

export const yieldServer = (): Promise<void> => setImmediate();

export function calculationFailure(error: unknown): { status: number; message: string; retryAfterSec?: number } | null {
  if (!(error instanceof Error)) return null;
  if (error.name === "CalculationBusy") return { status: 503, message: error.message, retryAfterSec: 2 };
  if (error.name === "SimBudgetExceeded") return { status: 503, message: error.message, retryAfterSec: 2 };
  if (error.name === "AbortError") return { status: 499, message: error.message };
  return null;
}
