import type { RaasBatteryCharge, RaasCharge, RaasPackage, ScenarioItem, ScenarioKind } from "../types";
import { refuse } from "./context";

export const RAAS_CHARGE_LABELS = {
  startup: "Старт RaaS (интеграция, настройка, обучение)", platform: "Платформа RaaS",
  service: "Сервисное обслуживание", consumables: "Расходные материалы", repair: "Ремонт", battery: "Замена АКБ",
} as const;
type ChargeKey = keyof typeof RAAS_CHARGE_LABELS;
const CHARGES = Object.keys(RAAS_CHARGE_LABELS) as ChargeKey[];
const MONEY_MAX = 1_000_000_000_000;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error("Состав услуги RaaS должен быть JSON-объектом");
  return value as Record<string, unknown>;
}
function money(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > MONEY_MAX) throw new Error("Стоимость RaaS — неотрицательная сумма до 1 трлн ₽");
  return value;
}
function charge(raw: unknown, battery: boolean): RaasCharge | RaasBatteryCharge {
  const v = object(raw);
  if (v.mode === "included" || v.mode === "unassessed") {
    if (Object.keys(v).length !== 1) throw new Error("Включённая или неоценённая статья RaaS не содержит отдельной цены");
    return { mode: v.mode };
  }
  const keys = battery ? ["mode", "amountRub", "basis", "everyYears"] : ["mode", "amountRub", "basis"];
  if (v.mode !== "separate" || Object.keys(v).length !== keys.length || Object.keys(v).some(key => !keys.includes(key)) ||
    (v.basis !== "per-robot" && v.basis !== "per-site")) throw new Error("Для отдельной статьи RaaS укажите цену и базу: за робота или за площадку");
  const result: Extract<RaasCharge, { mode: "separate" }> = { mode: "separate", amountRub: money(v.amountRub), basis: v.basis };
  if (!battery) return result;
  if (!Number.isSafeInteger(v.everyYears) || (v.everyYears as number) < 1 || (v.everyYears as number) > 100) throw new Error("Интервал замены АКБ RaaS — целое число от 1 до 100 лет");
  return { ...result, everyYears: v.everyYears as number };
}

export function parseRaasCharge(raw: unknown): RaasCharge { return charge(raw, false) as RaasCharge; }

/** Structural parsing preserves unknown costs; the calculation refuses an incomplete scope. */
export function parseRaasPackage(raw: unknown): RaasPackage {
  const v = object(raw), allowed = new Set([...CHARGES, "firstMonthRub", "reason"]);
  if (Object.keys(v).some(key => !allowed.has(key))) throw new Error("Неизвестное поле состава услуги RaaS");
  if (typeof v.reason !== "string" || !v.reason.trim() || v.reason.length > 1000) throw new Error("Укажите основание состава RaaS или явную оценку (до 1000 символов)");
  return { startup: charge(v.startup, false), platform: charge(v.platform, false), service: charge(v.service, false),
    consumables: charge(v.consumables, false), repair: charge(v.repair, false), battery: charge(v.battery, true) as RaasBatteryCharge,
    ...(v.firstMonthRub === undefined ? {} : { firstMonthRub: money(v.firstMonthRub) }), reason: v.reason.trim() };
}

export function raasPackageForItem(item: ScenarioItem, kind: ScenarioKind, recurringRub?: number): RaasPackage | undefined {
  if (item.raasPackage === undefined) return undefined;
  const field = [`item:${item.process}:raasPackage`];
  let value: RaasPackage;
  try { value = parseRaasPackage(item.raasPackage); }
  catch (error) { refuse("invalid_inputs", error instanceof Error ? error.message : "Некорректный состав RaaS", field); }
  if (kind !== "raas") refuse("invalid_inputs", "Состав услуги RaaS применим только к сценарию RaaS", field);
  if (item.serviceRubYearOverride !== undefined) refuse("invalid_inputs", "Стоимость сервиса задаётся в составе RaaS, а не одновременно отдельным переопределением", field);
  const missing = CHARGES.filter(key => value[key].mode === "unassessed");
  if (missing.length) refuse("raas_package_incomplete", `Не оценены статьи RaaS: ${missing.map(key => RAAS_CHARGE_LABELS[key]).join(", ")}. Укажите включение или отдельную оценку с основанием; неизвестная стоимость не равна нулю`, field);
  if (recurringRub !== undefined && value.firstMonthRub !== undefined && value.firstMonthRub < recurringRub) {
    refuse("invalid_inputs", "Первый месяц RaaS не может быть дешевле регулярного тарифа: скидки первого месяца этой моделью не поддерживаются", field);
  }
  return value;
}

export function raasChargeAmount(value: RaasCharge | RaasBatteryCharge, fleet: number): number {
  if (value.mode === "unassessed") throw new Error("Неоценённая стоимость RaaS не является нулевой");
  return value.mode === "included" ? 0 : value.amountRub * (value.basis === "per-robot" ? fleet : 1);
}

/** Site charges are shared scope; repeating the same category would silently charge it twice. */
export function validateRaasSiteCharges(items: readonly ScenarioItem[]): void {
  for (const key of CHARGES) {
    const matches = items.filter(item => item.raasPackage?.[key].mode === "separate" && item.raasPackage[key].basis === "per-site");
    if (matches.length > 1) refuse("invalid_inputs", `Статья RaaS «${RAAS_CHARGE_LABELS[key]}» за площадку указана в нескольких позициях. Укажите её один раз, для остальных явно задайте включение`, ["scenario:raasPackage"]);
  }
}

export function raasPackageDescription(value: RaasPackage): string {
  const parts = CHARGES.map(key => {
    const c = value[key], period = key === "platform" ? "₽/мес" : key === "startup" || key === "battery" ? "₽" : "₽/год";
    const cost = c.mode === "included" ? "включено (заявлено в составе)" : c.mode === "unassessed" ? "не оценено"
      : `${c.amountRub} ${period} ${c.basis === "per-robot" ? "за робота" : "за площадку"}${key === "battery" && "everyYears" in c ? ` каждые ${c.everyYears} лет` : ""}`;
    return `${RAAS_CHARGE_LABELS[key]}: ${cost}`;
  });
  return `${value.firstMonthRub === undefined ? "Первый месяц принят равным регулярному тарифу (допущение); " : `Первый месяц: ${value.firstMonthRub} ₽ за робота; превышение регулярного тарифа — один раз в начале; `}${parts.join("; ")}. Основание: ${value.reason}. Это заданный состав услуг, не полный договор поставки и инфраструктуры`;
}
