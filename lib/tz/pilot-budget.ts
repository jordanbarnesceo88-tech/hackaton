import { horizonOf, normsForSpec } from "./econ/context";
import type { PilotPlanInput, ProductForCalc, ProjectResults } from "./types";

export const PILOT_WORKS = {
  setup: "Развёртывание и настройка",
  integration: "Интеграция с процессом и системами",
  training: "Обучение операторов",
  logistics: "Доставка и обратная логистика",
  sitePreparation: "Подготовка участка, питание и связь",
  evaluation: "Замеры и разбор результатов",
} as const;
export const PILOT_READINESS = {
  sitePlan: "Зафиксированы участок, маршруты, проходы и зоны людей",
  power: "Согласованы питание и места зарядок",
  connectivity: "Проверены связь и доступ к нужным системам",
  access: "Согласованы допуски, окна работ и доступ интегратора",
  baseline: "Снята исходная ручная выработка и трудозатраты",
  responsibility: "Назначены ответственные, оператор и канал эскалации",
  safety: "Согласованы остановка, инциденты и безопасное ограждение",
} as const;
const MONEY_MAX = 1_000_000_000_000;
export type PilotBudgetModel = Pick<ProjectResults, "scenarios" | "results" | "paramsUsed" | "normsUsed" | "productSnapshots">;
type WorkKey = keyof typeof PILOT_WORKS;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error("План пилота должен быть JSON-объектом");
  return value as Record<string, unknown>;
}
function number(value: unknown, min: number, max: number, label: string, integer = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw new Error(`Пилот: неверное значение «${label}»`);
  return value;
}
function nullableMoney(value: unknown, label: string): number | null { return value === null ? null : number(value, 0, MONEY_MAX, label); }
function string(value: unknown, max: number, label: string): string {
  if (typeof value !== "string" || value.length > max) throw new Error(`Пилот: неверное поле «${label}»`);
  return value;
}

/** Strict persisted input: missing costs stay null, an explicit zero requires a source. */
export function parsePilotPlanInput(value: unknown): PilotPlanInput {
  const v = object(value), allowed = new Set(["schemaVersion", "fleet", "chargers", "durationDays", "dayBasis", "acquisition", "costs", "equipmentUnitRubOverride", "chargerBudgetRubOverride", "chargerBudgetSource", "contingencyPct", "targetThroughputPerH", "maxP95WaitMin", "maxInterventionsPerShift", "readiness", "notes"]);
  if (Object.keys(v).some(key => !allowed.has(key)) || v.schemaVersion !== "pilot-plan-1" || !["working", "calendar"].includes(String(v.dayBasis)) || !["purchase", "raas"].includes(String(v.acquisition))) throw new Error("Неподдерживаемый план пилота");
  const rawCosts = object(v.costs);
  if (Object.keys(rawCosts).some(key => !Object.hasOwn(PILOT_WORKS, key))) throw new Error("Неизвестная статья бюджета пилота");
  const costs = {} as PilotPlanInput["costs"];
  for (const key of Object.keys(PILOT_WORKS) as WorkKey[]) {
    const item = object(rawCosts[key]);
    if (Object.keys(item).some(field => !["valueRub", "source"].includes(field))) throw new Error("Неизвестное поле статьи пилота");
    const source = string(item.source, 1000, "источник затрат");
    if (!source.trim()) throw new Error("Укажите источник оценки каждой статьи пилота");
    costs[key] = { valueRub: nullableMoney(item.valueRub, PILOT_WORKS[key]), source };
  }
  if (!Array.isArray(v.readiness) || v.readiness.some(key => typeof key !== "string" || !Object.hasOwn(PILOT_READINESS, key)) || new Set(v.readiness).size !== v.readiness.length) throw new Error("Неверный чек-лист готовности пилота");
  const chargerBudgetRubOverride = v.chargerBudgetRubOverride === undefined ? undefined : nullableMoney(v.chargerBudgetRubOverride, "бюджет зарядок");
  const chargerBudgetSource = v.chargerBudgetSource === undefined ? undefined : string(v.chargerBudgetSource, 1000, "источник стоимости зарядок");
  if (chargerBudgetRubOverride !== undefined && chargerBudgetRubOverride !== null && !chargerBudgetSource?.trim()) throw new Error("Укажите источник ручной оценки зарядок пилота");
  return {
    schemaVersion: "pilot-plan-1", fleet: number(v.fleet, 1, 500, "парк пилота", true), chargers: number(v.chargers, 0, 2000, "зарядки пилота", true),
    durationDays: number(v.durationDays, 1, 365, "длительность", true), dayBasis: v.dayBasis as PilotPlanInput["dayBasis"], acquisition: v.acquisition as PilotPlanInput["acquisition"],
    costs, equipmentUnitRubOverride: nullableMoney(v.equipmentUnitRubOverride, "цена оборудования"), contingencyPct: number(v.contingencyPct, 0, 100, "резерв"),
    targetThroughputPerH: v.targetThroughputPerH === null ? null : number(v.targetThroughputPerH, Number.MIN_VALUE, 1_000_000, "поток участка"),
    maxP95WaitMin: number(v.maxP95WaitMin, 0, 1440, "p95 ожидания"), maxInterventionsPerShift: number(v.maxInterventionsPerShift, 0, 10000, "вмешательства за смену", true),
    readiness: [...v.readiness] as string[], notes: string(v.notes, 4000, "примечание"),
    ...(chargerBudgetRubOverride === undefined ? {} : { chargerBudgetRubOverride }), ...(chargerBudgetSource === undefined ? {} : { chargerBudgetSource }),
  };
}

function selected(model: PilotBudgetModel, scenarioKey: string) {
  const spec = model.scenarios.find(s => s.key === scenarioKey), result = model.results.find(r => r.key === scenarioKey);
  if (!spec || !result || result.status !== "ok" || spec.kind === "asis" || result.items.length !== 1) throw new Error("План пилота доступен для рассчитанного сценария с одним выбранным решением");
  const item = spec.items[0], full = result.items[0], product = item ? model.productSnapshots[item.productSlug] : undefined;
  if (!item || !full || !product || full.n === null || full.n < 1) throw new Error("Для пилота не определены решение и состав оборудования");
  return { spec, result, item, full, product };
}

/** Starting estimates reuse scenario sources; local work and logistics remain explicitly unknown. */
export function defaultPilotPlan(model: PilotBudgetModel, scenarioKey: string, acquisition?: PilotPlanInput["acquisition"]): PilotPlanInput {
  const { spec, result, full } = selected(model, scenarioKey);
  const fleet = Math.min(2, full.n!), norms = normsForSpec({ norms: model.normsUsed }, spec);
  const method = acquisition ?? (spec.kind === "raas" ? "raas" : "purchase");
  const reference = result.kind === method ? result : model.results.find(row => row.kind === method && row.status === "ok" && row.items.length === 1 && row.items[0]?.productSlug === full.productSlug);
  const costs = {} as PilotPlanInput["costs"];
  for (const key of Object.keys(PILOT_WORKS) as WorkKey[]) costs[key] = { valueRub: null, source: "Оценка команды для выбранного участка — пока не задана" };
  if (method === "purchase") costs.setup = { valueRub: fleet * norms.commissioningRubPerUnit, source: `Норматив commissioningRubPerUnit: ${fleet} робота × ${norms.commissioningRubPerUnit} ₽; стартовая оценка настройки пилота, уточнить при изменении состава.` };
  for (const [work, capexKey] of [["setup", "commissioning"], ["integration", "integration"], ["training", "training"]] as const) {
    const line = reference?.status === "ok" ? reference.capexLines.find(l => l.key === capexKey) : undefined;
    if (line?.includedInSubscription) costs[work] = { valueRub: 0, source: `Включено в подписку по допущению сценария «${reference!.name}»: ${line.label}. Подтвердить состав услуги договором.` };
    else if (line && work !== "setup") costs[work] = { valueRub: line.valueRub, source: `Опорная оценка сценария «${line.label}»: ${line.originNote ?? line.origin}. Принята для пилота без уменьшения; подтвердить состав работ и цену.` };
  }
  return { schemaVersion: "pilot-plan-1", fleet, chargers: Math.min(1, full.chargers), durationDays: 10, dayBasis: "working", acquisition: method, costs, equipmentUnitRubOverride: null, contingencyPct: 10, targetThroughputPerH: null, maxP95WaitMin: 10, maxInterventionsPerShift: 1, readiness: [], notes: "Оценочный пилот на ограниченном участке. Состав, срок и условия согласовать с заказчиком и интегратором." };
}

export type PilotBudgetLine = { key: string; label: string; valueRub: number | null; formula: string; source: string; estimate: true };

/** Pilot scope is costed separately; no full-fleet capacity claim is transferred to a smaller park. */
export function buildPilotBudget(model: PilotBudgetModel, scenarioKey: string, input?: PilotPlanInput) {
  const { spec, item, full, product, result } = selected(model, scenarioKey), plan = parsePilotPlanInput(input ?? spec.pilotPlan ?? defaultPilotPlan(model, scenarioKey));
  const norms = normsForSpec({ norms: model.normsUsed }, spec);
  const calendarDays = plan.dayBasis === "calendar" ? plan.durationDays : Math.ceil(plan.durationDays * 7 / 5);
  const subscriptionMonths = Math.max(1, Math.ceil(calendarDays / 30));
  const unit = plan.equipmentUnitRubOverride ?? (plan.acquisition === "purchase" ? item.priceRubOverride ?? product.priceRub : item.raasRubMonthOverride ?? product.raasRubMonth);
  const sourceKey = plan.acquisition === "purchase" ? "priceRub" : "raasRubMonth", source = product.sources.find(s => s.key === sourceKey);
  const scenarioPriceOverride = plan.acquisition === "purchase" ? item.priceRubOverride : item.raasRubMonthOverride;
  const equipmentSource = plan.equipmentUnitRubOverride !== null ? "Ручная оценка цены для пилота; коммерческое предложение не подтверждено" : scenarioPriceOverride !== undefined ? "Цена задана пользователем в исходном сценарии; подтвердить условия поставки" : `${source?.sourceUrl ?? source?.sourceRef ?? "Каталожный снимок"}; ${source?.confirmed ? "значение из источника" : "цена требует подтверждения"}${plan.acquisition === "raas" && product.raasQualifier ? `; ставка ${product.raasQualifier}` : ""}`;
  const reference = result.kind === plan.acquisition ? result : model.results.find(row => row.kind === plan.acquisition && row.status === "ok" && row.items.length === 1 && row.items[0]?.productSlug === full.productSlug);
  const chargerLine = reference?.status === "ok" ? reference.capexLines.find(line => line.key === "chargers") : undefined;
  const chargerOverride = plan.chargerBudgetRubOverride !== undefined && plan.chargerBudgetRubOverride !== null;
  const chargerIncluded = plan.acquisition === "raas" && chargerLine?.includedInSubscription;
  const chargerUnknown = plan.acquisition === "raas" && !chargerLine;
  const chargerCost = chargerOverride ? plan.chargerBudgetRubOverride! : plan.chargers === 0 || chargerIncluded ? 0 : chargerUnknown ? null : plan.chargers * norms.chargerRub;
  const chargerSource = chargerOverride ? plan.chargerBudgetSource! : chargerIncluded ? `Включено в подписку по допущению сценария «${reference!.name}»; подтвердить договором` : chargerUnknown ? "Неизвестно, включены ли зарядки в выбранную услугу RaaS; задайте оценку и источник" : "Общий норматив chargerRub финансовой модели; отдельная оценка поставки";
  const lines: PilotBudgetLine[] = [
    { key: "equipment", label: plan.acquisition === "purchase" ? "Покупка оборудования пилота" : "Подписка RaaS на пилот", valueRub: unit === null ? null : plan.fleet * unit * (plan.acquisition === "raas" ? subscriptionMonths : 1), formula: plan.acquisition === "raas" ? `${plan.fleet} × ${unit ?? "цена неизвестна"} ₽/мес × ${subscriptionMonths} мес (без дневной пропорции)` : `${plan.fleet} × ${unit ?? "цена неизвестна"} ₽`, source: equipmentSource, estimate: true },
    { key: "chargers", label: "Зарядные станции пилота", valueRub: chargerCost, formula: chargerOverride ? "Фиксированный бюджет зарядок пилота, задано вами" : chargerIncluded ? `${plan.chargers} зарядок в составе подписки, доплата 0 ₽` : `${plan.chargers} × ${norms.chargerRub} ₽`, source: chargerSource, estimate: true },
    ...(Object.keys(PILOT_WORKS) as WorkKey[]).map(key => ({ key, label: PILOT_WORKS[key], valueRub: plan.costs[key].valueRub, formula: "Фиксированная оценка работ на участке пилота", source: plan.costs[key].source, estimate: true as const })),
  ];
  const knownSubtotalRub = lines.reduce((sum, line) => sum + (line.valueRub ?? 0), 0), unknowns = lines.filter(line => line.valueRub === null).map(line => line.label);
  const reserveRub = unknowns.length ? null : knownSubtotalRub * plan.contingencyPct / 100;
  const totalRub = reserveRub === null ? null : knownSubtotalRub + reserveRub;
  const { H, T } = horizonOf({ params: model.paramsUsed }, norms);
  const residualRub = spec.terminalResidualRub ?? 0;
  return {
    scenarioKey, scenarioName: spec.name, productName: product.name, product, plan, fullFleet: full.n!, fullChargers: full.chargers,
    calendarDays, subscriptionMonths, lines, knownSubtotalRub, unknowns, reserveRub, totalRub,
    readiness: Object.entries(PILOT_READINESS).map(([key, label]) => ({ key, label, ready: plan.readiness.includes(key) })),
    criteria: [plan.targetThroughputPerH === null ? "До старта согласовать измеримый поток именно участка пилота; цель полного парка не перенесена." : `На участке завершать не меньше ${plan.targetThroughputPerH} операций/ч при составе ${plan.fleet} роботов.`, `p95 ожидания до начала обработки ≤ ${plan.maxP95WaitMin} мин; для стеллажей включает ожидание связанной подачи носителя.`, `Ручных вмешательств за смену ≤ ${plan.maxInterventionsPerShift}; учитывать причину и длительность.`, "Зафиксировать остановки, инциденты, доступность зарядки и фактическое время цикла; результаты сравнить с ручной базой."],
    residual: { valueRub: residualRub, year: T, financialHorizonYears: H, includedInNpv: H >= T, note: "Ручная оценка чистой суммы реализации собственных активов после налогов, демонтажа и вывоза; цена продажи не подтверждена. Не входит в бюджет пилота." },
    warning: plan.fleet === full.n ? "Состав пилота совпадает с полным парком; условия участка всё равно требуется проверить отдельно." : `Пилот: ${plan.fleet} роботов, полный сценарий: ${full.n}. Выполнение нагрузки полного парка не доказано уменьшенным составом.`,
    quoteNote: "Смета оценочная, не коммерческое предложение. Неизвестные статьи не равны нулю. Для короткого RaaS-пилота предполагается отдельное соглашение с оплатой целыми месяцами; согласие поставщика и включённые услуги нужно подтвердить. Годовой договор полного внедрения автоматически не сокращается до срока пилота.",
    financialStatus: result.risks.some(r => ["SIM_NOT_CONFIRMED", "SPATIAL_STALE"].includes(r.code)) ? "Сценарий имеет ограничения проверки нагрузки; пилот предназначен для измерения и уточнения условий." : "Модельный результат не заменяет приёмку пилота на объекте.",
  };
}

export function pilotProductSource(product: ProductForCalc) { return product.sources.filter(s => ["priceRub", "raasRubMonth", "serviceRubYear", "manufacturer", "countryOfOrigin", "country"].includes(s.key)); }
