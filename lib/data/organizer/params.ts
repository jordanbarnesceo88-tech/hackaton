import type { ParamSpec } from "../../tz/types";
import { PARAM_SPECS } from "./params.generated";

/**
 * Параметры объектов (ТЗ §3.2): строки датасета организатора с базовыми значениями, диапазонами
 * и примечаниями плюс дополнения, которых в датасете нет (PARAM_EXTRAS в decisions.ts). Засеваются
 * в администрируемую таблицу ParamDefinition (T2.1); в формах и при загрузке файла берутся из БД.
 */
export { PARAM_SPECS };

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
