import { parseCleaningProfile } from "./econ/cleaning-profile";
import type { CleaningPlan, CleaningProfile, CleaningZone, ScenarioItem } from "./types";

export const isCleaningProcess = (process: string) => ["cleaning", "terminal-cleaning", "hospital-cleaning"].includes(process);

function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).some(key => !keys.includes(key))) throw new Error("План уборки: неизвестные поля или неверный объект");
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 1000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`План уборки: требуется текст от 1 до ${max} символов`);
  return value.trim();
}
function number(value: unknown, min: number, max: number, integer = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || integer && !Number.isInteger(value)) throw new Error(`План уборки: число от ${min} до ${max}${integer ? ", целое" : ""}`);
  return value;
}
function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`План уборки: список не больше ${max} записей`);
  return value;
}
function unique(ids: string[], label: string) {
  if (new Set(ids).size !== ids.length) throw new Error(`План уборки: повтор ${label}`);
}

export function parseCleaningPlan(value: unknown): CleaningPlan {
  const v = record(value, ["schemaVersion", "source", "disjointAreaReason", "robots", "existingMachines", "zones"]);
  if (v.schemaVersion !== "cleaning-zones-1") throw new Error("Неизвестная версия плана уборки");
  const robots = list(v.robots, 100).map(value => {
    const r = record(value, ["id", "productSlug"]);
    return { id: text(r.id, 80), productSlug: text(r.productSlug, 160) };
  });
  unique(robots.map(r => r.id), "ID физического робота");
  const existingMachines = list(v.existingMachines, 50).map(value => {
    const m = record(value, ["id", "name", "floor", "capacityM2PerDay", "operatorHoursPerDay", "baselineAnnualCostRub", "retainedAnnualCostRub", "source"]);
    if (number(m.capacityM2PerDay, 0, 1e9) > 0 && number(m.operatorHoursPerDay, 0, 24) <= 0) throw new Error("Для выработки существующей машины укажите часы её оператора");
    return { id: text(m.id, 80), name: text(m.name, 160), floor: number(m.floor, -20, 200, true),
      capacityM2PerDay: number(m.capacityM2PerDay, 0, 1e9), baselineAnnualCostRub: number(m.baselineAnnualCostRub, 0, 1e12),
      operatorHoursPerDay: number(m.operatorHoursPerDay, 0, 24),
      retainedAnnualCostRub: number(m.retainedAnnualCostRub, 0, 1e12), source: text(m.source) };
  });
  unique(existingMachines.map(m => m.id), "ID существующей машины");
  const zones: CleaningZone[] = list(v.zones, 30).map(value => {
    const z = record(value, ["id", "name", "floor", "areaM2", "cleaningsPerDay", "windowStartH", "windowH", "baselineLabourHoursPerDay", "retainedLabourHoursPerDay", "manualThroughputM2PerH", "existingMachineIds", "assignments"]);
    const windowStartH = number(z.windowStartH, 0, 24), windowH = number(z.windowH, 1 / 60, 24);
    if (windowStartH + windowH > 24 + 1e-9) throw new Error("План уборки: окно зоны выходит за сутки");
    const assignments = list(z.assignments, 100).map(value => {
      const a = record(value, ["robotId", "profile", "transferMin", "transferLabourMin"]);
      const profile = parseCleaningProfile(a.profile, { deferDailySchedule: true });
      if (Math.abs(profile.windowH - windowH) > 1e-9) throw new Error("План уборки: окно профиля должно совпадать с окном зоны");
      return { robotId: text(a.robotId, 80), profile, transferMin: number(a.transferMin, 0, windowH * 60), transferLabourMin: number(a.transferLabourMin, 0, 1440) };
    });
    unique(assignments.map(a => a.robotId), "робота в зоне");
    const existingMachineIds = list(z.existingMachineIds, 50).map(id => text(id, 80));
    unique(existingMachineIds, "машины в зоне");
    return { id: text(z.id, 80), name: text(z.name, 160), floor: number(z.floor, -20, 200, true), areaM2: number(z.areaM2, .01, 1e9),
      cleaningsPerDay: number(z.cleaningsPerDay, .01, 100), windowStartH, windowH,
      baselineLabourHoursPerDay: number(z.baselineLabourHoursPerDay, 0, 12000), retainedLabourHoursPerDay: number(z.retainedLabourHoursPerDay, 0, 12000),
      manualThroughputM2PerH: z.manualThroughputM2PerH === null ? null : number(z.manualThroughputM2PerH, .01, 1e6), existingMachineIds, assignments };
  });
  if (!zones.length) throw new Error("Добавьте хотя бы одну зону уборки");
  unique(zones.map(z => z.id), "ID зоны");
  const knownRobots = new Set(robots.map(r => r.id)), machineZones = new Set<string>();
  for (const zone of zones) {
    for (const a of zone.assignments) if (!knownRobots.has(a.robotId)) throw new Error(`Неизвестный робот ${a.robotId}`);
    for (const id of zone.existingMachineIds) {
      const machine = existingMachines.find(m => m.id === id);
      if (!machine || machine.floor !== zone.floor) throw new Error("Существующая машина должна быть известна и закреплена на этаже зоны");
      if (machineZones.has(id)) throw new Error("Суточная мощность существующей машины может быть выделена только одной зоне");
      machineZones.add(id);
    }
  }
  for (const robot of robots) if (!zones.some(z => z.assignments.some(a => a.robotId === robot.id))) throw new Error(`Робот ${robot.id} не назначен ни одной зоне`);
  return { schemaVersion: "cleaning-zones-1", robots, existingMachines, zones, source: text(v.source), disjointAreaReason: text(v.disjointAreaReason) };
}

type WorkState = { workRemainingH: number; chargeRemainingH: number };
/** Linear work depletion, a full fixed recharge; no fresh battery at the next zone. */
function operate(state: WorkState, hours: number, profile: CleaningProfile, maxActiveH: number) {
  let active = 0, charging = 0;
  while (hours > 1e-9 && active < maxActiveH - 1e-9) {
    if (state.chargeRemainingH > 1e-9) {
      const t = Math.min(hours, state.chargeRemainingH); hours -= t; state.chargeRemainingH -= t; charging += t;
      if (state.chargeRemainingH <= 1e-9) state.workRemainingH = profile.workBeforeChargeH;
    } else {
      const t = Math.min(hours, state.workRemainingH, maxActiveH - active); active += t; hours -= t; state.workRemainingH -= t;
      if (state.workRemainingH <= 1e-9) state.chargeRemainingH = profile.chargeH;
    }
  }
  return { active, charging };
}

export function evaluateCleaningPlan(value: CleaningPlan, options?: { workDaysPerYear: number; annualHoursPerFte: number; baselineFte: number; items?: readonly ScenarioItem[]; cleaningAreaM2?: number }) {
  const plan = parseCleaningPlan(value);
  const D = options?.workDaysPerYear ?? 1, annual = options?.annualHoursPerFte ?? 1;
  if (!(D > 0 && D <= 366 && annual > 0 && Number.isFinite(annual)) || options && !(Number.isFinite(options.baselineFte) && options.baselineFte >= 0)) throw new Error("План уборки: неверный годовой фонд времени");
  const area = plan.zones.reduce((s,z) => s + z.areaM2, 0);
  if (options?.cleaningAreaM2 !== undefined && Math.abs(area - options.cleaningAreaM2) > 1e-6) throw new Error("Сумма непересекающихся площадей зон должна совпадать с площадью уборки объекта");
  const rows = new Map(plan.zones.map(z => [z.id, { id: z.id, name: z.name, floor: z.floor, demandM2PerDay: z.areaM2 * z.cleaningsPerDay, robotAcceptedM2PerDay: 0, robotHours: 0, careHours: 0, transferLabourHours: 0 }]));
  const acceptedByZone = new Map(plan.zones.map(z => [z.id, new Map<string, number>()]));
  const byProduct = new Map<string, { productSlug: string; fleet: number; activeHoursPerDay: number; chargeHoursPerDay: number; remainingChargeH: number; overnightH: number; careHoursPerDay: number; windowHoursPerDay: number; acceptedM2PerDay: number; demandM2PerDay: number; baselineHoursPerDay: number; releasedHoursPerDay: number }>();
  for (const robot of plan.robots) {
    const assignments = plan.zones.flatMap(zone => zone.assignments.filter(a => a.robotId === robot.id).map(a => ({ zone, ...a }))).sort((a,b) => a.zone.windowStartH-b.zone.windowStartH || a.zone.id.localeCompare(b.zone.id));
    const first = assignments[0]!, profile = first.profile;
    const item = options?.items?.find(i => isCleaningProcess(i.process) && i.productSlug === robot.productSlug);
    if (options?.items && !item) throw new Error(`Нет коммерческой позиции для модели ${robot.productSlug}`);
    let aggregate = byProduct.get(robot.productSlug);
    if (!aggregate) { aggregate = { productSlug: robot.productSlug, fleet: 0, activeHoursPerDay: 0, chargeHoursPerDay: 0, remainingChargeH: 0, overnightH: 24, careHoursPerDay: 0, windowHoursPerDay: 0, acceptedM2PerDay: 0, demandM2PerDay: 0, baselineHoursPerDay: 0, releasedHoursPerDay: 0 }; byProduct.set(robot.productSlug, aggregate); }
    aggregate.fleet++;
    const state = { workRemainingH: profile.workBeforeChargeH, chargeRemainingH: 0 };
    let lastEnd = first.zone.windowStartH, lastFloor = first.zone.floor;
    for (const [index,a] of assignments.entries()) {
      if (a.zone.windowStartH < lastEnd - 1e-9) throw new Error(`Робот ${robot.id}: окна зон пересекаются`);
      if (a.profile.workBeforeChargeH !== profile.workBeforeChargeH || a.profile.chargeH !== profile.chargeH || a.profile.dailyCareMin !== profile.dailyCareMin) throw new Error("У одного физического робота должны совпадать цикл АКБ и ежедневный уход во всех зонах");
      if (index > 0 && a.zone.floor !== lastFloor && a.transferMin <= 0) throw new Error(`Робот ${robot.id}: при смене этажа задайте время переноса`);
      // Gaps are idle, not an unpriced recharge opportunity; transfer is downtime inside the zone.
      const care = index === 0 ? profile.dailyCareMin / 60 : 0;
      const availableH = a.zone.windowH - a.transferMin / 60 - care;
      if (availableH < 0) throw new Error("Перенос и ежедневный уход занимают всё окно зоны");
      const row = rows.get(a.zone.id)!;
      const throughput = a.profile.throughputM2PerH * (item?.automationCoverageOverride ?? 1);
      const { active, charging } = operate(state, availableH, a.profile, throughput > 0 ? Math.max(0, row.demandM2PerDay - row.robotAcceptedM2PerDay) / throughput : 0);
      const accepted = Math.min(Math.max(0, row.demandM2PerDay - row.robotAcceptedM2PerDay), active * throughput);
      row.robotAcceptedM2PerDay += accepted; row.robotHours += active; row.careHours += care; row.transferLabourHours += a.transferLabourMin / 60;
      const productAccepted = acceptedByZone.get(a.zone.id)!;
      productAccepted.set(robot.productSlug, (productAccepted.get(robot.productSlug) ?? 0) + accepted);
      aggregate.activeHoursPerDay += active; aggregate.careHoursPerDay += care; aggregate.windowHoursPerDay += a.zone.windowH;
      aggregate.chargeHoursPerDay += charging;
      aggregate.acceptedM2PerDay += accepted;
      lastEnd = a.zone.windowStartH + a.zone.windowH; lastFloor = a.zone.floor;
    }
    const rechargeH = state.chargeRemainingH > 1e-9 ? state.chargeRemainingH : state.workRemainingH < profile.workBeforeChargeH - 1e-9 ? profile.chargeH : 0;
    if (rechargeH > 24 - lastEnd + first.zone.windowStartH + 1e-9) throw new Error(`Робот ${robot.id}: между днями не хватает времени восстановить полный заряд`);
    aggregate.remainingChargeH = Math.max(aggregate.remainingChargeH, rechargeH);
    aggregate.overnightH = Math.min(aggregate.overnightH, 24 - lastEnd + first.zone.windowStartH);
  }
  const zones = plan.zones.map(zone => {
    const row = rows.get(zone.id)!;
    const machineCapacity = zone.existingMachineIds.reduce((sum,id) => sum + plan.existingMachines.find(m => m.id === id)!.capacityM2PerDay, 0);
    const remaining = Math.max(0, row.demandM2PerDay - row.robotAcceptedM2PerDay);
    const machineCoveredM2PerDay = Math.min(remaining, machineCapacity);
    const manualRequiredM2PerDay = remaining - machineCoveredM2PerDay;
    const machineOperatorHours = zone.existingMachineIds.reduce((sum,id) => sum + plan.existingMachines.find(m => m.id === id)!.operatorHoursPerDay, 0);
    const manualHoursAvailable = Math.max(0, zone.retainedLabourHoursPerDay - row.careHours - row.transferLabourHours - machineOperatorHours);
    const manualCoveredM2PerDay = Math.min(manualRequiredM2PerDay, manualHoursAvailable * (zone.manualThroughputM2PerH ?? 0));
    const uncoveredM2PerDay = Math.max(0, manualRequiredM2PerDay - manualCoveredM2PerDay);
    const careProvided = zone.retainedLabourHoursPerDay + 1e-9 >= row.careHours + row.transferLabourHours + machineOperatorHours;
    const robotShare = row.robotAcceptedM2PerDay / row.demandM2PerDay;
    const share = zone.assignments.length ? Math.min(...zone.assignments.map(a => a.profile.automatableLabourShare)) : 0;
    const releasedHoursPerDay = Math.max(0, Math.min(zone.baselineLabourHoursPerDay - zone.retainedLabourHoursPerDay,
      zone.baselineLabourHoursPerDay * robotShare * share - row.careHours - row.transferLabourHours));
    for (const product of byProduct.values()) {
      const allocations = zone.assignments.filter(a => plan.robots.find(r => r.id === a.robotId)!.productSlug === product.productSlug).length;
      const weight = zone.assignments.length ? allocations / zone.assignments.length : product === byProduct.values().next().value ? 1 : 0;
      const accepted = acceptedByZone.get(zone.id)!.get(product.productSlug) ?? 0;
      const productDemand = accepted + remaining * weight;
      product.releasedHoursPerDay += row.robotAcceptedM2PerDay ? releasedHoursPerDay * accepted / row.robotAcceptedM2PerDay : 0;
      product.baselineHoursPerDay += zone.baselineLabourHoursPerDay * productDemand / row.demandM2PerDay;
      product.demandM2PerDay += productDemand;
    }
    return { ...row, remainingM2PerDay: remaining, machineCoveredM2PerDay, machineOperatorHours, manualCoveredM2PerDay, uncoveredM2PerDay, careProvided,
      manualCapacityKnown: manualRequiredM2PerDay <= 1e-9 || zone.manualThroughputM2PerH !== null, releasedHoursPerDay,
      status: uncoveredM2PerDay <= 1e-8 && careProvided ? "full" as const : "partial" as const };
  });
  const baselineHoursPerDay = plan.zones.reduce((s,z) => s+z.baselineLabourHoursPerDay,0);
  const retainedHoursPerDay = plan.zones.reduce((s,z) => s+z.retainedLabourHoursPerDay,0);
  if (options && Math.max(baselineHoursPerDay, retainedHoursPerDay) * D > options.baselineFte * annual + 1e-6) throw new Error("Труд зон превышает оплаченный годовой фонд существующих уборщиков");
  const products = [...byProduct.values()].map(p => ({ ...p, releasedFte: p.releasedHoursPerDay * D / annual }));
  if (options?.items) for (const item of options.items.filter(i => isCleaningProcess(i.process))) {
    const fleet = products.find(p => p.productSlug === item.productSlug)?.fleet;
    if (!fleet) throw new Error(`Модель ${item.productSlug} не назначена зонам`);
    if (item.quantityOverride !== undefined && item.quantityOverride !== fleet) throw new Error("Количество роботов коммерческой позиции должно совпадать с уникальными ID плана зон");
    if ((item.chargersOverride ?? fleet) < fleet) throw new Error("План уборки требует отдельную зарядку для каждого физического робота");
  }
  return { plan, zones, products, areaM2: area, demandM2PerDay: zones.reduce((s,z) => s+z.demandM2PerDay,0),
    baselineHoursPerDay, releasedFte: products.reduce((s,p) => s+p.releasedFte,0),
    baselineMachineCostRub: plan.existingMachines.reduce((s,m) => s+m.baselineAnnualCostRub,0),
    retainedMachineCostRub: plan.existingMachines.reduce((s,m) => s+m.retainedAnnualCostRub,0),
    status: zones.every(z => z.status === "full") ? "full" as const : "partial" as const };
}

export type CleaningPlanEvaluation = ReturnType<typeof evaluateCleaningPlan>;
