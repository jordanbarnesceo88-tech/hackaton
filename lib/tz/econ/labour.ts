import type { NormValues } from "../norms";
import type { ProcessDef } from "../processes";
import type { ParamValues, TraceStep } from "../types";
import { FACILITY_PARAM_KEYS, num, optNum, paramLabel, refuse, type ScenarioContext } from "./context";
import { ceilSafe } from "./fleet";
import { FORMULAS } from "./formulas";
import { fx, rub } from "./text";

/**
 * Труд: стоимость ставки, ФОТ процесса «как есть», высвобождаемые ставки, оставшийся ФОТ и
 * персонал эксплуатации. Численность и зарплата — из параметров объекта по ProcessDef
 * (headcountParam, salaryParam); персонал эксплуатации считается физически (посты × часы
 * работы), а не процентом от экономии.
 */

/** Коэффициент начислений: из параметров объекта (организатор фиксирует 1,302), иначе норматив. */
export function payrollMultiplier(params: ParamValues, norms: NormValues): number {
  const m = optNum(params, FACILITY_PARAM_KEYS.payrollTaxMultiplier);
  return m !== null && m > 0 ? m : norms.payrollMultiplier;
}

/** Годовая стоимость ставки: c = зарплата × 12 × коэффициент начислений. */
export function roleCost(salaryRubMonth: number, multiplier: number): number {
  return salaryRubMonth * 12 * multiplier;
}

/** Численность и зарплата персонала процесса; нет параметра или значения — отказ staffing_required. */
export function staffingOf(
  ctx: Pick<ScenarioContext, "params" | "paramLabels">,
  process: ProcessDef,
): { headcount: number; salary: number } {
  const fields = [process.headcountParam, process.salaryParam]
    .filter((k): k is string => k !== null)
    .map((k) => `param:${k}`);
  const message = `Укажите численность и зарплату персонала процесса «${process.name}» в параметрах объекта`;
  if (!process.headcountParam || !process.salaryParam) refuse("staffing_required", message, fields);
  const headcount = optNum(ctx.params, process.headcountParam);
  const salary = optNum(ctx.params, process.salaryParam);
  if (headcount === null || salary === null) refuse("staffing_required", message, fields);
  // Отрицательные значения — не «нет данных», а ошибка ввода.
  num(ctx.params, process.headcountParam, { label: paramLabel(ctx, process.headcountParam) });
  num(ctx.params, process.salaryParam, { label: paramLabel(ctx, process.salaryParam) });
  return { headcount, salary };
}

/** Базовая линия процесса «как есть»: численность, зарплата, стоимость ставки и ФОТ. */
export type ProcessBaseline = {
  process: ProcessDef;
  headcount: number;
  salary: number;
  multiplier: number;
  roleCost: number;
  baselineRub: number;
  trace: TraceStep[];
};

export function processBaseline(
  ctx: Pick<ScenarioContext, "params" | "paramLabels">,
  process: ProcessDef,
  norms: NormValues,
): ProcessBaseline {
  const { headcount, salary } = staffingOf(ctx, process);
  const multiplier = payrollMultiplier(ctx.params, norms);
  const c = roleCost(salary, multiplier);
  const baselineRub = baseline(headcount, c);
  return {
    process,
    headcount,
    salary,
    multiplier,
    roleCost: c,
    baselineRub,
    trace: [
      {
        key: "roleCost",
        label: `${FORMULAS.roleCost.title} — ${process.name}`,
        formula: FORMULAS.roleCost.expression,
        substituted: `${rub(salary)} × 12 × ${fx(multiplier, 3)} = ${rub(c)}`,
        value: c,
        unit: "₽/год",
        origin: "derived",
      },
      {
        key: "baselineLabour",
        label: `${FORMULAS.baselineLabour.title} — ${process.name}`,
        formula: FORMULAS.baselineLabour.expression,
        substituted: `${fx(headcount)} × ${rub(c)} = ${rub(baselineRub)}`,
        value: baselineRub,
        unit: "₽/год",
        origin: "derived",
      },
    ],
  };
}

/** ФОТ процесса «как есть»: численность × c. */
export function baseline(headcount: number, c: number): number {
  return headcount * c;
}

/**
 * Высвобождаемые ставки: F = численность × доля автоматизируемого труда × (1 − ns/100) × κ.
 *
 * ns — доля негабарита: его перевозят только люди, поэтому он исключён и из спроса роботов,
 * и из высвобождаемого труда. Это не двойной учёт: в спросе ns уменьшает работу роботов, а
 * здесь — долю людей, которых эта работа заменяет.
 */
export function releasedFte(headcount: number, laborShare: number, nonStandardPct: number, kappa: number): number {
  return headcount * laborShare * (1 - nonStandardPct / 100) * kappa;
}

/** Оставшийся ФОТ процесса: (численность − F) × c. */
export function remaining(headcount: number, fte: number, c: number): number {
  return (headcount - fte) * c;
}

/** Посты диспетчеров парка: ⌈N / роботов на пост⌉. */
export function operatorPosts(n: number, norms: NormValues): number {
  return ceilSafe(n / Math.max(1, norms.robotsPerOperatorPost));
}

/**
 * Персонал эксплуатации: посты × Hсут × дней в году / фонд ставки × c. Пост закрыт на всё
 * время работы объекта, поэтому один круглосуточный пост — это больше одной ставки.
 */
export function operatingStaff(posts: number, Hd: number, D: number, norms: NormValues, c: number): number {
  return ((posts * Hd * D) / Math.max(1, norms.annualHoursPerFte)) * c;
}
