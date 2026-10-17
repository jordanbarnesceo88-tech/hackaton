import type { NormValues } from "../norms";
import type { CostPackage, ProductForCalc, ScenarioItem, ScenarioKind } from "../types";
import { refuse } from "./context";

const KEYS = ["softwareIncludedInIntegration", "repairsIncludedInService", "includedChargers", "reason"] as const;

/** An explicit scenario agreement; published indicative prices do not establish these terms. */
export function parseCostPackage(value: unknown): CostPackage {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Состав ценового пакета должен быть объектом");
  const v = value as Record<string, unknown>;
  if (Object.keys(v).length !== KEYS.length || Object.keys(v).some(key => !KEYS.some(k => k === key))) {
    throw new Error("Укажите все четыре поля состава пакета без дополнительных полей");
  }
  if (typeof v.softwareIncludedInIntegration !== "boolean" || typeof v.repairsIncludedInService !== "boolean") {
    throw new Error("Включённость ПО и ремонта должна быть явно задана: да или нет");
  }
  if (typeof v.includedChargers !== "number" || !Number.isSafeInteger(v.includedChargers) || v.includedChargers < 0 || v.includedChargers > 2000) {
    throw new Error("Число включённых зарядных станций должно быть целым от 0 до 2000");
  }
  if (typeof v.reason !== "string" || !v.reason.trim() || v.reason.length > 1000) {
    throw new Error("Укажите основание состава пакета (до 1000 символов): договор, предложение или явное допущение");
  }
  return { softwareIncludedInIntegration: v.softwareIncludedInIntegration, repairsIncludedInService: v.repairsIncludedInService, includedChargers: v.includedChargers, reason: v.reason.trim() };
}

function packageOf(item: Pick<ScenarioItem, "costPackage">): CostPackage | undefined {
  if (item.costPackage === undefined) return undefined;
  try { return parseCostPackage(item.costPackage); }
  catch (error) { refuse("invalid_inputs", error instanceof Error ? error.message : "Некорректный состав ценового пакета", ["scenario:costPackage"]); }
}

export function costPackageForItem(
  item: Pick<ScenarioItem, "costPackage">,
  context: { kind: ScenarioKind; chargers: number },
): CostPackage | undefined {
  const value = packageOf(item);
  if (!value) return undefined;
  if (context.kind !== "purchase") refuse("invalid_inputs", "Явный ценовой пакет применяется только к покупке; для RaaS задайте договорные условия подписки", ["scenario:costPackage"]);
  if (!Number.isSafeInteger(context.chargers) || context.chargers < 0 || value.includedChargers > context.chargers) {
    refuse("invalid_inputs", `В пакет включено ${value.includedChargers} зарядных станций, но этой позиции требуется ${context.chargers}; исправьте состав пакета`, ["scenario:costPackage"]);
  }
  return value;
}

export function costPackageRepairIncluded(item: Pick<ScenarioItem, "costPackage">, serviceValueRub: number): boolean {
  const value = packageOf(item);
  if (!value?.repairsIncludedInService) return false;
  if (!Number.isFinite(serviceValueRub) || serviceValueRub <= 0) {
    refuse("invalid_inputs", "Ремонт нельзя включить в сервисный пакет без положительной стоимости сервиса; уточните условия пакета", ["scenario:costPackage"]);
  }
  return true;
}

/** A source overlap is a question about scope, not proof of a contractual double charge. */
export function costPackageWarnings(
  product: Pick<ProductForCalc, "slug" | "softwareRubOneTime" | "implementationRub" | "serviceRubYear">,
  item: Pick<ScenarioItem, "costPackage">,
  norms: Pick<NormValues, "repairPctOfPriceYear">,
): string[] {
  if (item.costPackage !== undefined || product.slug !== "ronavi-h1500") return [];
  const warnings: string[] = [];
  if ((product.softwareRubOneTime ?? 0) > 0 && (product.implementationRub ?? 0) > 0) {
    warnings.push("Не уточнено, входит ли лицензия RMS в стоимость внедрения и интеграции: опубликованные ориентиры пересекаются по составу; это риск повторного учёта, а не подтверждённый двойной счёт");
  }
  if ((product.serviceRubYear ?? 0) > 0 && norms.repairPctOfPriceYear > 0) {
    warnings.push("Поддержка в опубликованном ориентире включает ремонт, а модель отдельно считает ремонт вне договора; проверьте исключения и состав сервиса");
  }
  return warnings;
}
