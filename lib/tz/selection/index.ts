import type { NormValues } from "../norms";
import { solutionTypeDef, type ProcessDef } from "../processes";
import type { ParamValues, ProductForCalc, SelectionResult, SelectionStatus } from "../types";
import { checkConstraints, positiveOrNull, type ConstraintReport, type SelectionContext } from "./constraints";
import {
  assessThroughput,
  cycleOnlyNote,
  insufficientReason,
  missingData,
  needsVerification,
  verificationNote,
  type ThroughputAssessment,
} from "./missing";
import { rankEcon, scoreProduct, type EconRank } from "./score";

/**
 * Подбор решений для процесса объекта (ТЗ §3.4, §2.2 шаг 3). Чистая функция без React и
 * Prisma: её вызывают сборка модели проекта на сервере (T2.2) и гостевой расчёт в браузере.
 *
 * Для каждого продукта:
 * 1. жёсткие правила R1–R6 — продукт исключается, причина с числами объекта и продукта;
 * 2. данные — без производительности парк не посчитать, статус «Недостаточно данных»;
 * 3. мягкие правила — ограничения и строка «требует проверки: …»;
 * 4. балл 0–100 с вкладами факторов (исключённые продукты балла не получают);
 * 5. рекомендуется один продукт — лучший по баллу кандидат с рассчитанным NPV покупки.
 *
 * Результат отсортирован: рекомендуемый, кандидаты, «Недостаточно данных», исключённые;
 * внутри группы — по баллу (по убыванию), затем по названию.
 */

export type { MissingItem, SelectionContext, TempRegime, Margins } from "./constraints";
export { OBJECT_PARAM_KEYS, parseTempRegime } from "./constraints";
export { FLAG_NOTES } from "./missing";
export { MATURITY_VALUE } from "./score";
export { SELECTION_CONSTANTS, SELECTION_RULES, type SelectionConstant, type SelectionRuleDef } from "./rules";

/** NPV покупки по slug продукта — считает экономика (T2.2) временным сценарием на каждого кандидата. */
export type SelectionEcon = Readonly<Record<string, { npvPurchaseRub: number | null }>>;

/** Вход подбора. */
export type SelectProductsInput = {
  facility: string;
  params: ParamValues;
  process: ProcessDef;
  products: readonly ProductForCalc[];
  norms: NormValues;
  econ?: SelectionEcon;
};

/** Порядок групп в выдаче подбора. */
export const SELECTION_STATUS_ORDER: Readonly<Record<SelectionStatus, number>> = {
  recommended: 0,
  candidate: 1,
  "insufficient-data": 2,
  excluded: 3,
};

/** Подписи статусов подбора для интерфейса и отчёта. */
export const SELECTION_STATUS_LABELS: Readonly<Record<SelectionStatus, string>> = {
  recommended: "Рекомендуется",
  candidate: "Кандидат",
  "insufficient-data": "Недостаточно данных",
  excluded: "Исключён",
};

type Evaluation = {
  product: ProductForCalc;
  report: ConstraintReport;
  thr: ThroughputAssessment;
  status: SelectionStatus;
  npvRub: number | null;
};

/** Почему у продукта нет NPV покупки — продолжение фразы «нет данных для экономики: …». */
function econMissingWhy(e: Evaluation, process: ProcessDef): string {
  if (!process.calcSupported) return `экономика процесса «${process.name}» в прототипе не рассчитывается`;
  if (e.status === "insufficient-data") return "без производительности парк не посчитать";
  if (positiveOrNull(e.product.priceRub) === null) return "нет цены — покупка не рассчитывается";
  return "NPV покупки не рассчитан";
}

/** Конечное число NPV из входа экономики; всё остальное (null, NaN, ±∞, нет записи) — null. */
function npvOf(econ: SelectionEcon | undefined, slug: string): number | null {
  const v = econ?.[slug]?.npvPurchaseRub;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Подбор для одного процесса. Вход не меняется; одинаковый вход — одинаковый результат. */
export function selectProducts(input: SelectProductsInput): SelectionResult[] {
  const { facility, params, process, products, norms, econ } = input;
  const ctx: SelectionContext = { facility, params, process };

  const evals: Evaluation[] = products.map((product) => {
    const report = checkConstraints(product, ctx);
    const thr = assessThroughput(product, process);
    const status: SelectionStatus =
      report.hard.length > 0 ? "excluded" : thr.insufficient ? "insufficient-data" : "candidate";
    return { product, report, thr, status, npvRub: npvOf(econ, product.slug) };
  });

  // Экономика сравнивается только между кандидатами: у исключённых и продуктов без
  // производительности NPV не участвует в нормировке, даже если его передали.
  const ranks = rankEcon(
    evals.flatMap((e) => (e.status === "candidate" && e.npvRub !== null ? [{ slug: e.product.slug, npvRub: e.npvRub }] : [])),
  );

  const rows = evals.map((e) => {
    const { product, report, thr, status } = e;
    const econRank: EconRank | null = status === "candidate" ? (ranks.get(product.slug) ?? null) : null;

    const limitations = [...report.soft];
    const cycle = status === "excluded" ? null : cycleOnlyNote(product, process, thr);
    if (cycle !== null) limitations.push(cycle);
    const verify = verificationNote(product);
    if (verify !== null) limitations.push(verify);

    const insufficient = insufficientReason(product, process, thr);
    const reasons = status === "excluded" ? [...report.hard] : [...(insufficient !== null ? [insufficient] : []), ...report.passed];

    const score =
      status === "excluded"
        ? null
        : scoreProduct({
            product,
            econ: econRank,
            econMissingWhy: econRank === null ? econMissingWhy(e, process) : null,
            margins: report.margins,
            norms,
          });

    const result: SelectionResult = {
      process: process.slug,
      productSlug: product.slug,
      productName: product.name,
      status,
      needsVerification: needsVerification(product, report.unverified.length),
      reasons,
      limitations,
      missing: [...missingData(product, thr), ...report.unverified],
      score: score === null ? { total: null, contributions: [] } : { total: score.total, contributions: score.contributions },
    };
    return { result, raw: score?.raw ?? null, econRank };
  });

  // Рекомендуется не больше одного продукта на процесс: лучший по баллу кандидат с
  // рассчитанным NPV покупки. Равный балл — выше NPV, затем название.
  let best: (typeof rows)[number] | null = null;
  for (const row of rows) {
    if (row.result.status !== "candidate" || row.econRank === null || row.raw === null) continue;
    if (best === null || best.raw === null || best.econRank === null) {
      best = row;
      continue;
    }
    const byScore = row.raw - best.raw;
    const byNpv = row.econRank.npvRub - best.econRank.npvRub;
    if (
      byScore > 1e-9 ||
      (Math.abs(byScore) <= 1e-9 && byNpv > 0) ||
      (Math.abs(byScore) <= 1e-9 && byNpv === 0 && compareNames(row.result, best.result) < 0)
    ) {
      best = row;
    }
  }
  if (best !== null) {
    best.result.status = "recommended";
    best.result.reasons.unshift(
      `Рекомендуется: лучший балл среди кандидатов с расчётом экономики — ${best.result.score.total} из 100`,
    );
  }

  return rows.map((r) => r.result).sort(compareResults);
}

/** Сравнение по названию на русском, затем по slug — чтобы порядок был полностью определён. */
function compareNames(a: SelectionResult, b: SelectionResult): number {
  const byName = a.productName.localeCompare(b.productName, "ru");
  if (byName !== 0) return byName;
  return a.productSlug < b.productSlug ? -1 : a.productSlug > b.productSlug ? 1 : 0;
}

/** Порядок выдачи: группа статуса, балл по убыванию (без балла — в конце), название. */
export function compareResults(a: SelectionResult, b: SelectionResult): number {
  const byStatus = SELECTION_STATUS_ORDER[a.status] - SELECTION_STATUS_ORDER[b.status];
  if (byStatus !== 0) return byStatus;
  const sa = a.score.total ?? -Infinity;
  const sb = b.score.total ?? -Infinity;
  if (sa !== sb) return sb - sa;
  return compareNames(a, b);
}

/**
 * Продукты, которые имеет смысл показывать в подборе процесса: заявленные для процесса, а также
 * продукты подходящего типа решения для этого типа объекта (их отсеет правило R6 с понятной
 * причиной). Остальной каталог — другие процессы и отрасли — в выдачу не попадает.
 */
export function relevantProducts(
  process: ProcessDef,
  facility: string,
  products: readonly ProductForCalc[],
): ProductForCalc[] {
  return products.filter(
    (p) =>
      p.processes.includes(process.slug) ||
      (process.solutionTypes.includes(p.solutionType) && p.facilityTypes.includes(facility)),
  );
}

/** Сводка по типу решения процесса (ТЗ §3.4.1: «список применимых типов решений»). */
export type SolutionTypeSummary = {
  slug: string;
  name: string;
  purpose: string;
  total: number;
  recommended: number;
  candidates: number;
  insufficient: number;
  excluded: number;
  /** Есть хотя бы один рекомендуемый или кандидат. */
  applicable: boolean;
};

/**
 * Применимые типы решений процесса по результатам подбора: сколько продуктов каждого типа
 * рекомендовано, осталось кандидатами, не хватило данных или исключено.
 */
export function summarizeSolutionTypes(
  process: ProcessDef,
  products: readonly ProductForCalc[],
  results: readonly SelectionResult[],
): SolutionTypeSummary[] {
  const typeBySlug = new Map(products.map((p) => [p.slug, p.solutionType]));
  return process.solutionTypes.map((slug) => {
    const def = solutionTypeDef(slug);
    const mine = results.filter((r) => r.process === process.slug && typeBySlug.get(r.productSlug) === slug);
    const count = (s: SelectionStatus) => mine.filter((r) => r.status === s).length;
    const recommended = count("recommended");
    const candidates = count("candidate");
    return {
      slug,
      name: def?.name ?? slug,
      purpose: def?.purpose ?? "",
      total: mine.length,
      recommended,
      candidates,
      insufficient: count("insufficient-data"),
      excluded: count("excluded"),
      applicable: recommended + candidates > 0,
    };
  });
}
