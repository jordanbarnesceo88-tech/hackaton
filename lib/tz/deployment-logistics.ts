import type { DeploymentLogistics } from "./types";

/** Delivery is an explicit quote/estimate for the whole deployment, never a per-robot default. */
export function parseDeploymentLogistics(value: unknown): DeploymentLogistics {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Условия доставки должны быть объектом");
  const raw = value as Record<string, unknown>;
  const keys = raw.mode === "separate" ? ["mode", "costRub", "source"] : ["mode", "source"];
  if (raw.mode !== "separate" && raw.mode !== "included") throw new Error("Выберите отдельную доставку или включение в цену по документу");
  if (Object.keys(raw).length !== keys.length || Object.keys(raw).some(key => !keys.includes(key))) throw new Error("Укажите только поля выбранных условий доставки");
  if (typeof raw.source !== "string" || !raw.source.trim() || raw.source.length > 1000) throw new Error("Укажите источник или явное обоснование доставки (до 1000 символов)");
  if (raw.mode === "included") return { mode: "included", source: raw.source.trim() };
  if (typeof raw.costRub !== "number" || !Number.isFinite(raw.costRub) || raw.costRub < 0 || raw.costRub > 1e12) throw new Error("Доставка должна быть неотрицательной разовой суммой до 1 трлн ₽");
  return { mode: "separate", costRub: raw.costRub, source: raw.source.trim() };
}

export function deploymentLogisticsText(value: DeploymentLogistics | undefined): string {
  if (!value) return "Доставка полного внедрения не оценена и не включена в CAPEX. Резерв непредвиденных расходов не подтверждает её стоимость; запросите условия поставки.";
  return value.mode === "included"
    ? `Доставка полного внедрения включена в уже учтённую цену оборудования или подписки; отдельный платёж не добавляется. Основание: ${value.source}`
    : `Разовая доставка полного внедрения: ${value.costRub.toLocaleString("ru-RU")} ₽ на весь сценарий. Основание: ${value.source}. На эту статью распространяется общий резерв CAPEX; смета пилота считается отдельно.`;
}
