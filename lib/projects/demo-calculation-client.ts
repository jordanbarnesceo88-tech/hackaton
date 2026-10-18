import type { ParamValues, ProjectResults, ScenarioSpec } from "../tz/types";

export type DemoCalculationInput = { facility: string; params: ParamValues; scenarios: readonly ScenarioSpec[] };

/** Public, unsaved calculation. The server owns catalogue values and every simulation result. */
export async function calculateDemo(input: DemoCalculationInput, signal: AbortSignal): Promise<{ results: ProjectResults; ms: number }> {
  const response = await fetch("/api/v1/demo-calculation", {
    method: "POST", credentials: "same-origin", cache: "no-store",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
    signal: AbortSignal.any([signal, AbortSignal.timeout(75_000)]),
  }).catch((error: unknown) => {
    if (signal.aborted) throw error;
    if (error instanceof Error && error.name === "TimeoutError") throw new Error("Сервер не завершил расчёт за отведённое время. Повторите попытку.");
    throw new Error("Нет связи с сервером. Проверьте подключение и повторите расчёт.");
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "Сервер не завершил расчёт. Повторите попытку.");
  const result = body?.results;
  if (!result || result.facility !== input.facility || typeof result.modelVersion !== "string" ||
      typeof result.dataVersion !== "string" || !Array.isArray(result.results) || !Array.isArray(result.scenarios) ||
      !result.paramsUsed || !result.normsUsed || !result.conclusion || !Number.isFinite(body.ms) || body.ms < 0) {
    throw new Error("Сервер вернул неполный результат. Повторите расчёт.");
  }
  return { results: result, ms: body.ms };
}
