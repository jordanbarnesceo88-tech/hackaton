import type { AdviceFacts, AdviceRisk, AdviceScenarioFacts, AdviceSeverity } from "./types";

/**
 * Проверка фактов, которые прислал браузер гостя (app/demo/ai-advice/route.ts): форма, длины и
 * число пунктов ограничены; состав объединяет профиль уборки, RaaS и условия площадки.
 * Его источники/основания имеют собственные доменные пределы до 1000 символов. Состав также
 * объединяет условия эксплуатации и доставки; риск/пункт вывода повторяет профиль с двумя
 * полями происхождения. Для этих составных текстов пределы отдельные, без обрезки.
 * Общий размер JSON дополнительно ограничен маршрутом до 64 КБ.
 */

const LIMITS = {
  short: 160,
  text: 2048,
  composition: 10 * 1024,
  risk: 4096,
  point: 4096,
  scenarios: 10,
  metrics: 20,
  risks: 30,
  points: 16,
  limitations: 4,
} as const;

const SEVERITIES: ReadonlySet<string> = new Set<AdviceSeverity>(["high", "medium", "low"]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function onlyKeys(v: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(v).every((k) => keys.includes(k));
}

function text(v: unknown, max: number): v is string {
  return typeof v === "string" && v.trim().length > 0 && v.length <= max;
}

function texts(v: unknown, maxItems: number, maxLength: number): v is string[] {
  return Array.isArray(v) && v.length <= maxItems && v.every((s) => text(s, maxLength));
}

function risk(v: unknown): v is AdviceRisk {
  return isRecord(v) && onlyKeys(v, ["severity", "text"]) && typeof v.severity === "string" && SEVERITIES.has(v.severity) && text(v.text, LIMITS.risk);
}

function scenario(v: unknown): v is AdviceScenarioFacts {
  if (!isRecord(v) || !onlyKeys(v, ["name", "kind", "metrics", "risks"])) return false;
  if (!text(v.name, LIMITS.short) || !text(v.kind, LIMITS.short) || !isRecord(v.metrics)) return false;
  const metrics = Object.entries(v.metrics);
  if (metrics.length > LIMITS.metrics || !metrics.every(([k, m]) => text(k, LIMITS.short) && text(m, k === "Состав оборудования" ? LIMITS.composition : LIMITS.text))) return false;
  return Array.isArray(v.risks) && v.risks.length <= LIMITS.risks && v.risks.every(risk);
}

export function parseAdviceFacts(v: unknown): AdviceFacts | null {
  if (!isRecord(v) || !onlyKeys(v, ["object", "recommended", "alternatives", "platformConclusion", "limitations"])) return null;
  if (!text(v.object, LIMITS.short)) return null;
  if (v.recommended !== null && !scenario(v.recommended)) return null;
  if (!Array.isArray(v.alternatives) || v.alternatives.length === 0 || v.alternatives.length > LIMITS.scenarios || !v.alternatives.every(scenario)) return null;
  const conclusion = v.platformConclusion;
  if (!isRecord(conclusion) || !onlyKeys(conclusion, ["headline", "points"]) || !text(conclusion.headline, LIMITS.text) || !texts(conclusion.points, LIMITS.points, LIMITS.point)) return null;
  if (!texts(v.limitations, LIMITS.limitations, LIMITS.text)) return null;
  const names = [...(v.recommended ? [v.recommended.name] : []), ...v.alternatives.map((a) => a.name)];
  if (new Set(names).size !== names.length) return null;
  return v as AdviceFacts;
}
