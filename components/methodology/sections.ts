import { CAPEX_LINE_KEYS, OPEX_LINE_KEYS, capexFormulaKey, opexFormulaKey, type FormulaKey } from "@/lib/tz/econ/formulas";

/** Разделы страницы /methodology/tz: якорь и заголовок. На якоря ссылаются оглавление и карта расчёта. */
export const METHODOLOGY_SECTIONS = [
  { id: "formulas", title: "Формулы" },
  { id: "norms", title: "Нормативы и допущения" },
  { id: "processes", title: "Процессы и спрос" },
  { id: "simulation", title: "Имитация" },
  { id: "versions", title: "Версии" },
  { id: "limitations", title: "Ограничения" },
] as const;

/**
 * Группы формул в порядке расчёта: спрос → парк → труд → CAPEX → OPEX → финансы. У каждой — свой
 * якорь: на него ведёт станция карты расчёта (components/methodology/calc-map.tsx).
 */
export const FORMULA_GROUPS: readonly { id: string; title: string; keys: readonly FormulaKey[] }[] = [
  { id: "f-demand", title: "Режим работы и спрос", keys: ["workHours", "demandDay", "peakPerHour"] },
  { id: "f-fleet", title: "Производительность и парк", keys: ["thrNorm", "thrCycle", "thrEff", "fleet", "coverage", "chargers"] },
  { id: "f-labour", title: "Труд", keys: ["roleCost", "baselineLabour", "releasedFte", "remainingLabour", "operatingStaff"] },
  { id: "f-capex", title: "CAPEX", keys: [...CAPEX_LINE_KEYS.map(capexFormulaKey), "capexTotal"] },
  { id: "f-opex", title: "OPEX", keys: [...OPEX_LINE_KEYS.map(opexFormulaKey), "opexTotal"] },
  {
    id: "f-finance",
    title: "Эффект, окупаемость, ROI, NPV и TCO",
    keys: ["effect", "payback", "roiTz", "roiNet", "npv", "discountedPayback", "tco", "cashflow", "batteryYear", "reinvest", "breakEvenSalary"],
  },
];

/** Все якоря страницы, на которые можно сослаться. */
export function methodologyAnchors(): Set<string> {
  return new Set<string>([...METHODOLOGY_SECTIONS.map((s) => s.id), ...FORMULA_GROUPS.map((g) => g.id)]);
}
