import { TZ_MODEL_VERSION } from "../../tz/version";
import { evaluateCleaningPlan, isCleaningProcess } from "../../tz/cleaning-zones";
import { evaluatePilotAcceptance } from "../../tz/pilot-evaluation";
import { scenarioNorms, type ReportResults } from "./rows";
import { processDef } from "../../tz/processes";
import { toNumber, workHours } from "../../tz/econ/context";

export type OperatingPlanRow = { scenarioName: string; label: string; value: string | number; unit: string; source: string };

/** Only saved inputs are used; opening or exporting never reads live operating evidence. */
export function operatingPlanReportRows(results: ReportResults): OperatingPlanRow[] {
  const rows: OperatingPlanRow[] = [];
  for (const spec of results.scenarios) {
    const push = (label: string, value: string | number, unit = "", source = "Сохранённые данные проекта") => rows.push({ scenarioName: spec.name, label, value, unit, source });
    if (spec.terminalResidualRub && spec.terminalResidualSource) push("Основание остаточной стоимости", spec.terminalResidualRub, "₽", spec.terminalResidualSource);
    if (results.modelVersion !== TZ_MODEL_VERSION && (spec.cleaningPlan || spec.pilotPlan?.actualResult || spec.pilotPlan?.acceptanceThresholds)) {
      push("Архивный план работы", `Сохранена версия ${results.modelVersion}; проверка зон и приёмка не пересчитываются текущими правилами`);
      if (spec.cleaningPlan) {
        push("Основание плана зон", spec.cleaningPlan.source);
        for (const zone of spec.cleaningPlan.zones) push(`Зона ${zone.name}, этаж ${zone.floor}`, `${zone.areaM2} м²; ${zone.cleaningsPerDay} уборок/сут; окно ${zone.windowStartH} + ${zone.windowH} ч`, "", spec.cleaningPlan.disjointAreaReason);
      }
      continue;
    }
    if (spec.cleaningPlan) {
      try {
        const process = processDef(spec.items.find(item => isCleaningProcess(item.process))?.process ?? "");
        const baselineFte = process?.headcountParam ? toNumber(results.paramsUsed[process.headcountParam]) : null;
        const cleaningAreaM2 = process?.demand?.sumParams[0] ? toNumber(results.paramsUsed[process.demand.sumParams[0]]) : null;
        if (baselineFte === null || cleaningAreaM2 === null) throw new Error("Не сохранены штат уборки или площадь объекта");
        const plan = evaluateCleaningPlan(spec.cleaningPlan, {
          workDaysPerYear: workHours({ params: results.paramsUsed }).D,
          annualHoursPerFte: scenarioNorms(results, spec.key).annualHoursPerFte,
          baselineFte, cleaningAreaM2, items: spec.items,
        });
        push("План уборки по зонам", plan.status === "full" ? "Расчётная нагрузка покрыта" : "Есть непокрытая работа", "", spec.cleaningPlan.source);
        push("Непересекающиеся площади", spec.cleaningPlan.disjointAreaReason);
        for (const zone of plan.zones) {
          push(`Зона ${zone.name}, этаж ${zone.floor}`, `${zone.status}; принято роботами ${zone.robotAcceptedM2PerDay}; существующими машинами ${zone.machineCoveredM2PerDay}; вручную ${zone.manualCoveredM2PerDay}; не покрыто ${zone.uncoveredM2PerDay}`, "м²/сут", spec.cleaningPlan.source);
        }
        for (const machine of spec.cleaningPlan.existingMachines) push(`Существующая машина: ${machine.name}`, `исходные расходы ${machine.baselineAnnualCostRub}; сохраняемые ${machine.retainedAnnualCostRub}`, "₽/год", machine.source);
        push("Применимость результата", "Расчётное расписание; фактическая приёмка и совместное движение проверяются отдельно");
      } catch (error) { push("План зон не оценён", error instanceof Error ? error.message : "Неверный сохранённый план"); }
    }
    const pilot = spec.pilotPlan;
    if (pilot && (pilot.acceptanceThresholds || pilot.actualResult)) {
      const slug = pilot.productSlug ?? (spec.items.length === 1 ? spec.items[0]?.productSlug : undefined) ?? "";
      const selectedItems = spec.items.filter(item => item.productSlug === slug);
      if (!slug || selectedItems.length !== 1 || !results.productSnapshots[slug]) {
        push("Фактическая приёмка пилота", "INCOMPLETE", "", "Модель пилота должна однозначно принадлежать сохранённому сценарию");
        continue;
      }
      const selectedItem = selectedItems[0]!;
      const metric = selectedItem && ["cleaning", "terminal-cleaning", "hospital-cleaning"].includes(selectedItem.process) ? "accepted-area-m2-day" : "completed-operations-hour";
      const acceptance = evaluatePilotAcceptance(pilot, { metric, productSlug: slug });
      const source = [pilot.acceptanceThresholds?.source, pilot.acceptanceThresholds?.date, pilot.actualResult?.source, pilot.actualResult?.date].filter(Boolean).join("; ");
      push("Фактическая приёмка пилота", acceptance.status, "", source);
      for (const check of acceptance.checks) push(check.label, `${check.status}: ${check.reason}`, check.unit, source);
      for (const missing of acceptance.missing) push("Не хватает для приёмки", missing, "", source);
    }
  }
  return rows;
}
