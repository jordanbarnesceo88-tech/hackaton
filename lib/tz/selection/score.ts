import { formatMRub } from "../../format/rub";
import type { NormValues } from "../norms";
import type { ProductForCalc, ProductStatus, ScoreContribution } from "../types";
import type { Margins } from "./constraints";
import { SELECTION_CONSTANTS } from "./rules";
import { amongCandidates, fmtNum, fmtShareAsPct, ordinalRu } from "./text";

/**
 * Балл подбора 0–100 с разложением по факторам (ТЗ §3.4.5: «пользователь должен видеть критерии
 * и вклад ключевых факторов в итоговую оценку»). Веса — нормативы `scoreWeight*`, уже
 * согласованные `resolveNorms` (сумма 1); здесь они не нормируются повторно.
 *
 * Балл = round(Σ вес × значение фактора × 100), значение фактора — от 0 до 1:
 * - экономика — NPV покупки, нормированный min-max среди кандидатов с рассчитанным NPV;
 * - данные — полнота карточки × доля подтверждённых характеристик;
 * - зрелость — серийная эксплуатация 1, пилот 0,6;
 * - запас — запас по грузоподъёмности × запас по ширине прохода;
 * - кейсы — есть опубликованные внедрения 1, нет 0.
 */

/** Место продукта по NPV покупки среди кандидатов с рассчитанным NPV. */
export type EconRank = {
  npvRub: number;
  /** Нормированное значение 0–1: (NPV − min) / (max − min); один кандидат или все равны — 1. */
  value01: number;
  /** Место по убыванию NPV (1 — лучший); равные NPV делят место. */
  rank: number;
  poolSize: number;
  /** Все кандидаты имеют одинаковый NPV. */
  allEqual: boolean;
};

/** Ранжирует NPV покупки кандидатов. Вход — только конечные числа. */
export function rankEcon(pool: readonly { slug: string; npvRub: number }[]): Map<string, EconRank> {
  const out = new Map<string, EconRank>();
  if (pool.length === 0) return out;
  const values = pool.map((p) => p.npvRub);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const allEqual = max - min === 0;
  for (const p of pool) {
    const rank = 1 + values.filter((v) => v > p.npvRub).length;
    const value01 = allEqual ? 1 : (p.npvRub - min) / (max - min);
    out.set(p.slug, { npvRub: p.npvRub, value01, rank, poolSize: pool.length, allEqual });
  }
  return out;
}

/** Значение фактора «Зрелость» по статусу каталога. НИОКР в подбор не попадает (R1). */
export const MATURITY_VALUE: Readonly<Record<ProductStatus, number>> = {
  operation: 1,
  piloting: SELECTION_CONSTANTS.maturityPiloting.value,
  rnd: 0,
};

/** Вход расчёта балла одного продукта. */
export type ScoreInput = {
  product: ProductForCalc;
  /** Место по NPV; null — NPV нет, фактор «Экономика» равен 0. */
  econ: EconRank | null;
  /** Почему NPV нет — продолжение фразы «нет данных для экономики: …». */
  econMissingWhy: string | null;
  margins: Margins;
  norms: NormValues;
};

/** Балл продукта: итог, несокращённая сумма (для выбора лучшего) и вклады факторов. */
export type ScoreResult = {
  total: number;
  /** Σ вес × значение × 100 без округления — чтобы округление не решало, кто лучший. */
  raw: number;
  contributions: ScoreContribution[];
};

/** Убирает хвост двоичной арифметики из сохраняемых значений (снимок проекта сравнивается бит-в-бит). */
function round(v: number, digits: number): number {
  const k = 10 ** digits;
  return Math.round(v * k) / k;
}

/**
 * Значение фактора в границах 0–1. Нечисловое значение (NaN, ±∞ из повреждённого снимка) даёт
 * 0: в результате модели не бывает NaN и Infinity, а неизвестное не засчитывается в плюс.
 */
function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Процент карточки для объяснения: нечисловое значение — «не рассчитана». */
function pctText(v: number): string {
  return Number.isFinite(v) ? `${fmtNum(v)} %` : "не рассчитана";
}

/** Очки фактора словами: «32 из 40». */
function pointsText(label: string, weight: number, value01: number): string {
  return `${label}: ${fmtNum(Math.round(weight * value01 * 100))} из ${fmtNum(Math.round(weight * 100))}`;
}

function econPart(input: ScoreInput): { value01: number; explanation: string } {
  const { econ } = input;
  if (econ === null) {
    const why = input.econMissingWhy ? `: ${input.econMissingWhy}` : "";
    return { value01: 0, explanation: `нет данных для экономики${why}` };
  }
  const npv = formatMRub(econ.npvRub);
  if (econ.poolSize === 1) {
    return { value01: econ.value01, explanation: `NPV покупки ${npv}; других кандидатов с расчётом NPV нет` };
  }
  if (econ.allEqual) {
    return { value01: econ.value01, explanation: `NPV покупки ${npv}, одинаковый у всех ${econ.poolSize} кандидатов` };
  }
  return {
    value01: econ.value01,
    explanation: `NPV покупки ${npv}, ${ordinalRu(econ.rank)} ${amongCandidates(econ.poolSize)}`,
  };
}

function dataPart(p: ProductForCalc): { value01: number; explanation: string } {
  const completeness = clamp01(p.completenessPct / 100);
  const confirmed = clamp01(p.confirmedSharePct / 100);
  return {
    value01: completeness * confirmed,
    explanation: Number.isFinite(p.confirmedSharePct)
      ? `полнота карточки ${pctText(p.completenessPct)} × подтверждено первоисточником ` +
        `${fmtNum(p.confirmedSharePct)} % характеристик`
      : `полнота карточки ${pctText(p.completenessPct)} × доля подтверждённых характеристик не рассчитана`,
  };
}

function maturityPart(p: ProductForCalc): { value01: number; explanation: string } {
  const v = MATURITY_VALUE[p.status];
  const text =
    p.status === "operation"
      ? "серийная эксплуатация"
      : p.status === "piloting"
        ? `пилотная эксплуатация — засчитывается ${fmtNum(v)} от серийной`
        : "стадия НИОКР";
  return { value01: v, explanation: text };
}

function marginPart(m: Margins): { value01: number; explanation: string } {
  const unknownPart = SELECTION_CONSTANTS.unknownMarginPart.value;
  const fullShare = SELECTION_CONSTANTS.payloadMarginFullShare.value;
  const fullAisleM = SELECTION_CONSTANTS.aisleMarginFullM.value;

  let payloadV = 1;
  let payloadText: string;
  if (m.payload.state === "known" && m.payload.share !== null) {
    payloadV = clamp01(m.payload.share / fullShare);
    payloadText = `грузоподъёмность +${fmtShareAsPct(m.payload.share)} к массе груза (полный балл от +${fmtShareAsPct(fullShare)})`;
  } else if (m.payload.state === "unknown") {
    payloadV = unknownPart;
    payloadText =
      m.payload.payloadKg === null
        ? `грузоподъёмность не опубликована — засчитано ${fmtNum(unknownPart)}`
        : `масса груза объекта не задана — засчитано ${fmtNum(unknownPart)}`;
  } else {
    payloadText = "масса груза процессом не ограничивается";
  }

  let aisleV = 1;
  let aisleText: string;
  if (m.aisle.state === "known" && m.aisle.marginM !== null) {
    aisleV = clamp01(m.aisle.marginM / fullAisleM);
    aisleText = `проход шире нужного на ${fmtNum(round(m.aisle.marginM, 2))} м (полный балл от ${fmtNum(fullAisleM)} м)`;
  } else if (m.aisle.state === "unknown") {
    aisleV = unknownPart;
    aisleText =
      m.aisle.needM === null
        ? `ширина прохода не опубликована — засчитано ${fmtNum(unknownPart)}`
        : `ширина проходов объекта не задана — засчитано ${fmtNum(unknownPart)}`;
  } else if (m.aisle.stationary) {
    aisleText = "стационарное решение — проходы для проезда не нужны";
  } else {
    aisleText = "ширина проходов процессом не ограничивается";
  }

  return { value01: payloadV * aisleV, explanation: `${payloadText}; ${aisleText}` };
}

function casesPart(p: ProductForCalc): { value01: number; explanation: string } {
  return p.hasCases
    ? { value01: 1, explanation: "есть опубликованные внедрения" }
    : { value01: 0, explanation: "опубликованных внедрений нет" };
}

/**
 * Считает балл продукта и вклад каждого фактора. `points` хранится с одним знаком, `value01` —
 * с четырьмя, итог — округлённая несокращённая сумма, поэтому сумма вкладов расходится с итогом
 * не больше чем на округление.
 */
export function scoreProduct(input: ScoreInput): ScoreResult {
  const { product, norms } = input;
  const parts: { factor: ScoreContribution["factor"]; label: string; weight: number; part: { value01: number; explanation: string } }[] = [
    { factor: "econ", label: "Экономика", weight: norms.scoreWeightEcon, part: econPart(input) },
    { factor: "data", label: "Данные", weight: norms.scoreWeightData, part: dataPart(product) },
    { factor: "maturity", label: "Зрелость", weight: norms.scoreWeightMaturity, part: maturityPart(product) },
    { factor: "margin", label: "Запас", weight: norms.scoreWeightMargin, part: marginPart(input.margins) },
    { factor: "cases", label: "Кейсы", weight: norms.scoreWeightCases, part: casesPart(product) },
  ];

  let raw = 0;
  const contributions: ScoreContribution[] = parts.map(({ factor, label, weight, part }) => {
    const value01 = clamp01(part.value01);
    const points = weight * value01 * 100;
    raw += points;
    return {
      factor,
      label,
      weight,
      value01: round(value01, 4),
      points: round(points, 1),
      explanation: `${pointsText(label, weight, value01)} — ${part.explanation}`,
    };
  });

  return { total: Math.round(raw), raw, contributions };
}
