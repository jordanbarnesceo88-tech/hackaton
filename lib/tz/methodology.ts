import { FORMULAS, formulaSourceLabel, type FormulaKey } from "./econ/formulas";
import { MODEL_LIMITATIONS } from "./econ/limitations";
import { NORM_DEFS } from "./norms";
import type { MethodologySnapshot, ProjectResults } from "./types";
import { SIM_MODEL_VERSION, TZ_MODEL_VERSION } from "./version";

/** Store definitions as values, so a later source release cannot rewrite an archived appendix. */
export function captureMethodologySnapshot(): MethodologySnapshot {
  return {
    schemaVersion: "methodology-snapshot-1", modelVersion: TZ_MODEL_VERSION, simModelVersion: SIM_MODEL_VERSION,
    formulas: (Object.keys(FORMULAS) as FormulaKey[]).map(key => {
      const formula = FORMULAS[key];
      return { key, title: formula.title, expression: formula.expression, units: formula.units, source: formulaSourceLabel(formula.source) };
    }),
    limitations: [...MODEL_LIMITATIONS],
    normDefinitions: NORM_DEFS.map(def => ({ ...def })),
  };
}

export const MISSING_NORM_METADATA = "Метаданные норматива не сохранены в этом архиве. Показано только сохранённое значение; текущие подписи, источники, значения по умолчанию и границы не подставляются.";

export function normLabelsFromSnapshot(results: Pick<ProjectResults, "methodologySnapshot"> | null) {
  return Object.fromEntries(results?.methodologySnapshot?.normDefinitions?.map(def => [def.key, def.label]) ?? []);
}

/** Numeric values and definitions must both belong to the same saved calculation. */
export function normRowsFromSnapshot(results: Pick<ProjectResults, "normsUsed" | "methodologySnapshot">) {
  const definitions = new Map(results.methodologySnapshot?.normDefinitions?.map(def => [def.key, def]));
  return Object.entries(results.normsUsed).filter(([, value]) => typeof value === "number" && Number.isFinite(value)).map(([key, value]) => {
    const def = definitions.get(key);
    return {
      key, value, label: def?.label ?? key, group: def?.group ?? "Архив", unit: def?.unit ?? "",
      origin: def?.origin ?? null, basis: def?.basis ?? MISSING_NORM_METADATA,
      defaultValue: def?.value ?? null, min: def?.min ?? null, max: def?.max ?? null,
      sourceRef: def?.sourceRef, sourceUrl: def?.sourceUrl, formula: def?.formula,
    };
  });
}
