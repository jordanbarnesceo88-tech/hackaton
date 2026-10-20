/**
 * Настройки ИИ из переменных окружения сервера: адрес OpenAI-совместимого API, ключ и модель.
 * Переменные без префикса NEXT_PUBLIC_, поэтому в браузер ключ не попадает; модуль импортируют
 * только серверные маршруты и серверные компоненты. Пакет server-only сознательно не
 * подключён: он не установлен, а новая зависимость меняет package-lock.json — часть отпечатка
 * расчётного движка (.gitattributes, «Exact build-worker source graph»).
 *
 * Не задана хотя бы одна переменная — ИИ выключен: кнопка рекомендаций не показывается, CI и
 * тесты в настоящий ИИ не ходят.
 */

export type AiConfig = {
  /** База API, например https://host/api/v1 — к ней добавляется /chat/completions. */
  url: string;
  key: string;
  model: string;
};

export function readAiConfig(env: Readonly<Record<string, string | undefined>> = process.env): AiConfig | null {
  const url = env.AI_API_URL?.trim(), key = env.AI_API_KEY?.trim(), model = env.AI_MODEL?.trim();
  if (!url || !key || !model) return null;
  return { url: url.replace(/\/+$/, ""), key, model };
}
