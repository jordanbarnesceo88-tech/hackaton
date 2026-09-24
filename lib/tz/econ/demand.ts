import type { ProcessDef } from "../processes";
import type { TraceStep } from "../types";
import { num, paramLabel, refuse, workHours, type ScenarioContext, type WorkHours } from "./context";
import { FORMULAS } from "./formulas";
import { fx } from "./text";

/** Спрос процесса: в сутки, средний и пиковый в час. */
export type DemandResult = {
  perDay: number;
  avgPerHour: number;
  peakPerHour: number;
  peakFactor: number;
  /** Доля негабарита, % (0 — у процесса её нет). */
  excludeSharePct: number;
  trace: TraceStep[];
};

/**
 * Спрос процесса по его определению (ProcessDef.demand):
 * Qсут = Σ sumParams × (shareParam / 100) × Π multiplierParams × (1 − excludeShare / 100);
 * λср = Qсут / Hсут; λпик = λср × пиковый коэффициент (нет параметра пика — 1).
 *
 * Нулевой спрос — отказ invalid_inputs: роботам нечего делать, а доля закрытого спроса
 * (κ = … / λпик) не определена.
 */
export function processDemand(
  ctx: Pick<ScenarioContext, "params" | "paramLabels">,
  process: ProcessDef,
  hours?: WorkHours,
): DemandResult {
  const h = hours ?? workHours(ctx);
  const d = process.demand;
  if (!d) {
    refuse(
      "calc_not_supported",
      `Экономика для процесса «${process.name}» в прототипе не рассчитывается (§5.7)`,
    );
  }
  const p = ctx.params;
  const lab = (key: string) => ({ label: paramLabel(ctx, key) });

  const terms = d.sumParams.map((key) => num(p, key, lab(key)));
  const sum = terms.reduce((a, b) => a + b, 0);
  let share = 1;
  let shareText = "";
  if (d.shareParam) {
    const s = num(p, d.shareParam, lab(d.shareParam));
    if (s > 100) {
      refuse("invalid_inputs", `Доля «${paramLabel(ctx, d.shareParam)}» не может быть больше 100 %`, [
        `param:${d.shareParam}`,
      ]);
    }
    share = s / 100;
    shareText = ` × ${fx(s)}/100`;
  }
  let mult = 1;
  let multText = "";
  for (const key of d.multiplierParams ?? []) {
    const m = num(p, key, lab(key));
    mult *= m;
    multText += ` × ${fx(m)}`;
  }
  let excludePct = 0;
  let excludeText = "";
  if (d.excludeShareParam) {
    excludePct = num(p, d.excludeShareParam, lab(d.excludeShareParam));
    if (excludePct > 100) {
      refuse("invalid_inputs", `Доля «${paramLabel(ctx, d.excludeShareParam)}» не может быть больше 100 %`, [
        `param:${d.excludeShareParam}`,
      ]);
    }
    excludeText = ` × (1 − ${fx(excludePct)}/100)`;
  }
  const perDay = sum * share * mult * (1 - excludePct / 100);
  if (!(perDay > 0)) {
    refuse(
      "invalid_inputs",
      `Спрос процесса «${process.name}» равен нулю: укажите объёмы операций в параметрах объекта`,
      d.sumParams.map((k) => `param:${k}`),
    );
  }

  let peakFactor = 1;
  if (process.peakFactorParam) {
    peakFactor = num(p, process.peakFactorParam, lab(process.peakFactorParam));
    if (!(peakFactor > 0)) {
      refuse("invalid_inputs", "Пиковый коэффициент должен быть больше нуля", [`param:${process.peakFactorParam}`]);
    }
  }
  const avgPerHour = perDay / h.Hd;
  const peakPerHour = avgPerHour * peakFactor;

  const sumText = terms.length > 1 ? `(${terms.map((t) => fx(t)).join(" + ")})` : fx(sum);
  return {
    perDay,
    avgPerHour,
    peakPerHour,
    peakFactor,
    excludeSharePct: excludePct,
    trace: [
      {
        key: "demandDay",
        label: `${FORMULAS.demandDay.title} — ${process.name}`,
        formula: FORMULAS.demandDay.expression,
        substituted: `${sumText}${shareText}${multText}${excludeText} = ${fx(perDay)}`,
        value: perDay,
        unit: process.demandUnit,
        origin: "derived",
      },
      {
        key: "peakPerHour",
        label: FORMULAS.peakPerHour.title,
        formula: FORMULAS.peakPerHour.expression,
        substituted: `λср = ${fx(perDay)} / ${fx(h.Hd)} = ${fx(avgPerHour)}; λпик = ${fx(avgPerHour)} × ${fx(peakFactor)} = ${fx(peakPerHour)}`,
        value: peakPerHour,
        unit: process.throughputUnit,
        origin: "derived",
      },
    ],
  };
}
