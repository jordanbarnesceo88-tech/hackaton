import type { AdviceFacts, AdviceSeverity, AiAdviceContent } from "./types";

/**
 * Проверка ответа ИИ до показа: форма по схеме (сервис обещает strict, но ответ всё равно чужой
 * текст) и числа. Каждое число ответа должно встречаться в фактах — так ИИ не может «досчитать»
 * NPV или придумать срок. Числа разбираются по русской записи: группы по три цифры через пробел,
 * дробная часть через запятую («38 500 000 ₽», «4,1 г.»); иначе «AMR 1500 2 200 000 ₽» слипалось
 * в одно число (ложная тревога на первом прогоне).
 */

/** Предел длины одной строки и числа пунктов списка — чтобы чужой текст не ломал вёрстку. */
const MAX_TEXT = 1200;
const MAX_ITEMS = 8;

const SEVERITIES: ReadonlySet<string> = new Set<AdviceSeverity>(["high", "medium", "low"]);

export type ParsedAdvice = { ok: true; content: AiAdviceContent } | { ok: false; reason: string };

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, MAX_TEXT) : null;
}

function strings(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out = v.map(str);
  return out.every((s): s is string => s !== null) ? out.slice(0, MAX_ITEMS) : null;
}

function records<T>(v: unknown, read: (item: Record<string, unknown>) => T | null): T[] | null {
  if (!Array.isArray(v)) return null;
  const out = v.map((item) => (item && typeof item === "object" ? read(item as Record<string, unknown>) : null));
  return out.every((x): x is T => x !== null) ? out.slice(0, MAX_ITEMS) : null;
}

/** Названия сценариев из фактов — допустимые значения поля «сценарий» у риска. */
export function adviceScenarioNames(facts: AdviceFacts): string[] {
  return [...(facts.recommended ? [facts.recommended.name] : []), ...facts.alternatives.map((a) => a.name)];
}

/**
 * Ответ ИИ → проверенное содержимое. Риск с неизвестным сценарием отбрасывается, а не валит
 * весь ответ: остальной текст от этого не становится неверным.
 */
export function parseAdvice(raw: string, scenarioNames: readonly string[]): ParsedAdvice {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "ответ не JSON" };
  }
  if (!data || typeof data !== "object") return { ok: false, reason: "ответ не объект" };
  const d = data as Record<string, unknown>;
  const summary = str(d.summary), whyThisScenario = str(d.whyThisScenario);
  const recommendations = records(d.recommendations, (r) => {
    const action = str(r.action), why = str(r.why);
    return action && why ? { action, why } : null;
  });
  const known = new Set(scenarioNames);
  const risks = records(d.risks, (r) => {
    const scenario = str(r.scenario), risk = str(r.risk), mitigation = str(r.mitigation), checkOnPilot = str(r.checkOnPilot);
    const severity = typeof r.severity === "string" && SEVERITIES.has(r.severity) ? (r.severity as AdviceSeverity) : null;
    return scenario && severity && risk && mitigation && checkOnPilot ? { scenario, severity, risk, mitigation, checkOnPilot } : null;
  });
  const whenConclusionChanges = strings(d.whenConclusionChanges), nextSteps = strings(d.nextSteps), missingData = strings(d.missingData);
  if (!summary || !whyThisScenario || !recommendations?.length || !risks || !whenConclusionChanges || !nextSteps?.length || !missingData) {
    return { ok: false, reason: "ответ не по схеме" };
  }
  const knownRisks = risks.filter((r) => known.has(r.scenario));
  return { ok: true, content: { summary, whyThisScenario, recommendations, risks: knownRisks, whenConclusionChanges, nextSteps, missingData } };
}

/** Число в русской записи: «38 500 000», «4,1», «−4,1», «132,5». Знак отбрасывается — его сверяет смысл, не число. */
const NUMBER = /\d{1,3}(?:[   ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?/g;

export function numbersIn(text: string): number[] {
  return [...text.matchAll(NUMBER)]
    .map((m) => Number(m[0].replace(/[   ]/g, "").replace(",", ".")))
    .filter(Number.isFinite);
}

/** Весь текст ответа одной строкой. */
export function adviceText(content: AiAdviceContent): string {
  return [
    content.summary,
    content.whyThisScenario,
    ...content.recommendations.flatMap((r) => [r.action, r.why]),
    ...content.risks.flatMap((r) => [r.scenario, r.risk, r.mitigation, r.checkOnPilot]),
    ...content.whenConclusionChanges,
    ...content.nextSteps,
    ...content.missingData,
  ].join("\n");
}

/**
 * Числа ответа, которых нет в фактах. Малые целые (до 5) не проверяются: это счёт пунктов и
 * шагов, а не данные расчёта.
 */
export function unknownNumbers(content: AiAdviceContent, facts: AdviceFacts): number[] {
  const known = new Set(numbersIn(JSON.stringify(facts)));
  const unknown = new Set<number>();
  for (const n of numbersIn(adviceText(content))) {
    if (Number.isInteger(n) && n <= 5) continue;
    if (!known.has(n)) unknown.add(n);
  }
  return [...unknown];
}
