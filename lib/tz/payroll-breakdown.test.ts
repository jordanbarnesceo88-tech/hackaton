import { describe, expect, it } from "vitest";
import { roleCost } from "./econ/labour";
import { computeScenariosCore } from "./econ/core";
import { fixtureContext, fixtureSpecs, WAREHOUSE_BASE_PARAMS } from "./econ/fixtures";
import { paramSpecsFor } from "../data/organizer/params";
import { hasErrors, validateParamValues } from "./params/validate";
import { DEFAULT_PAYROLL_DRAFT, calculatePayroll, parsePayrollDraft, payrollApplication, type PayrollDraft } from "./payroll-breakdown";

function calculated(patch: Partial<PayrollDraft> = {}) {
  const result = parsePayrollDraft({ ...DEFAULT_PAYROLL_DRAFT, ...patch });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result;
}

describe("open-book payroll worksheet", () => {
  it("reproduces the team's net-to-gross and all-in breakdown without intermediate rounding", () => {
    const { breakdown: b } = calculated();
    expect(b.netMonthRub).toBe(117_000);
    expect(b.grossSalaryRubMonth).toBeCloseTo(134_482.75862068964, 8);
    expect(b.employerCostRubMonth).toBeCloseTo(175_500, 8);
    expect(b.withOverheadRubMonth).toBeCloseTo(193_050, 8);
    expect(b.allInRubMonth).toBeCloseTo(212_355, 8);
    expect(b.payrollMultiplier).toBeCloseTo(1.57905, 10);
  });

  it("applies real gross and replaces the common multiplier so the unchanged engine charges costs once", () => {
    const result = calculated();
    const application = payrollApplication("forkliftSalaryRubMonth", result);
    expect(application.salaryKey).toBe("forkliftSalaryRubMonth");
    expect(application.grossSalaryRubMonth).toBe(result.breakdown.grossSalaryRubMonth);
    expect(application.grossSalaryRubMonth).not.toBe(result.breakdown.allInRubMonth);
    expect(roleCost(application.grossSalaryRubMonth, application.payrollMultiplier)).toBeCloseTo(2_548_260, 6);
    expect(roleCost(application.grossSalaryRubMonth, application.payrollMultiplier)).not.toBeCloseTo(2_548_260 * 1.302, 2);
    expect(application.reason).toContain("net 4");
    expect(application.reason).toContain("удержания 13%");
    expect(application.reason).toContain("начисления 30,5%");
    expect(application.reason).toContain("накладные 10%");
    expect(application.reason).toContain("наценка 10%");
    expect(application.reason).toContain("для всех зарплат объекта");
    expect(application.reason).toContain("Оценка команды");
    expect(application.reason.length).toBeLessThanOrEqual(500);
  });

  it("removes only the contractor markup when disabled, including irrelevant invalid markup draft", () => {
    const without = calculated({ contractor: false, contractorMarkupPct: "not used" });
    expect(without.breakdown.allInRubMonth).toBeCloseTo(193_050, 8);
    expect(without.breakdown.payrollMultiplier).toBeCloseTo(1.4355, 10);
    expect(roleCost(without.breakdown.grossSalaryRubMonth, without.breakdown.payrollMultiplier)).toBeCloseTo(2_316_600, 6);
    expect(payrollApplication("cleanerSalaryRubMonth", without).reason).toContain("наценка не включена");
    expect(calculated().breakdown.grossSalaryRubMonth).toBe(without.breakdown.grossSalaryRubMonth);
  });

  it("accepts Russian numbers and explicit zero cost rates without changing paid shifts into headcount or hours", () => {
    const result = calculated({ netShiftRub: "4 500,50", paidShiftsMonth: "25,5", incomeTaxPct: "0", employerContributionsPct: "0", overheadPct: "0", contractorMarkupPct: "0" });
    expect(result.breakdown.netMonthRub).toBe(4500.5 * 25.5);
    expect(result.breakdown.grossSalaryRubMonth).toBe(result.breakdown.netMonthRub);
    expect(result.breakdown.payrollMultiplier).toBe(1);
    expect(result.breakdown.allInRubMonth).toBe(result.breakdown.netMonthRub);
    expect(payrollApplication("orderlySalaryRubMonth", result)).not.toHaveProperty("annualHoursPerFte");
    expect(calculated({ netShiftRub: "0" }).breakdown.allInRubMonth).toBe(0);
  });

  it.each([
    ["netShiftRub", ""], ["netShiftRub", "-1"], ["netShiftRub", "Infinity"],
    ["paidShiftsMonth", "0"], ["paidShiftsMonth", "-26"],
    ["incomeTaxPct", "100"], ["incomeTaxPct", "101"], ["incomeTaxPct", "-1"],
    ["employerContributionsPct", "-1"], ["overheadPct", "NaN"], ["contractorMarkupPct", "-1"],
    ["basis", " "], ["basis", "x".repeat(101)],
  ] as const)("rejects invalid %s=%s instead of silently using the prior value", (key, value) => {
    const result = parsePayrollDraft({ ...DEFAULT_PAYROLL_DRAFT, [key]: value });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[key]).toBeTruthy();
  });

  it("bounds arithmetic overflow and excessive cost before producing an application", () => {
    const valid = calculated().assumptions;
    for (const patch of [{ netShiftRub: 1e308 }, { netShiftRub: 1e12 }, { employerContributionsPct: 1e9 }, { incomeTaxPct: Number.NaN }]) {
      expect(calculatePayroll({ ...valid, ...patch }).ok).toBe(false);
    }
    expect(() => payrollApplication("payrollTaxMultiplier", calculated())).toThrow(/зарплатный/);
    expect(() => payrollApplication("__proto__", calculated())).toThrow(/зарплатный/);
  });

  it("keeps engine annual cost equal to the complete monthly price across mixed editable assumptions", () => {
    for (const tax of [0, 13, 22]) for (const contributions of [0, 30.5, 50]) for (const contractor of [false, true]) {
      const { assumptions, breakdown } = calculated({ incomeTaxPct: String(tax), employerContributionsPct: String(contributions), overheadPct: "7,25", contractorMarkupPct: "12,5", contractor });
      expect(breakdown.grossSalaryRubMonth * (1 - assumptions.incomeTaxPct / 100)).toBeCloseTo(breakdown.netMonthRub, 7);
      expect(roleCost(breakdown.grossSalaryRubMonth, breakdown.payrollMultiplier) / 12).toBeCloseTo(breakdown.allInRubMonth, 7);
    }
  });

  it("passes the actual object validator and engine without changing headcount or counting the prior multiplier again", () => {
    const application = payrollApplication("forkliftSalaryRubMonth", calculated());
    const raw = { ...WAREHOUSE_BASE_PARAMS, [application.salaryKey]: application.grossSalaryRubMonth, payrollTaxMultiplier: application.payrollMultiplier };
    const validated = validateParamValues(paramSpecsFor("warehouse"), raw, { origin: "api" });
    expect(hasErrors(validated.issues)).toBe(false);
    expect(validated.values.payrollTaxMultiplier).toBe(application.payrollMultiplier);
    expect(validated.values.forkliftSalaryRubMonth).toBe(application.grossSalaryRubMonth);
    expect(validated.issues.some(issue => issue.key === "payrollTaxMultiplier" && issue.code === "locked_changed")).toBe(true);
    const results = computeScenariosCore(fixtureContext(20, { params: validated.values }), fixtureSpecs());
    const result = results.find(row => row.key === "p1");
    expect(result?.status).toBe("ok");
    if (!result || result.status !== "ok") throw new Error("Expected valid economic calculation");
    expect(result.items[0]!.roleCostRubYear).toBeCloseTo(2_548_260, 6);
    expect(result.items[0]!.baselineLabourRub).toBeCloseTo(25 * 2_548_260, 6);
    expect(validated.values.forkliftOperatorsCount).toBe(25);
    expect(validated.values.shiftsPerDay).toBe(2);
    expect(validated.values.workDaysPerYear).toBe(365);
  });
});
