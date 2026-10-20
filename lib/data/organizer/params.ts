import type { ParamSpec } from "../../tz/types";
import { PARAM_SPECS as GENERATED_PARAM_SPECS } from "./params.generated";

/**
 * Параметры объектов (ТЗ §3.2): строки датасета организатора с базовыми значениями, диапазонами
 * и примечаниями плюс дополнения, которых в датасете нет (PARAM_EXTRAS в decisions.ts). Засеваются
 * в администрируемую таблицу ParamDefinition (T2.1); в формах и при загрузке файла берутся из БД.
 */
const CLEANING_KEYS = ["cleaningAreaM2", "cleaningsPerDay", "cleanersCount", "cleanerSalaryRubMonth"];
export const CLEANING_PARAM_EXTRAS: ParamSpec[] = ["airport", "medical"].flatMap(facility => CLEANING_KEYS.map(key => {
  const template = GENERATED_PARAM_SPECS.find(def => def.facility === "warehouse" && def.key === key)!;
  const base = key === "cleaningAreaM2"
    ? facility === "airport" ? GENERATED_PARAM_SPECS.find(def => def.facility === facility && def.key === "robotCleanableAreaM2")?.base ?? null : null
    : key === "cleaningsPerDay" ? 1 : key === "cleanersCount" ? null : template.base;
  return { ...template, facility, key, section: "Условия уборки", label: template.label.replace(" склада", ""), base,
    required: false, locked: false, min: key === "cleanersCount" ? 0 : template.min, max: key === "cleaningAreaM2" ? 1_000_000 : key === "cleaningsPerDay" ? 24 : template.max,
    origin: "estimate" as const, sourceRef: "Рабочие параметры уборки; исходный образец — параметры склада", tzMinimum: null,
    basis: key === "cleanersCount" ? "Введите только персонал уборки: общая численность терминала или медучреждения не является штатом уборщиков."
      : key === "cleaningAreaM2" ? "Площадь, доступная для выбранного режима уборки; исключите закрытые помещения и зоны, где робот неприменим."
      : key === "cleaningsPerDay" ? "Рабочее допущение: одна полная уборка в сутки. Измените по регламенту объекта."
      : "Редактируемая зарплата уборщика до НДФЛ из исходного образца. Калькулятор ФОТ позволяет применить ставку за смену и условия команды.", order: GENERATED_PARAM_SPECS.filter(def => def.facility === facility).length + 1 + CLEANING_KEYS.indexOf(key) };
}));
export const PARAM_SPECS: readonly ParamSpec[] = [...GENERATED_PARAM_SPECS, ...CLEANING_PARAM_EXTRAS];

/**
 * Параметры одного типа объекта в порядке показа; для неизвестного типа — пустой список (строка
 * из URL или БД не должна ронять страницу).
 */
export function paramSpecsFor(facility: string): ParamSpec[] {
  return PARAM_SPECS.filter((s) => s.facility === facility)
    .slice()
    .sort((a, b) => a.order - b.order);
}

/** Базовые значения параметров объекта — демо-данные организатора (ключ → значение). */
export function baseValuesFor(facility: string): Record<string, number | string | null> {
  return Object.fromEntries(paramSpecsFor(facility).map((s) => [s.key, s.base]));
}
