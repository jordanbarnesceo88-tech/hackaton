import { formatYearsRu } from "../../format/plural";
import type { Conclusion, Risk, ScenarioOk, ScenarioResult, ScenarioSpec } from "../types";
import { FACILITY_PARAM_KEYS, HORIZON_MAX_YEARS, HORIZON_SCAN, optNum, type ScenarioContext } from "./context";
import { computeScenariosCore } from "./core";
import { interpretBand } from "./interpret";
import { sortRisks } from "./risks";
import { horizonBounds } from "./sensitivity";
import { fx, mrub, q, rangeText, rub, yearsGen, yearsNom } from "./text";

/**
 * Вывод по проекту (ТЗ §3.5.7): не жёсткий порог окупаемости, а число, риски и интерпретация.
 *
 * Рекомендуется жизнеспособный сценарий роботизации (NPV ≥ 0 и дисконтированная окупаемость
 * внутри горизонта) с наибольшим NPV; при равенстве — с меньшим CAPEX. Интервал окупаемости
 * описывает результат, но не отбирает сценарии.
 */

export const DISCLAIMER = "Результат является предварительной оценкой и требует верификации при обследовании объекта.";

/** Разница NPV, ₽, в пределах которой сценарии считаются равными. */
const NPV_TIE_RUB = 0.5;

/**
 * Диапазон горизонтов организатора для склада, лет (определён в context.ts). Смена вывода
 * ищется на диапазоне `horizonBounds` (sensitivity.ts): ctx.paramBounds, для склада — этот.
 */
export { HORIZON_SCAN };

function isRobotOk(r: ScenarioResult): r is ScenarioOk {
  return r.status === "ok" && r.kind !== "asis";
}

/** Жизнеспособен: NPV ≥ 0 и окупается с дисконтированием внутри горизонта. */
export function isViableScenario(r: ScenarioOk): boolean {
  return r.npvRub !== null && r.npvRub >= 0 && r.discountedPaybackYears !== null;
}

/** Рекомендуемый сценарий: наибольший NPV среди жизнеспособных, при равенстве — меньший CAPEX. */
export function pickRecommended(results: readonly ScenarioResult[]): ScenarioOk | null {
  let best: ScenarioOk | null = null;
  for (const r of results) {
    if (!isRobotOk(r) || !isViableScenario(r) || r.npvRub === null) continue;
    if (!best || best.npvRub === null) {
      best = r;
      continue;
    }
    const diff = r.npvRub - best.npvRub;
    if (diff > NPV_TIE_RUB || (Math.abs(diff) <= NPV_TIE_RUB && r.capexRub < best.capexRub)) best = r;
  }
  return best;
}

function horizonYears(ctx: Pick<ScenarioContext, "params" | "norms">): number {
  const h = optNum(ctx.params, FACILITY_PARAM_KEYS.horizonYears);
  return Math.min(HORIZON_MAX_YEARS, Math.max(1, Math.round(h ?? ctx.norms.tcoMinYears)));
}

function npvOfKey(ctx: ScenarioContext, specs: readonly ScenarioSpec[], key: string): number | null {
  const r = computeScenariosCore(ctx, specs).find((x) => x.key === key);
  return r && r.status === "ok" ? r.npvRub : null;
}

/**
 * Пороговая зарплата покупки, ₽/мес: при ней NPV = 0. NPV линеен по зарплате (зарплата входит
 * в OPEX «Как есть», в оставшийся ФОТ и в персонал эксплуатации линейно, парк от неё не
 * зависит), поэтому порог находится по двум расчётам. null — сценарий не покупка, нет
 * зарплаты, NPV не растёт с зарплатой или порог не положителен.
 */
export function breakEvenSalary(
  ctx: ScenarioContext,
  spec: ScenarioSpec,
  specs: readonly ScenarioSpec[],
): number | null {
  if (spec.kind !== "purchase") return null;
  const first = spec.items?.[0];
  const proc = first ? ctx.processes[first.process] : undefined;
  if (!proc?.salaryParam) return null;
  const key = proc.salaryParam;
  const s0 = optNum(ctx.params, key);
  if (s0 === null || !(s0 > 0)) return null;
  const s1 = s0 * 1.1;
  const at = (s: number) => npvOfKey({ ...ctx, params: { ...ctx.params, [key]: s } }, specs, spec.key);
  const n0 = at(s0);
  const n1 = at(s1);
  if (n0 === null || n1 === null) return null;
  const slope = (n1 - n0) / (s1 - s0);
  if (!(slope > 1e-9)) return null;
  const x = s0 - n0 / slope;
  return Number.isFinite(x) && x > 0 ? x : null;
}

/**
 * Докупка оборудования, которая входит в первые H лет денежного потока покупки при горизонте
 * `horizonYears`, но не входит при горизонте на год меньше. С этого горизонта NPV покупки
 * скачком снижается: остаточная стоимость докупленного парка не учитывается (MODEL_LIMITATIONS).
 */
export type ReinvestNote = {
  /** Горизонт, с которого докупка входит в расчёт, лет. */
  horizonYears: number;
  /** Год денежного потока, в котором докупается оборудование. */
  year: number;
  /** Сумма докупки, ₽. */
  rub: number;
  scenarioKey: string;
  scenarioName: string;
};

export type HorizonFlip = {
  /** Ближайший к текущему горизонт, на котором выгоднее другой сценарий, лет. */
  years: number;
  /** Горизонты подряд с тем же другим выводом, лет: fromYears ≤ years ≤ toYears. */
  fromYears: number;
  toYears: number;
  /**
   * Отрезок доходит до края диапазона горизонтов (horizonBounds; для склада 3–10 лет): текст
   * «≥ h» или «≤ h». Иначе вывод меняется только на отрезке, и текст называет его («7 лет»,
   * «7–8 лет»).
   */
  openEnded: boolean;
  direction: "up" | "down";
  scenarioKey: string;
  scenarioName: string;
  /**
   * Докупка оборудования на границе отрезка, с которой покупка теряет рекомендацию; null — на
   * границах отрезка докупка в расчёт не входит.
   */
  reinvest: ReinvestNote | null;
  text: string;
};

/** «7 лет» или «8–10 лет» (слово «лет» согласуется с последним числом). */
function yearsSpan(a: number, b: number): string {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return lo === hi ? yearsNom(lo) : `${fx(lo)}–${yearsNom(hi)}`;
}

/** Пояснение к пункту о смене вывода: почему покупка перестаёт быть выгоднее. */
function reinvestText(r: ReinvestNote): string {
  return ` (с горизонта ${yearsNom(r.horizonYears)} в расчёт ${q(r.scenarioName)} входит докупка оборудования на ${mrub(r.rub)} в год ${fx(r.year)} без учёта остаточной стоимости)`;
}

/**
 * Смена вывода по горизонту: для каждого горизонта диапазона (horizonBounds: границы
 * ctx.paramBounds, для склада без них — 3–10 лет организатора, для других объектов ±20 %)
 * определяется рекомендуемый сценарий. Сначала ищется ближайший больший горизонт, на котором
 * выгоднее другой сценарий, затем ближайший меньший. Найденный горизонт расширяется до отрезка
 * подряд с тем же выводом.
 *
 * Вывод по горизонту не обязан быть монотонным: докупка оборудования в год окончания срока
 * службы входит в поток только при горизонте больше срока службы (см. MODEL_LIMITATIONS),
 * поэтому покупка может выигрывать ровно на одном горизонте. Отсюда правило текста: «≥ h» или
 * «≤ h» — только если отрезок доходит до края диапазона; иначе называется сам отрезок и, если
 * за ним до края снова рекомендуется текущий сценарий, это тоже говорится. Если на границе
 * отрезка покупка проигрывает из-за докупки оборудования, пункт называет её год и сумму. null —
 * вывод на всём диапазоне тот же.
 */
export function horizonFlip(ctx: ScenarioContext, specs: readonly ScenarioSpec[]): HorizonFlip | null {
  const H = horizonYears(ctx);
  const { low: from, high: to } = horizonBounds(ctx, H);
  const cache = new Map<number, ScenarioResult[]>();
  const resultsAt = (h: number): ScenarioResult[] => {
    let r = cache.get(h);
    if (!r) {
      r = computeScenariosCore({ ...ctx, params: { ...ctx.params, [FACILITY_PARAM_KEYS.horizonYears]: h } }, specs);
      cache.set(h, r);
    }
    return r;
  };
  const winners = new Map<number, ScenarioOk | null>();
  for (let h = from; h <= to; h++) winners.set(h, pickRecommended(resultsAt(h)));
  const current = winners.has(H) ? (winners.get(H) ?? null) : pickRecommended(resultsAt(H));
  const currentKey = current?.key ?? null;
  const keyAt = (h: number) => winners.get(h)?.key ?? null;

  /** Докупка, которая входит в первые h лет потока покупки `key`, но не в первые h − 1. */
  const reinvestEntering = (key: string, h: number): ReinvestNote | null => {
    if (h < 2) return null;
    const rowsOf = (x: number) => {
      const r = resultsAt(x).find((s) => s.key === key);
      return r && r.status === "ok" && r.kind === "purchase" ? { name: r.name, rows: r.cashflows.slice(1, x + 1) } : null;
    };
    const now = rowsOf(h);
    const before = rowsOf(h - 1);
    if (!now || !before) return null;
    const was = new Set(before.rows.filter((r) => r.reinvestRub > 0).map((r) => r.year));
    const row = now.rows.find((r) => r.reinvestRub > 0 && !was.has(r.year));
    return row ? { horizonYears: h, year: row.year, rub: row.reinvestRub, scenarioKey: key, scenarioName: now.name } : null;
  };

  const describe = (h: number, w: ScenarioOk, direction: "up" | "down"): HorizonFlip => {
    const step = direction === "up" ? 1 : -1;
    const edge = direction === "up" ? to : from;
    let end = h;
    while (end !== edge && keyAt(end + step) === w.key) end += step;
    const openEnded = end === edge;
    const lo = Math.min(h, end);
    const hi = Math.max(h, end);
    let text: string;
    if (openEnded) {
      text = `При горизонте ${direction === "up" ? "≥" : "≤"} ${yearsGen(h)} выгоднее ${q(w.name)}`;
    } else {
      text = `При горизонте ${yearsSpan(h, end)} выгоднее ${q(w.name)}`;
      // За отрезком до края диапазона — снова текущий вывод: так и сказать, чтобы не оставить
      // впечатления, что смена окончательная.
      let restSame = current !== null;
      for (let x = end + step; restSame && x !== edge + step; x += step) restSame = keyAt(x) === currentKey;
      if (restSame && current) text += `; при горизонте ${yearsSpan(end + step, edge)} — снова ${q(current.name)}`;
    }
    // Почему покупка проигрывает на границе отрезка: сверху — сама покупка-победитель отрезка
    // перестаёт выигрывать на hi + 1; снизу — покупка, выгодная до отрезка, проигрывает на lo.
    let reinvest: ReinvestNote | null = null;
    if (w.kind === "purchase" && hi < to) {
      reinvest = reinvestEntering(w.key, hi + 1);
    } else if (lo > from) {
      const below = winners.get(lo - 1) ?? null;
      if (below && below.kind === "purchase" && below.key !== w.key) reinvest = reinvestEntering(below.key, lo);
    }
    if (reinvest) text += reinvestText(reinvest);
    return {
      years: h,
      fromYears: lo,
      toYears: hi,
      openEnded,
      direction,
      scenarioKey: w.key,
      scenarioName: w.name,
      reinvest,
      text,
    };
  };

  for (let h = Math.max(from, H + 1); h <= to; h++) {
    const w = winners.get(h) ?? null;
    if (w && w.key !== currentKey) return describe(h, w, "up");
  }
  for (let h = Math.min(to, H - 1); h >= from; h--) {
    const w = winners.get(h) ?? null;
    if (w && w.key !== currentKey) return describe(h, w, "down");
  }
  return null;
}

const SEVERITY_LABEL: Readonly<Record<Risk["severity"], string>> = { high: "высокий", medium: "средний", low: "низкий" };

/**
 * Вывод по результатам сценариев. `specs` нужны для смены вывода по горизонту (без них пункт
 * пропускается); пороговая зарплата берётся из результатов (`breakEvenSalaryRubMonth`).
 */
export function buildConclusion(
  results: readonly ScenarioResult[],
  ctx: ScenarioContext,
  specs?: readonly ScenarioSpec[],
): Conclusion {
  const H = horizonYears(ctx);
  const robots = results.filter(isRobotOk);
  const rec = pickRecommended(results);
  const bullets: string[] = [];
  const bestRobot =
    rec ??
    robots
      .filter((r) => r.npvRub !== null)
      .reduce<ScenarioOk | null>((a, r) => (!a || (r.npvRub ?? -Infinity) > (a.npvRub ?? -Infinity) ? r : a), null);

  let headline: string;
  if (robots.length === 0) {
    const firstRefused = results.find((r) => r.kind !== "asis" && r.status === "refused");
    headline =
      firstRefused && firstRefused.status === "refused"
        ? `Сценарии роботизации не рассчитаны: ${firstRefused.refusal.message}`
        : "Нет сценариев роботизации для сравнения: добавьте сценарий покупки или услуги";
  } else if (rec) {
    const band = interpretBand(rec.paybackYears, ctx.norms);
    const pb = rec.paybackYears !== null ? formatYearsRu(rec.paybackYears) : "—";
    headline = `Рекомендуемый сценарий: ${rec.name}. NPV ${mrub(rec.npvRub ?? 0)} за ${yearsNom(H)}, окупаемость ${pb} — ${band.text}.`;
  } else {
    const lever = bestRobot?.sensitivity[0]?.label;
    headline = `При текущих параметрах ни один вариант роботизации не окупается за ${yearsNom(H)}; сильнейший рычаг — ${lever ? q(lever) : "не определён (нет анализа чувствительности)"}`;
  }

  // TCO: лидер по стоимости владения, если он не совпадает с рекомендацией.
  const oks = results.filter((r): r is ScenarioOk => r.status === "ok");
  const tcoWinner = oks.reduce<ScenarioOk | null>((a, r) => (!a || r.tcoRub < a.tcoRub ? r : a), null);
  if (tcoWinner) {
    if (rec && tcoWinner.key !== rec.key) {
      bullets.push(
        `По TCO за ${yearsNom(tcoWinner.tcoYears)} выгоднее ${q(tcoWinner.name)}: ${mrub(tcoWinner.tcoRub)} против ${mrub(rec.tcoRub)} у рекомендуемого сценария`,
      );
    } else if (!rec && robots.length > 0) {
      bullets.push(`Наименьшая TCO за ${yearsNom(tcoWinner.tcoYears)} — ${q(tcoWinner.name)}: ${mrub(tcoWinner.tcoRub)}`);
    }
  }

  // Три главных риска: рекомендуемого сценария, иначе всех сценариев роботизации.
  const riskSource = rec ? [rec] : robots;
  const seen = new Set<string>();
  const top = sortRisks(riskSource.flatMap((r) => r.risks)).filter((r) => {
    if (seen.has(r.code)) return false;
    seen.add(r.code);
    return true;
  });
  for (const r of top.slice(0, 3)) bullets.push(`Риск (${SEVERITY_LABEL[r.severity]}): ${r.text}`);

  // Сильнейший рычаг с диапазоном NPV.
  const lever = bestRobot?.sensitivity.find((s) => s.npvLow !== null && s.npvHigh !== null && s.swing > 0);
  if (lever && lever.npvLow !== null && lever.npvHigh !== null) {
    bullets.push(
      `Сильнейший рычаг — ${q(lever.label)}: при ${rangeText(lever.low, lever.high, lever.unit)} NPV от ${mrub(lever.npvLow)} до ${mrub(lever.npvHigh)}`,
    );
  }

  if (specs && robots.length > 0) {
    const flip = horizonFlip(ctx, specs);
    if (flip) bullets.push(flip.text);
  }

  const purchase = robots
    .filter((r) => r.kind === "purchase" && r.breakEvenSalaryRubMonth !== null)
    .reduce<ScenarioOk | null>((a, r) => (!a || (r.npvRub ?? -Infinity) > (a.npvRub ?? -Infinity) ? r : a), null);
  if (purchase && purchase.breakEvenSalaryRubMonth !== null) {
    bullets.push(`Покупка окупается (NPV ≥ 0) при зарплате от ${rub(purchase.breakEvenSalaryRubMonth)}/мес`);
  }

  return { recommendedScenarioKey: rec?.key ?? null, headline, bullets, disclaimer: DISCLAIMER };
}
