import { createHash } from "node:crypto";
import { disclaimerOf, facilityLabelOf, scenarioTableRows, type ReportResults, type ScenarioRowKey } from "@/lib/report/tz/rows";
import { pickRecommended } from "@/lib/tz/econ/conclusion";
import { sortRisks } from "@/lib/tz/econ/risks";
import type { ScenarioKind, ScenarioResult } from "@/lib/tz/types";
import { ADVICE_PROMPT_VERSION } from "./prompt";
import type { AdviceFacts, AdviceScenarioFacts } from "./types";

/**
 * Факты для ИИ из сохранённого (или только что посчитанного сервером) расчёта. Показатели берутся
 * из таблицы сценариев отчёта (scenarioTableRows) — с теми же подписями и той же записью чисел,
 * что видит пользователь, поэтому числа в ответе ИИ можно сверить с фактами один к одному.
 *
 * Выбранный платформой сценарий идёт отдельно со всеми рисками: иначе модель переносила риски
 * альтернатив на него (проверено на модели). У альтернатив — главный риск, а если выбора нет —
 * три главных: тогда сравнивать приходится их.
 */

const KIND_LABEL: Readonly<Record<ScenarioKind, string>> = {
  asis: "Как есть (база сравнения)",
  purchase: "Покупка",
  raas: "Услуга (RaaS)",
};

/** Строки таблицы сценариев в фактах; «Риски» не берём — риски идут списком. ROI не берём: у RaaS он неинформативен. */
const FACT_ROWS: ReadonlySet<ScenarioRowKey> = new Set([
  "composition", "capex", "opex", "effect", "payback", "band", "npv", "dpb", "tco", "tcoDelta", "sim", "verdict",
]);

export function buildAdviceFacts(results: ReportResults): AdviceFacts {
  const rows = scenarioTableRows(results).filter((row) => FACT_ROWS.has(row.rowKey));
  const recommendedKey = pickRecommended(results.results.filter((r) => r.key === results.conclusion.recommendedScenarioKey))?.key ?? null;
  const scenario = (r: ScenarioResult, index: number, riskLimit: number): AdviceScenarioFacts => ({
    name: r.name,
    kind: KIND_LABEL[r.kind],
    metrics: Object.fromEntries(
      rows.map((row) => [row.label, row.cells[index] ?? ""] as const).filter(([, cell]) => cell !== "" && cell !== "—"),
    ),
    risks: sortRisks(r.risks).slice(0, riskLimit).map((risk) => ({ severity: risk.severity, text: risk.text })),
  });
  const indexed = results.results.map((r, index) => ({ r, index }));
  const chosen = indexed.find(({ r }) => r.key === recommendedKey);
  return {
    object: facilityLabelOf(results.facility),
    recommended: chosen ? scenario(chosen.r, chosen.index, Number.POSITIVE_INFINITY) : null,
    alternatives: indexed.filter((x) => x !== chosen).map(({ r, index }) => scenario(r, index, chosen ? 1 : 3)),
    platformConclusion: { headline: results.conclusion.headline, points: [...results.conclusion.bullets] },
    limitations: [disclaimerOf(results)],
  };
}

/**
 * Ключ рекомендаций: те же факты, модель и версия инструкции — тот же ответ из хранилища, без
 * нового вызова ИИ. Новый расчёт с другими числами даёт другой ключ, и старый ответ — устаревший.
 */
export function adviceFactsHash(facts: AdviceFacts, model: string): string {
  return createHash("sha256").update(`${ADVICE_PROMPT_VERSION}\n${model}\n${JSON.stringify(facts)}`).digest("hex");
}
