import { parseRuNumber } from "../files/csv";
import { formatNumberRu } from "./params/messages";

export const PAYROLL_FIELDS = {
  netShiftRub: "На руки за смену, ₽",
  paidShiftsMonth: "Оплачиваемых смен в месяц",
  incomeTaxPct: "Удержания из gross, %",
  employerContributionsPct: "Начисления работодателя, %",
  overheadPct: "Накладные расходы, %",
  contractorMarkupPct: "Наценка подрядчика, %",
} as const;
export type PayrollNumberKey = keyof typeof PAYROLL_FIELDS;
export type PayrollAssumptions = Record<PayrollNumberKey, number> & { contractor: boolean; basis: string };
export type PayrollDraft = Record<PayrollNumberKey, string> & Pick<PayrollAssumptions, "contractor" | "basis">;
export const DEFAULT_PAYROLL_DRAFT: Readonly<PayrollDraft> = Object.freeze({
  netShiftRub: "4500", paidShiftsMonth: "26", incomeTaxPct: "13", employerContributionsPct: "30,5",
  overheadPct: "10", contractorMarkupPct: "10", contractor: true, basis: "Оценка команды",
});
export type PayrollBreakdown = {
  netMonthRub: number;
  grossSalaryRubMonth: number;
  employerCostRubMonth: number;
  withOverheadRubMonth: number;
  allInRubMonth: number;
  payrollMultiplier: number;
};
export type PayrollApplication = { salaryKey: string; grossSalaryRubMonth: number; payrollMultiplier: number; reason: string };
type IssueKey = PayrollNumberKey | "basis" | "total";
type PayrollCalculation = { ok: true; assumptions: PayrollAssumptions; breakdown: PayrollBreakdown } | { ok: false; issues: Partial<Record<IssueKey, string>> };

/** All rates are editable cost assumptions, not a statement about taxes or work schedules. */
export function calculatePayroll(assumptions: PayrollAssumptions): PayrollCalculation {
  const issues: Partial<Record<IssueKey, string>> = {};
  for (const key of Object.keys(PAYROLL_FIELDS) as PayrollNumberKey[]) {
    if (key === "contractorMarkupPct" && !assumptions.contractor) continue;
    const value = assumptions[key];
    if (!Number.isFinite(value) || value < 0) issues[key] = "Укажите неотрицательное конечное число.";
  }
  if (Number.isFinite(assumptions.incomeTaxPct) && assumptions.incomeTaxPct >= 100) issues.incomeTaxPct = "Удержания должны быть меньше 100%.";
  if (Number.isFinite(assumptions.paidShiftsMonth) && assumptions.paidShiftsMonth <= 0) issues.paidShiftsMonth = "Укажите количество оплачиваемых смен больше нуля.";
  const basis = assumptions.basis.trim();
  if (!basis || basis.length > 100) issues.basis = "Укажите источник или основание, до 100 символов.";
  if (Object.keys(issues).length) return { ok: false, issues };
  const netMonthRub = assumptions.netShiftRub * assumptions.paidShiftsMonth;
  const grossSalaryRubMonth = netMonthRub / (1 - assumptions.incomeTaxPct / 100);
  const employerFactor = 1 + assumptions.employerContributionsPct / 100;
  const overheadFactor = 1 + assumptions.overheadPct / 100;
  const contractorFactor = assumptions.contractor ? 1 + assumptions.contractorMarkupPct / 100 : 1;
  const employerCostRubMonth = grossSalaryRubMonth * employerFactor;
  const withOverheadRubMonth = employerCostRubMonth * overheadFactor;
  const payrollMultiplier = employerFactor * overheadFactor * contractorFactor;
  const allInRubMonth = grossSalaryRubMonth * payrollMultiplier;
  const breakdown = { netMonthRub, grossSalaryRubMonth, employerCostRubMonth, withOverheadRubMonth, allInRubMonth, payrollMultiplier };
  if (Object.values(breakdown).some(value => !Number.isFinite(value)) || allInRubMonth > 1e12 || payrollMultiplier > 1e6) {
    return { ok: false, issues: { total: "Суммы или коэффициент слишком велики для расчёта. Проверьте оплату, количество смен и проценты." } };
  }
  return { ok: true, assumptions: { ...assumptions, basis, contractorMarkupPct: assumptions.contractor ? assumptions.contractorMarkupPct : 0 }, breakdown };
}

/** Match the existing Russian numeric input behavior; blanks never silently become zero. */
export function parsePayrollDraft(draft: PayrollDraft): PayrollCalculation {
  const numbers = Object.fromEntries((Object.keys(PAYROLL_FIELDS) as PayrollNumberKey[]).map(key => [key,
    key === "contractorMarkupPct" && !draft.contractor ? 0 : parseRuNumber(draft[key]) ?? Number.NaN,
  ])) as Record<PayrollNumberKey, number>;
  return calculatePayroll({ ...numbers, contractor: draft.contractor, basis: draft.basis });
}

/** The salary remains real gross; the common multiplier carries all employer-side costs once. */
export function payrollApplication(salaryKey: string, calculation: Extract<PayrollCalculation, { ok: true }>): PayrollApplication {
  if (!/^[a-z][A-Za-z0-9]*SalaryRubMonth$/.test(salaryKey)) throw new Error("Выберите зарплатный параметр объекта");
  const a = calculation.assumptions, b = calculation.breakdown, n = formatNumberRu;
  const reason = `ФОТ: net ${n(a.netShiftRub)} ₽/смену × ${n(a.paidShiftsMonth)}; удержания ${n(a.incomeTaxPct)}%; начисления ${n(a.employerContributionsPct)}%; накладные ${n(a.overheadPct)}%; наценка ${a.contractor ? `${n(a.contractorMarkupPct)}%` : "не включена"}. Gross ${n(b.grossSalaryRubMonth)} ₽/мес; коэффициент ${n(b.payrollMultiplier)} для всех зарплат объекта. Основание: ${a.basis}`;
  if (reason.length > 500) throw new Error("Сократите основание или точность введённых значений: запись расчёта должна помещаться в 500 символов");
  return { salaryKey, grossSalaryRubMonth: b.grossSalaryRubMonth, payrollMultiplier: b.payrollMultiplier, reason };
}
