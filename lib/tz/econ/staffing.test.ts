import { describe, expect, it } from "vitest";
import { validateScenarioSpecs } from "../../projects/validate";
import type { OperationsStaffing, ScenarioOk, ScenarioResult, ScenarioSpec } from "../types";
import { computeScenariosCore } from "./core";
import { fixtureContext, fixtureSpecs, FIXTURE_H1500 } from "./fixtures";
import { parseOperationsStaffing } from "./labour";
import { computeScenarios } from "./scenario";

const dedicated: OperationsStaffing = { mode: "dedicated", grossSalaryRubMonth: 60_000, payrollMultiplier: 1.3, annualHoursPerFte: 2000, reason: "Оценка отдельного оператора, 60 тыс. ₽ до начислений" };
const shared: OperationsStaffing = { mode: "shared-existing", incrementalHoursYear: 100, grossHourlyRub: 500, payrollMultiplier: 1.3, reason: "100 дополнительных оплаченных часов существующего инженера" };
const included: OperationsStaffing = { mode: "integrator", billing: "included-in-service", reason: "Оценка состава сервиса, требует подтверждения поставщиком" };
function ok(rows: ScenarioResult[], key = "p1"): ScenarioOk {
  const row = rows.find(r => r.key === key);
  if (!row || row.status !== "ok") throw new Error(JSON.stringify(row));
  return row;
}
function specs(staffing?: OperationsStaffing): ScenarioSpec[] {
  return fixtureSpecs().map(s => s.kind === "asis" ? s : { ...s, ...(staffing ? { operationsStaffing: staffing } : {}) });
}

describe("additional site operations staffing", () => {
  it("absent settings preserve exact legacy results and never mutate input", () => {
    const input = specs(), before = structuredClone(input), ctx = fixtureContext();
    const legacy = computeScenariosCore(ctx, input);
    const explicitUndefined = computeScenariosCore(ctx, input.map(s => ({ ...s, operationsStaffing: undefined })));
    expect(explicitUndefined).toEqual(legacy);
    expect(input).toEqual(before);
    const p = ok(legacy);
    expect(p.operationsStaffing).toBeUndefined();
    expect(p.items[0]!.operatingStaffRub).toBeCloseTo(7_630_657.07, 1);
    expect(p.items[0]!.operatorPosts).toBe(1);
  });

  it("dedicated uses its own salary, payroll and annual fund on the common site schedule", () => {
    const ctx = fixtureContext(), p = ok(computeScenariosCore(ctx, specs(dedicated)));
    const posts = Math.ceil(p.items[0]!.n! / ctx.norms.robotsPerOperatorPost);
    const annual = posts * 22 * 365 / 2000 * 60_000 * 12 * 1.3;
    expect(p.operationsStaffing).toMatchObject({ mode: "dedicated", posts, fte: posts * 22 * 365 / 2000, annualCostRub: annual });
    expect(p.items[0]).toMatchObject({ operatorPosts: 0, operatingStaffScope: "site-allocation", operatingStaffRub: annual });
    const changedProcessSalary = ok(computeScenariosCore(fixtureContext(20, { params: { forkliftSalaryRubMonth: 170_000 } }), specs(dedicated)));
    expect(changedProcessSalary.operationsStaffing).toEqual(p.operationsStaffing);
    expect(p.trace.filter(t => t.key === "operatingStaff")).toHaveLength(1);
    expect(p.opexLines.find(l => l.key === "operatingStaff")).toMatchObject({ valueRub: annual, origin: "user", originNote: dedicated.reason });
  });

  it("shared staff adds only incremental paid hours; FTE, base payroll and coverage are unchanged", () => {
    const ctx = fixtureContext(), old = ok(computeScenariosCore(ctx, specs())), next = ok(computeScenariosCore(ctx, specs(shared)));
    const annual = 100 * 500 * 1.3, delta = annual - old.items[0]!.operatingStaffRub;
    expect(next.operationsStaffing!.annualCostRub).toBe(65_000);
    for (const key of ["releasedFte", "remainingLabourRub", "baselineLabourRub", "coverage", "roleCostRubYear", "n", "chargers"] as const) expect(next.items[0]![key]).toBe(old.items[0]![key]);
    expect(next.capexRub).toBe(old.capexRub);
    expect(next.opexYearRub - old.opexYearRub).toBeCloseTo(delta, 6);
    expect(next.effectYearRub - old.effectYearRub).toBeCloseTo(-delta, 6);
    expect(next.processLabourYearRub - old.processLabourYearRub).toBeCloseTo(delta, 6);
    expect(next.tcoRub - old.tcoRub).toBeCloseTo(delta * next.tcoYears, 5);
    const discountedDelta = next.cashflows.slice(1, 6).reduce((sum, row) => sum - delta / 1.12 ** row.year, 0);
    expect(next.npvRub! - old.npvRub!).toBeCloseTo(discountedDelta, 5);
    expect(next.opexLines.reduce((sum, l) => sum + l.valueRub, 0)).toBe(next.opexYearRub);
  });

  it("an explicit zero incremental cost needs a reason and never reduces existing payroll when cash share is zero", () => {
    const zero = { ...shared, incrementalHoursYear: 0, reason: "Без доплат в существующие оплачиваемые часы; согласованная оценка" };
    const input = specs(zero).map(s => ({ ...s, cashRealizationShare: 0 }));
    const p = ok(computeScenariosCore(fixtureContext(), input));
    expect(p.operationsStaffing!.annualCostRub).toBe(0);
    expect(p.items[0]!.remainingLabourRub).toBe(p.items[0]!.baselineLabourRub);
    expect(p.items[0]!.releasedFte).toBeGreaterThan(0);
    expect(() => parseOperationsStaffing({ ...zero, reason: " " })).toThrow();
  });

  it("charges one integrator fee for multiple items, and keeps exact allocated totals", () => {
    const ctx = fixtureContext(20, { params: { cleaningAreaM2: 10_000, cleaningsPerDay: 2, cleanersCount: 10, cleanerSalaryRubMonth: 65_000 } });
    ctx.processes = { ...ctx.processes, cleaning: { ...ctx.processes.cleaning!, calcSupported: true } };
    const multi = specs({ mode: "integrator", billing: "separate", annualFeeRub: 400_000, reason: "Годовая плата за всю площадку" });
    multi[1]!.items = [
      { process: "pallet-transport", productSlug: FIXTURE_H1500.slug, quantityOverride: 9 },
      { process: "cleaning", productSlug: FIXTURE_H1500.slug, quantityOverride: 9, throughputPerHOverride: 1000 },
    ];
    const result = ok(computeScenariosCore(ctx, multi));
    expect(result.items).toHaveLength(2);
    expect(result.operationsStaffing!.annualCostRub).toBe(400_000);
    expect(result.opexLines.filter(l => l.key === "operatingStaff")).toHaveLength(1);
    expect(result.items.reduce((sum, item) => sum + item.operatingStaffRub, 0)).toBe(400_000);
    multi[1]!.operationsStaffing = dedicated;
    const own = ok(computeScenariosCore(ctx, multi));
    expect(own.operationsStaffing!.posts).toBe(Math.ceil(18 / ctx.norms.robotsPerOperatorPost));
    expect(own.items.every(item => item.operatorPosts === 0)).toBe(true);
    expect(own.items.reduce((sum, item) => sum + item.operatingStaffRub, 0)).toBe(own.operationsStaffing!.annualCostRub);
  });

  it("included integrator staff requires a positive paid service/subscription and remains an unconfirmed assumption", () => {
    const rows = computeScenarios(fixtureContext(), specs(included));
    for (const key of ["p1", "r1"]) {
      const p = ok(rows, key);
      expect(p.operationsStaffing).toMatchObject({ annualCostRub: 0, includedInService: true });
      expect(p.opexLines.find(l => l.key === "operatingStaff")).toMatchObject({ valueRub: 0, includedInService: true, origin: "user" });
      expect(p.risks.find(r => r.code === "OPERATIONS_STAFFING_ASSUMPTION")?.text).toContain("не подтверждённое договором");
    }
    const noService = specs(included);
    noService[1]!.items[0]!.serviceRubYearOverride = 0;
    expect(computeScenariosCore(fixtureContext(), noService)[1]).toMatchObject({ status: "refused", refusal: { reason: "invalid_inputs" } });
  });

  it.each([
    null, {}, { mode: "free", reason: "нет" }, { ...shared, reason: "" }, { ...shared, incrementalHoursYear: -1 },
    { ...shared, incrementalHoursYear: Infinity }, { ...shared, grossHourlyRub: NaN }, { ...shared, payrollMultiplier: 0 },
    { ...dedicated, grossSalaryRubMonth: 0 }, { ...dedicated, annualHoursPerFte: 0 }, { ...dedicated, annualHoursPerFte: 8785 },
    { ...included, annualFeeRub: 0 }, { ...shared, hiddenSalary: 0 }, { ...shared, reason: "x".repeat(1001) },
  ])("refuses malformed explicit settings at the direct model boundary (%#)", value => {
    const input = specs();
    input[1]!.operationsStaffing = value as OperationsStaffing;
    expect(computeScenariosCore(fixtureContext(), input)[1]).toMatchObject({ status: "refused", refusal: { reason: "invalid_inputs", fields: ["scenario:operationsStaffing"] } });
  });

  it("strict project validation and JSON roundtrip retain explicit settings without defaulting unknown to free", () => {
    const ctx = fixtureContext(), input = specs({ ...shared, reason: `  ${shared.reason}  ` });
    const checked = validateScenarioSpecs(input, "warehouse", Object.keys(ctx.products), Object.keys(ctx.processes));
    expect(checked.ok).toBe(true);
    if (!checked.ok) throw new Error(checked.errors.join(";"));
    expect(checked.value[1]!.operationsStaffing).toEqual(shared);
    expect(computeScenariosCore(ctx, JSON.parse(JSON.stringify(checked.value)))).toEqual(computeScenariosCore(ctx, specs(shared)));
    expect(validateScenarioSpecs(input.map((s, i) => i === 0 ? { ...s, operationsStaffing: shared } : s), "warehouse", Object.keys(ctx.products), Object.keys(ctx.processes)).ok).toBe(false);
    expect(validateScenarioSpecs(input.map((s, i) => i === 1 ? { ...s, operationsStaffing: { ...shared, unknown: 1 } } : s), "warehouse", Object.keys(ctx.products), Object.keys(ctx.processes)).ok).toBe(false);
  });
});
