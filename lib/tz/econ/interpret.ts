import type { NormValues } from "../norms";
import type { Band } from "../types";
import { fx, yearsGen } from "./text";
import { pluralRu } from "../../format/plural";

/**
 * Интервал окупаемости (ТЗ §3.5.7): быстрая, средняя, долгая, не окупается. Это описание
 * результата, а не критерий рекомендации: рекомендация строится по NPV и дисконтированной
 * окупаемости. Границы — нормативы paybackBandFastYears / paybackBandSlowYears (по умолчанию
 * 3 и 5 лет, как в примере ТЗ), resolveNorms гарантирует, что «долгая» не ниже «быстрой».
 */
export function interpretBand(
  pb: number | null,
  norms: Pick<NormValues, "paybackBandFastYears" | "paybackBandSlowYears">,
): { band: Band; text: string } {
  const fast = norms.paybackBandFastYears;
  const slow = Math.max(fast, norms.paybackBandSlowYears);
  if (pb === null || !Number.isFinite(pb) || pb < 0) {
    return { band: "none", text: "не окупается в пределах горизонта" };
  }
  if (pb < fast) return { band: "fast", text: `быстрая окупаемость (менее ${yearsGen(fast)})` };
  if (pb <= slow) {
    const word = Number.isInteger(slow) ? pluralRu(slow, ["год", "года", "лет"]) : "года";
    return { band: "moderate", text: `средняя окупаемость (${fx(fast, 1)}–${fx(slow, 1)} ${word})` };
  }
  return { band: "slow", text: `долгая окупаемость (более ${yearsGen(slow)})` };
}
