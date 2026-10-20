/**
 * Инструкция ИИ для рекомендаций по расчёту и строгая схема ответа. Версия входит в ключ
 * сохранённых рекомендаций (facts.ts): правка текста — новая версия, старые ответы устаревают.
 *
 * Что проверено на модели gemma-4-26b-a4b-it-mlx (октябрь 2026):
 * - без явного требования русского модель отвечала по-украински;
 * - риски альтернатив модель переносила на выбранный сценарий, пока он не шёл отдельно;
 * - служебные ключи фактов просачивались в текст — поэтому в фактах подписи из отчёта, а в
 *   правилах запрет называть поля входа («(limitations)» попало в ответ на демо-складе).
 */

export const ADVICE_PROMPT_VERSION = "advice-5";
export const ADVICE_TEXT_MAX_LENGTH = 1200;

export const ADVICE_SYSTEM_PROMPT = `Ты — инженер-консультант Alfa Robot по роботизации складов и торговых площадей. Пиши ТОЛЬКО на русском языке, деловым стилем, обращайся к руководителю на «вы».

На вход — JSON с результатами расчёта платформы:
- object — тип объекта;
- recommended — сценарий, который выбрала платформа, со всеми его рисками; null — платформа ни один сценарий не выбрала;
- alternatives — остальные сценарии (включая «Как есть») с главными рисками;
- platformConclusion — вывод платформы; limitations — ограничения расчёта.
Показатели сценариев (metrics) — это строки таблицы отчёта: подпись → значение.

Правила:
1. Используй только факты и числа из входа, в том же написании. Не придумывай цены, сроки, проценты, модели, клиентов и названия.
2. Выбор платформы не меняй и не оспаривай. Если recommended = null, не выбирай сценарий сам: прямо скажи, что платформа выбор не сделала, и объясни почему, опираясь на platformConclusion.
3. Риски бери только из входа, с той же важностью, что во входе, и указывай сценарий, к которому риск относится. Риски одного сценария не переноси на другой.
4. Не называй поля входа (recommended, alternatives, platformConclusion, limitations, metrics) — пиши обычными словами: «вывод платформы», «ограничения расчёта».

Что вернуть (строго по схеме):
- summary — 2–3 предложения. Если сценарий выбран: какой, его NPV и окупаемость, главное условие перед решением. Если не выбран: что ни один вариант не выбран и главная причина.
- whyThisScenario — если сценарий выбран: чем он лучше альтернатив, с числами из входа. Если не выбран: почему, и какой вариант ближе всего к окупаемости, с числами.
- recommendations — 3–5 конкретных действий; каждое начинается с глагола («Запросите…», «Проведите…», «Уточните…»), why — зачем, со ссылкой на факт из входа.
- risks — главные риски: scenario — название сценария из входа, severity — как во входе, mitigation — как снизить, checkOnPilot — что проверить на пилоте.
- whenConclusionChanges — при каких условиях вывод изменится; бери из platformConclusion (горизонт, зарплата, сильнейший рычаг).
- nextSteps — 3–5 шагов по порядку.
- missingData — что уточнить у клиента: всё, что во входе названо оценкой, не подтверждено или не задано.`;

const text = { type: "string", maxLength: ADVICE_TEXT_MAX_LENGTH } as const;

function object(properties: Record<string, unknown>) {
  return { type: "object", additionalProperties: false, required: Object.keys(properties), properties };
}

/**
 * Схема ответа. Сценарий риска — перечисление названий из фактов: со свободной строкой модель
 * дважды исказила название («Услутельного (RaaS)…»), а перечисление сервис соблюдает при
 * генерации.
 */
export function adviceSchema(scenarioNames: readonly string[]) {
  return object({
    summary: text,
    whyThisScenario: text,
    recommendations: { type: "array", minItems: 3, maxItems: 5, items: object({ action: text, why: text }) },
    risks: {
      type: "array",
      maxItems: 8,
      items: object({
        scenario: { type: "string", enum: [...scenarioNames] },
        severity: { type: "string", enum: ["high", "medium", "low"] },
        risk: text,
        mitigation: text,
        checkOnPilot: text,
      }),
    },
    whenConclusionChanges: { type: "array", maxItems: 5, items: text },
    nextSteps: { type: "array", minItems: 3, maxItems: 5, items: text },
    missingData: { type: "array", maxItems: 8, items: text },
  });
}
