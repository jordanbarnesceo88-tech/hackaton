import type { ParamValues, ProductForCalc, ScenarioSpec } from "../tz/types";

export const BUSINESS_EXAMPLES = [
  { id: "steady-flow", title: "Регулярный поток", description: "5 роботов на 5 000 м². Сравните покупку и RaaS при заданном сокращении расходов на труд.", lesson: "Проверить выполнение нагрузки и сравнить затраты двух способов внедрения.", inboundPerDay: 500, outboundPerDay: 500, cashShare: 1 },
  { id: "peak-overload", title: "Парк не справляется с пиком", description: "Тот же парк и объект; поступление паллет удвоено. Посмотрите очередь и невыполненную работу.", lesson: "Положительная экономика не подтверждает, что парк выполнит требуемый поток.", inboundPerDay: 1000, outboundPerDay: 1000, cashShare: 1 },
  { id: "retained-staff", title: "Сотрудники остаются в штате", description: "Тот же регулярный поток, но ФОТ не сокращается. Высвобождённое время показано отдельно от денег.", lesson: "Разделить производственный эффект и реальное сокращение расходов.", inboundPerDay: 500, outboundPerDay: 500, cashShare: 0 },
] as const;
export type BusinessExampleId = typeof BUSINESS_EXAMPLES[number]["id"];
export function businessExample(value: unknown) { return BUSINESS_EXAMPLES.find(e => e.id === value) ?? null; }

/** Demonstration assumptions, not a customer case or a guaranteed vendor business case. */
export function businessExampleInputs(id: BusinessExampleId, defaults: ParamValues, products: readonly ProductForCalc[]) {
  const example = businessExample(id);
  if (!example || !products.some(p => p.slug === "ronavi-h1500")) throw new Error("Вход или продукт бизнес-примера недоступен");
  const params: ParamValues = { ...defaults, activeAreaM2: 5000, totalAreaM2: 10000,
    inboundPalletsPerDay: example.inboundPerDay, outboundPalletsPerDay: example.outboundPerDay,
    peakFactor: 1.2, forkliftOperatorsCount: 20, forkliftSalaryRubMonth: 120000 };
  const item = { process: "pallet-transport", productSlug: "ronavi-h1500", quantityOverride: 5, chargersOverride: 2, automationCoverageOverride: 1 };
  const scenarios: ScenarioSpec[] = [
    { key: "asis", name: "Как есть", kind: "asis", items: [] },
    { key: "purchase", name: "Покупка — Ronavi H1500", kind: "purchase", items: [{ ...item }], cashRealizationShare: example.cashShare },
    { key: "raas", name: "Услуга (RaaS) — Ronavi H1500", kind: "raas", items: [{ ...item }], cashRealizationShare: example.cashShare },
  ];
  return { example, params, scenarios, assumption: `Учебный объект: 5 000 м² активной зоны, 20 сотрудников на перемещении паллет, две смены по 11 ч. Парк — 5 роботов и 2 зарядки. Денежная реализация высвобождаемого труда — ${example.cashShare * 100}%. Это явное допущение примера. Цены и остальные нормативы — текущие данные проекта; результат рассчитан, а не задан вручную.` };
}
