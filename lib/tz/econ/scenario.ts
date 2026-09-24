import type { ScenarioOk, ScenarioResult, ScenarioSpec } from "../types";
import { breakEvenSalary } from "./conclusion";
import type { ScenarioContext } from "./context";
import { computeScenariosCore } from "./core";
import { scenarioRisks } from "./risks";
import { scenarioSensitivity } from "./sensitivity";

/**
 * Полный расчёт сценариев проекта (ТЗ §3.5): «Как есть» и варианты роботизации (покупка,
 * услуга RaaS) с CAPEX и OPEX по статьям, эффектом, окупаемостью, ROI, NPV, TCO, анализом
 * чувствительности, рисками и пороговой зарплатой покупки.
 *
 * Охват сравнения — процессы, которые роботизирует хотя бы один сценарий; «Как есть» — ФОТ
 * персонала этих процессов; каждый сценарий роботизации добавляет базовый ФОТ процессов
 * охвата, которые он не роботизирует. Результаты возвращаются в порядке `specs`.
 */
export function computeScenarios(ctx: ScenarioContext, specs: readonly ScenarioSpec[]): ScenarioResult[] {
  const core = computeScenariosCore(ctx, specs);
  return core.map((r, i) => {
    const spec = specs[i];
    if (!spec) return r;
    if (r.status !== "ok") return { ...r, risks: scenarioRisks(ctx, r, [], spec) };
    const sensitivity = scenarioSensitivity(ctx, spec, specs, r);
    const withSens: ScenarioOk = {
      ...r,
      sensitivity,
      breakEvenSalaryRubMonth: breakEvenSalary(ctx, spec, specs),
    };
    return { ...withSens, risks: scenarioRisks(ctx, withSens, sensitivity, spec) };
  });
}
