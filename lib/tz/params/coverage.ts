import { PROCESS_DEFS, type ProcessDef } from "../processes";
import type { ParamSpec } from "../types";

/**
 * Сверка процессов с параметрами: экономика и подбор берут имена параметров из `ProcessDef`
 * (спрос, пик, персонал, зарплата, ограничения), поэтому каждый такой ключ обязан быть среди
 * описаний параметров объекта — иначе расчёт молча получит undefined. Используется тестом
 * данных организатора и проверкой после правок администратора.
 */

/** Все ключи параметров, на которые ссылается процесс. */
export function paramKeysOfProcess(p: ProcessDef): string[] {
  const keys: string[] = [];
  if (p.demand) {
    keys.push(...p.demand.sumParams);
    if (p.demand.shareParam) keys.push(p.demand.shareParam);
    if (p.demand.excludeShareParam) keys.push(p.demand.excludeShareParam);
    if (p.demand.multiplierParams) keys.push(...p.demand.multiplierParams);
  }
  if (p.peakFactorParam) keys.push(p.peakFactorParam);
  if (p.headcountParam) keys.push(p.headcountParam);
  if (p.salaryParam) keys.push(p.salaryParam);
  for (const k of Object.values(p.constraints)) if (typeof k === "string") keys.push(k);
  return [...new Set(keys)];
}

/** Ключи параметров, на которые ссылаются процессы типа объекта, без повторов и по алфавиту. */
export function processParamKeys(facility: string): string[] {
  const keys = new Set<string>();
  for (const p of PROCESS_DEFS) {
    if (!p.facilityTypes.includes(facility)) continue;
    for (const k of paramKeysOfProcess(p)) keys.add(k);
  }
  return [...keys].sort();
}

/**
 * Ключи, на которые ссылаются процессы типа объекта, но которых нет среди описаний `defs`
 * этого типа. Пустой список — процессы полностью обеспечены параметрами.
 */
export function missingProcessParamKeys(defs: readonly ParamSpec[], facility: string): string[] {
  const have = new Set(defs.filter((d) => d.facility === facility).map((d) => d.key));
  return processParamKeys(facility).filter((k) => !have.has(k));
}
