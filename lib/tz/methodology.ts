import { FORMULAS, formulaSourceLabel, type FormulaKey } from "./econ/formulas";
import { MODEL_LIMITATIONS } from "./econ/limitations";
import type { MethodologySnapshot } from "./types";
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
  };
}
