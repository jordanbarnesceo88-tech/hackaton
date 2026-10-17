import { discountedPaybackYears, npv } from "../../economics/finance";
import type { CashflowRow } from "../types";

/**
 * Денежные потоки и финансовые показатели сценария (ТЗ §3.5.2): простой срок окупаемости,
 * ROI по ТЗ, NPV, дисконтированный срок окупаемости и TCO. Функции `npv` и
 * `discountedPaybackYears` берутся из модели v1 без изменений (относительный импорт, чтобы
 * расчёт работал и в сиде через tsx).
 *
 * Потоки строятся на T = max(H, минимальный горизонт TCO) лет; NPV, ROI и дисконтированная
 * окупаемость используют первые H лет, TCO — все T.
 */

/** Затрата каждые `everyYears` лет; при обновлении оборудования цикл начинается заново. */
export type PeriodicCost = {
  everyYears: number;
  costRub: number;
  /** Новое оборудование включает новую АКБ и начинает её цикл заново. */
  resetEveryYears?: number;
};

export type CashflowInput = {
  capexRub: number;
  /** OPEX сценария за год со средней заменой АКБ внутри. */
  opexYearRub: number;
  /** OPEX «Как есть» за год по тому же охвату. */
  opexAsisRub: number;
  /** Средняя замена АКБ в год, которая входит в opexYearRub. */
  batteryAvgRub: number;
  batteryEvents: readonly PeriodicCost[];
  reinvestEvents: readonly PeriodicCost[];
  /** Горизонт TCO, лет (целое ≥ 1). */
  tcoYears: number;
  discountRate: number;
  /** Net disposal proceeds at the end of TCO, after tax, removal and delivery. Default excludes salvage. */
  terminalResidualRub?: number;
};

function periodic(events: readonly PeriodicCost[], t: number, T: number): number {
  let sum = 0;
  for (const e of events) {
    const every = Math.max(1, Math.round(e.everyYears));
    const age = e.resetEveryYears === undefined ? t : t % Math.max(1, Math.round(e.resetEveryYears));
    if (age > 0 && age % every === 0 && t < T) sum += e.costRub;
  }
  return sum;
}

/**
 * Годовые потоки t = 0…T:
 * - АКБt = N × стоимость комплекта, если возраст оборудования кратен сроку замены и t < T;
 *   в год покупки нового оборудования отдельная АКБ не нужна;
 * - OPEXt = OPEX − АКБср + АКБt;
 * - докупкаt = оборудование, если t кратно сроку службы и t < T;
 * - Et = OPEXкак есть − OPEXt; CF0 = −CAPEX; CFt = Et − докупкаt.
 * Замена или докупка в последний год горизонта не считается: ресурс купленного выходит за
 * горизонт, и это завысило бы стоимость владения.
 */
export function cashflows(i: CashflowInput): CashflowRow[] {
  const terminalResidualRub = i.terminalResidualRub ?? 0;
  if (!Number.isFinite(terminalResidualRub) || terminalResidualRub < 0) throw new Error("Остаточная стоимость должна быть неотрицательной чистой суммой");
  const T = Math.max(1, Math.round(i.tcoYears));
  const rows: CashflowRow[] = [];
  let cumulative = -i.capexRub;
  let cumulativeDiscounted = -i.capexRub;
  rows.push({
    year: 0,
    capexRub: i.capexRub,
    opexRub: 0,
    batteryRub: 0,
    reinvestRub: 0,
    effectRub: 0,
    cashflowRub: -i.capexRub,
    cumulativeRub: cumulative,
    discountedRub: -i.capexRub,
    cumulativeDiscountedRub: cumulativeDiscounted,
  });
  for (let t = 1; t <= T; t++) {
    const batteryRub = periodic(i.batteryEvents, t, T);
    const reinvestRub = periodic(i.reinvestEvents, t, T);
    const opexRub = i.opexYearRub - i.batteryAvgRub + batteryRub;
    const effectRub = i.opexAsisRub - opexRub;
    const residualRub = t === T ? terminalResidualRub : 0;
    const cashflowRub = effectRub - reinvestRub + residualRub;
    const discountedRub = cashflowRub / Math.pow(1 + i.discountRate, t);
    cumulative += cashflowRub;
    cumulativeDiscounted += discountedRub;
    rows.push({
      year: t,
      capexRub: 0,
      opexRub,
      batteryRub,
      reinvestRub,
      effectRub,
      cashflowRub,
      cumulativeRub: cumulative,
      discountedRub,
      cumulativeDiscountedRub: cumulativeDiscounted,
      ...(residualRub > 0 ? { residualRub } : {}),
    });
  }
  return rows;
}

/** Потоки CF0…CFH для NPV и дисконтированной окупаемости. */
function firstH(rows: readonly CashflowRow[], H: number): number[] {
  return rows.slice(0, Math.max(1, Math.round(H)) + 1).map((r) => r.cashflowRub);
}

/** Простой срок окупаемости по ТЗ: CAPEX / E при E > 0, иначе null. */
export function payback(capexRub: number, effectYearRub: number): number | null {
  if (!(effectYearRub > 0)) return null;
  const pb = capexRub / effectYearRub;
  return Number.isFinite(pb) ? pb : null;
}

/** ROI по ТЗ: Σ CFt за t = 1…H / CAPEX × 100 %; при CAPEX = 0 не определён (null). */
export function roiTz(rows: readonly CashflowRow[], H: number, capexRub: number): number | null {
  if (!(capexRub > 0)) return null;
  const sum = firstH(rows, H)
    .slice(1)
    .reduce((a, b) => a + b, 0);
  const v = (sum / capexRub) * 100;
  return Number.isFinite(v) ? v : null;
}

/** Чистый ROI = ROI по ТЗ − 100 %. */
export function roiNet(roiTzPct: number | null): number | null {
  return roiTzPct === null ? null : roiTzPct - 100;
}

/** NPV за первые H лет. */
export function npvOf(rows: readonly CashflowRow[], H: number, rate: number): number {
  return npv(rate, firstH(rows, H));
}

/** Дисконтированный срок окупаемости за первые H лет (null — не окупается в горизонте). */
export function dpbOf(rows: readonly CashflowRow[], H: number, rate: number): number | null {
  return discountedPaybackYears(rate, firstH(rows, H));
}

/** TCO за все T лет потока: CAPEX + Σ (OPEXt + докупкаt). */
export function tcoOf(rows: readonly CashflowRow[]): number {
  let sum = 0;
  for (const r of rows) sum += r.year === 0 ? r.capexRub : r.opexRub + r.reinvestRub - (r.residualRub ?? 0);
  return sum;
}

/** TCO «Как есть»: T × OPEX. */
export function tcoAsis(opexAsisRub: number, T: number): number {
  return Math.max(1, Math.round(T)) * opexAsisRub;
}
