// Pure time-value-of-money helpers for the economics engine (A3). Framework-free + unit
// tested. Cash-flow arrays are indexed by year, with index 0 = now (the initial outlay).

/** Net present value of a cash-flow series. Index 0 is undiscounted (t=0). */
export function npv(rate: number, cashflows: number[]): number {
  return cashflows.reduce((acc, cf, t) => acc + cf / Math.pow(1 + rate, t), 0);
}

/**
 * Fractional year at which cumulative *discounted* cash flow turns non-negative AND STAYS
 * there — the LAST crossing, not the first. `cashflows[0]` is the initial outlay at t=0
 * (typically negative). Returns `null` when the cumulative series ends below zero: the horizon
 * did not repay the investment, whatever the series did in the middle.
 *
 * Ч-3-аудит, МЕНЯЕТ ЧИСЛА. Было: возвращалось ПЕРВОЕ пересечение нуля, и к серии функция больше
 * не возвращалась. Это верно только пока потоки после пересечения положительны, а они не
 * положительны: докупка на `t % lifeYears === 0` — крупный отрицательный поток, загоняющий
 * накопленную сумму обратно в минус. Измерено перебором 12 544 сценариев: 6 расхождений, из них
 * горизонт 15, срок службы 7, ставка 0,05, capex $5 000 000, экономия $1 000 000/год давали
 * «окупаемость 5,9 года» при NPV −$699 088. `isViable()` такой проект отвергал, но панель
 * результатов всё равно печатала срок — ровно то противоречие, которое комментарий к `isViable`
 * (types.ts) описывает как уже закрытое для MediCarry M1.
 *
 * Проект, у которого накопленный приведённый поток на конце отрицателен, внутри горизонта не
 * окупается. Единственный честный ответ здесь — «не окупается», а не число из середины серии.
 */
export function discountedPaybackYears(rate: number, cashflows: number[]): number | null {
  let cumulative = 0;
  let crossing: number | null = null;
  for (const [t, cashflow] of cashflows.entries()) {
    const discounted = cashflow / Math.pow(1 + rate, t);
    const before = cumulative;
    cumulative += discounted;
    if (t === 0) {
      if (cumulative >= 0) crossing = 0; // no upfront cost — repaid before year one begins
      continue;
    }
    if (before < 0 && cumulative >= 0) {
      // Crossed during year t. Here `discounted >= -before > 0`, so the portion of the year
      // needed to reach break-even is in (0, 1]; Math.min only guards float drift.
      crossing = t - 1 + Math.min(1, -before / discounted);
    }
  }
  // Ends under water: whatever crossing was recorded got undone by a re-buy and never regained.
  return cumulative >= 0 ? crossing : null;
}

import type { AssumptionValues } from "./types";

/**
 * Горизонт и срок службы модель потребляет ЦЕЛЫМИ годами: докупка привязана к `t % lifeYears`,
 * а поток года — к целому индексу. Дробное значение обязано куда-то отобразиться, и вопрос
 * только в том, куда.
 *
 * Ч-3-аудит, МЕНЯЕТ ЧИСЛА. Было `Math.floor`, и это худший из вариантов: 4,99 считалось как 4
 * (NPV 425 439 вместо 515 659), а срок службы 1,99 — как 1, то есть докупка КАЖДЫЙ год
 * (NPV 341 012 вместо 433 278, скачок 27 %). Человек правил поле, видел в нём 1,99 и получал
 * ответ для числа, отстоящего от введённого почти на целый год, — и всегда в одну сторону.
 * Округление к БЛИЖАЙШЕМУ целому оставляет расхождение не больше половины года и делает его
 * симметричным; оба измеренных случая (4,99 ≡ 5 и 1,99 ≡ 2) исчезают.
 *
 * Отказывать здесь движок не может: `assumptions.ts` прямо объявляет, что границы значений —
 * это рубеж интерфейса и сохранения, а движок «must stay total for any finite input», потому
 * что торнадо намеренно считает вырожденные сценарии. Полное решение — не принимать дробное
 * на входе (`ASSUMPTION_BOUNDS` / `validateAssumptions` / поле панели), как это уже сделано для
 * `quantityOverride`. До тех пор округление раскрыто человеку в `EXPLANATIONS.npv`.
 */
function wholeYears(years: number): number {
  return Math.round(years);
}

/**
 * A3 finance projection over the ROI horizon. Re-buys the fleet when assets wear out with
 * productive years left (`t % lifeYears === 0 && t < horizon`); horizon and life are consumed
 * as whole years (see `wholeYears`).
 * Does NOT gate on savings sign — a negative annualSavings yields a real negative NPV (used by
 * the sensitivity tornado).
 */
export function projectFinance(
  annualSavingsUsd: number,
  capexUsd: number,
  a: AssumptionValues
): { npvUsd: number; simplePaybackYears: number; simpleRoiPct: number; discountedPaybackYears: number | null } {
  const horizon = wholeYears(a.roiHorizonYears);
  const lifeYears = wholeYears(a.assetLifeYears);
  const cashflows: number[] = [-capexUsd];
  let reCapexTotal = 0;
  for (let t = 1; t <= horizon; t++) {
    const reCapex = t % lifeYears === 0 && t < horizon ? capexUsd : 0;
    reCapexTotal += reCapex;
    cashflows.push(annualSavingsUsd - reCapex);
  }
  // Единственная «инвестиция» в этом расчёте: первая покупка плюс все докупки за горизонт.
  // Ею меряются ОБА простых показателя.
  const investmentUsd = capexUsd + reCapexTotal;
  return {
    npvUsd: npv(a.discountRate, cashflows),
    // Ч-1-аудит, МЕНЯЕТ ЧИСЛА. Было `capexUsd / annualSavingsUsd` — только первая покупка,
    // тогда как стоящий рядом ROI делил на `investmentUsd`, то есть с докупками. Два числа на
    // одном экране, два разных смысла слова «инвестиция», и меньшее из них — то, которое
    // красивее. Измерено: capex $57 500, срок службы 2, горизонт 5 → полная инвестиция
    // $172 500; экран показывал окупаемость 0,36 года при ROI 360,9 %, тогда как та же
    // инвестиция окупается за 1,085 года — втрое дольше.
    //
    // База выбрана одна — полная инвестиция, — потому что второй показатель (NPV) докупки уже
    // учитывает, и срок окупаемости рядом с ним обязан считаться от тех же денег. Теперь два
    // числа выводятся друг из друга: simpleRoiPct = (horizon / simplePaybackYears − 1) × 100,
    // и противоречить друг другу они больше не могут. Когда срок службы не короче горизонта,
    // докупок нет, `investmentUsd === capexUsd`, и прежние числа сохраняются до знака.
    simplePaybackYears: investmentUsd / annualSavingsUsd,
    simpleRoiPct: ((annualSavingsUsd * horizon - investmentUsd) / investmentUsd) * 100,
    discountedPaybackYears: discountedPaybackYears(a.discountRate, cashflows),
  };
}
