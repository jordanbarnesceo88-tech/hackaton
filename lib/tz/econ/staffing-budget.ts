/** Constant annual additional staffing expense at which NPV reaches zero, all other inputs fixed. */
export function staffingBreakEvenBudget(annualStaffRub: number, npvRub: number | null, years: number, discountRate: number): number | null {
  if (npvRub === null || ![annualStaffRub, npvRub, years, discountRate].every(Number.isFinite) || annualStaffRub < 0 || !Number.isInteger(years) || years < 1 || years > 100 || discountRate <= -1) return null;
  let factor = 0;
  for (let year = 1; year <= years; year++) factor += 1 / (1 + discountRate) ** year;
  return annualStaffRub + npvRub / factor;
}
