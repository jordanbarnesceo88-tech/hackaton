/** The mechanical timer allocates one third of unloading to a two-metre reverse exit. */
export function underliftHandlingBudgetS(handlingSec: number): number {
  return Math.max(6, handlingSec);
}

/** Nominal operation time without traffic stops; an exit slower than its timer must finish physically. */
export function underliftCycleHandlingS(
  handlingSec: number,
  speedMps: number,
): number {
  const h = underliftHandlingBudgetS(handlingSec);
  return 2 * h + 2 * ((2 * h) / 3 + Math.max(h / 3, 2 / speedMps));
}
