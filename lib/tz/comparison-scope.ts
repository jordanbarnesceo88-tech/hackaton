import type { ComparisonRow, ScenarioSpec } from "./types";

/** Presentation scope only: preserve the frozen payload and every alternative in relevant processes. */
export function comparisonRowsForScenarios<T extends Pick<ComparisonRow, "process">>(
  rows: readonly T[], specs: readonly Pick<ScenarioSpec, "kind" | "items">[],
): readonly T[] {
  const processes = new Set(specs.filter(spec => spec.kind !== "asis").flatMap(spec => spec.items.map(item => item.process)));
  return processes.size ? rows.filter(row => processes.has(row.process)) : rows;
}
