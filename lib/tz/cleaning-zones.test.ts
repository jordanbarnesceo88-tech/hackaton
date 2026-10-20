import { describe, expect, it } from "vitest";
import { evaluateCleaningPlan, parseCleaningPlan } from "./cleaning-zones";
import type { CleaningPlan, ScenarioSpec, ScenarioOk } from "./types";
import { cleaningContext, TEST_CLEANER, TEST_CLEANING_PROFILE } from "./econ/cleaning-fixtures";
import { computeScenariosCore } from "./econ/core";

const profile = { ...TEST_CLEANING_PROFILE, workBeforeChargeH: 8, chargeH: 1, windowH: 2 };
function plan(): CleaningPlan {
  return { schemaVersion: "cleaning-zones-1", source: "Измерительные допущения теста", disjointAreaReason: "Два разных помещения, площади не пересекаются", robots: [{ id: "r1", productSlug: TEST_CLEANER.slug }], existingMachines: [],
    zones: [0,1].map(i => ({ id: `z${i}`, name: `Зона ${i}`, floor: 1, areaM2: 400, cleaningsPerDay: 1, windowStartH: i * 3, windowH: 2, baselineLabourHoursPerDay: 4, retainedLabourHoursPerDay: 2, manualThroughputM2PerH: 200, existingMachineIds: [], assignments: [{ robotId: "r1", profile: { ...profile }, transferMin: 0, transferLabourMin: 0 }] })) };
}
const options = { workDaysPerYear: 365, annualHoursPerFte: 1973, baselineFte: 4, cleaningAreaM2: 800 };
function calculate(p = plan(), modify?: (spec: ScenarioSpec, ctx: ReturnType<typeof cleaningContext>) => void) {
  const ctx = cleaningContext(); ctx.products = structuredClone(ctx.products); ctx.params.cleaningAreaM2 = 800;
  const spec: ScenarioSpec = { key: "zones", name: "Смешанный план", kind: "purchase", cleaningPlan: p,
    items: [...new Set(p.robots.map(r => r.productSlug))].map(productSlug => ({ process: "cleaning", productSlug })) };
  modify?.(spec, ctx);
  return computeScenariosCore(ctx, [{ key: "asis", name: "Как есть", kind: "asis", items: [] }, spec]);
}

describe("bounded cleaning zones with shared physical resources", () => {
  it("counts one physical robot once across sequential zones, care once and unique floor area separately from passes", () => {
    const p = plan(), before = structuredClone(p), result = evaluateCleaningPlan(p, options);
    expect(result.status).toBe("full"); expect(result.products[0]!.fleet).toBe(1);
    expect(result.products[0]!.careHoursPerDay).toBe(.25);
    expect(result.zones.map(z => z.robotAcceptedM2PerDay)).toEqual([400,400]);
    expect(result.releasedFte).toBeCloseTo(3.75 * 365 / 1973);
    expect(p).toEqual(before);
    p.zones[1]!.cleaningsPerDay = 3;
    const repeated = evaluateCleaningPlan(p, options);
    expect(repeated.areaM2).toBe(800); expect(repeated.demandM2PerDay).toBe(1600);
  });
  it("carries battery state into the next zone instead of granting a fresh charge per zone", () => {
    const p = plan(); p.zones.forEach(z => { z.retainedLabourHoursPerDay = .25; z.manualThroughputM2PerH = null; z.assignments[0]!.profile = { ...profile, workBeforeChargeH: 2, chargeH: 2 }; });
    p.zones[0]!.areaM2 = 962.5;
    const result = evaluateCleaningPlan(p, { ...options, cleaningAreaM2: 1362.5 });
    expect(result.zones[1]!.robotAcceptedM2PerDay).toBeCloseTo(137.5);
    expect(result.zones[1]!.uncoveredM2PerDay).toBeCloseTo(262.5);
    expect(result.status).toBe("partial");
  });
  it("does not charge daily care again or reject a shorter later window that can be served on the carried battery", () => {
    const p=plan();p.zones[1]!.windowH=1/6;p.zones[1]!.areaM2=50;p.zones[1]!.assignments[0]!.profile={...profile,windowH:1/6};
    const result=evaluateCleaningPlan(p,{...options,cleaningAreaM2:450});
    expect(result.status).toBe('full');expect(result.zones[1]!.robotAcceptedM2PerDay).toBe(50);expect(result.zones[1]!.careHours).toBe(0);
    expect(result.products[0]!.careHoursPerDay).toBe(.25);
    p.zones[0]!.windowH=1/6;p.zones[0]!.assignments[0]!.profile={...profile,windowH:1/6};
    expect(()=>evaluateCleaningPlan(p)).toThrow(/уход занимают всё окно/);
  });
  it("rejects double bookings, duplicate IDs, free floor transfers and unsupported overnight restoration", () => {
    const overlap = plan(); overlap.zones[1]!.windowStartH = 1;
    expect(() => evaluateCleaningPlan(overlap)).toThrow(/пересекаются/);
    const floor = plan(); floor.zones[1]!.floor = 2;
    expect(() => evaluateCleaningPlan(floor)).toThrow(/переноса/);
    floor.zones[1]!.assignments[0]!.transferMin = 30;
    floor.zones[1]!.assignments[0]!.transferLabourMin = 15;
    floor.zones.forEach(z => { z.areaM2 = 1100; });
    const moved = evaluateCleaningPlan(floor);
    expect(moved.products[0]!.activeHoursPerDay).toBe(3.25);
    const duplicate = plan(); duplicate.robots.push({ ...duplicate.robots[0]! });
    expect(() => parseCleaningPlan(duplicate)).toThrow(/повтор/);
    const overnight = plan(); overnight.zones = [{ ...overnight.zones[0]!, windowH: 24, assignments: [{ ...overnight.zones[0]!.assignments[0]!, profile: { ...profile, windowH: 24 } }] }];
    expect(() => evaluateCleaningPlan(overnight)).toThrow(/заряд/);
  });
  it("requires paid operator hours for existing-machine capacity and never duplicates its daily capacity or yearly costs", () => {
    const p = plan(); p.existingMachines.push({ id: "m1", name: "Существующая машина", floor: 1, capacityM2PerDay: 400, operatorHoursPerDay: 1, baselineAnnualCostRub: 480000, retainedAnnualCostRub: 480000, source: "Явная оценка 40000 ₽/мес × 12" });
    p.zones[1]!.assignments = []; p.zones[1]!.existingMachineIds = ["m1"];
    const result = evaluateCleaningPlan(p, options);
    expect(result.status).toBe("full"); expect(result.zones[1]!.machineCoveredM2PerDay).toBe(400);
    expect(result.baselineMachineCostRub).toBe(480000); expect(result.retainedMachineCostRub).toBe(480000);
    p.zones[1]!.retainedLabourHoursPerDay = 0;
    expect(evaluateCleaningPlan(p, options).status).toBe("partial");
    p.zones[0]!.existingMachineIds = ["m1"];
    expect(() => evaluateCleaningPlan(p)).toThrow(/только одной зоне/);
  });
  it("refuses invented area, unpaid baseline hours, unknown commercial items and excess bounded records", () => {
    expect(() => evaluateCleaningPlan(plan(), { ...options, cleaningAreaM2: 900 })).toThrow(/площадей/);
    expect(() => evaluateCleaningPlan(plan(), { ...options, baselineFte: .1 })).toThrow(/фонд/);
    expect(() => evaluateCleaningPlan(plan(), { ...options, items: [] })).toThrow(/коммерческой/);
    const p = plan(); p.zones = Array.from({length:31}, (_,i) => ({...p.zones[0]!,id:String(i)}));
    expect(() => parseCleaningPlan(p)).toThrow(/30/);
    const many = plan(); many.robots = Array.from({length:101}, (_,i) => ({id:String(i),productSlug:TEST_CLEANER.slug}));
    expect(() => parseCleaningPlan(many)).toThrow(/100/);
  });
});

describe("zoned cleaning financial integration", () => {
  it("requires a residual-value basis in direct calculation and retains it in the cashflow trace", () => {
    expect(calculate(plan(),s=>{s.terminalResidualRub=100000;})[1]).toMatchObject({status:'refused',refusal:{reason:'invalid_inputs',fields:['scenario:terminalResidualSource']}});
    const row=calculate(plan(),s=>{s.terminalResidualRub=100000;s.terminalResidualSource='Явная оценка чистой продажи собственных активов после налогов и вывоза';})[1] as ScenarioOk;
    expect(row.status).toBe('ok');expect(row.trace.find(t=>t.key==='terminalResidual')!.substituted).toContain('Явная оценка чистой продажи собственных активов');
  });
  it("keeps per-product coverage within one when the first of two models completes their shared zone", () => {
    const p=plan();p.zones=[p.zones[0]!];p.zones[0]!.areaM2=800;p.robots.push({id:'idle',productSlug:'second-cleaner'});p.zones[0]!.assignments.push({...p.zones[0]!.assignments[0]!,robotId:'idle'});
    const rows=calculate(p,(_,ctx)=>{ctx.products['second-cleaner']={...TEST_CLEANER,slug:'second-cleaner'};});const row=rows[1] as ScenarioOk;
    expect(row.status).toBe('ok');expect(row.items.every(i=>i.coverage<=1&&i.coverage>=0&&i.remainingLabourRub>=0)).toBe(true);
    expect(row.items[0]!.coverage).toBe(1);expect(row.items[1]!.releasedFte).toBe(0);
    expect(row.items.reduce((s,i)=>s+i.demandPerDay,0)).toBe(800);
  });
  it("prices the unique fleet once and allocates the same baseline payroll across two real products", () => {
    const one = calculate()[1] as ScenarioOk;
    expect(one.status).toBe("ok"); expect(one.items[0]!.n).toBe(1);
    const p = plan(); p.robots.push({ id: "r2", productSlug: "second-cleaner" }); p.zones[1]!.assignments[0]!.robotId = "r2";
    const rows = calculate(p, (_,ctx) => { ctx.products['second-cleaner'] = { ...TEST_CLEANER, slug: "second-cleaner", name: "Другая машина" }; });
    const row = rows[1] as ScenarioOk;
    expect(row.status).toBe("ok"); expect(row.items.map(i => i.n)).toEqual([1,1]);
    expect(row.items.reduce((s,i) => s+i.headcount,0)).toBe(4);
    expect(row.items.reduce((s,i) => s+i.baselineLabourRub,0)).toBe((rows[0] as ScenarioOk).opexYearRub);
    expect(row.items.reduce((s,i) => s+i.releasedFte,0)).toBeCloseTo(3.5 * 365 / 1973);
    expect(row.trace.filter(t => t.key.startsWith('cleaningZone:'))).toHaveLength(2);
    const noCash = calculate(p,(s,ctx) => { s.cashRealizationShare=0; ctx.products['second-cleaner']={...TEST_CLEANER,slug:'second-cleaner'}; })[1] as ScenarioOk;
    expect(noCash.items.reduce((s,i) => s+i.remainingLabourRub,0)).toBe((rows[0] as ScenarioOk).opexYearRub);
  });
  it("keeps existing machines in both baseline and scenario and refuses missing real prices or residual labor productivity", () => {
    const p = plan(); p.existingMachines.push({ id:'m',name:'Машина',floor:1,capacityM2PerDay:100,operatorHoursPerDay:1,baselineAnnualCostRub:480000,retainedAnnualCostRub:240000,source:'Явная оценка' });
    const rows=calculate(p);expect(rows.every(r=>r.status==='ok')).toBe(true);
    expect((rows[0] as ScenarioOk).opexLines.find(l=>l.key==='existingMachines')!.valueRub).toBe(480000);
    expect((rows[1] as ScenarioOk).opexLines.find(l=>l.key==='existingMachines')!.valueRub).toBe(240000);
    expect(calculate(plan(),(_,ctx)=>{ctx.products[TEST_CLEANER.slug]!.priceRub=null;})[1]).toMatchObject({status:'refused',refusal:{reason:'price_required'}});
    const unknown=plan();unknown.zones[1]!.areaM2=40000;unknown.zones[0]!.areaM2=400;unknown.zones[1]!.manualThroughputM2PerH=null;
    expect(calculate(unknown,(_,ctx)=>{ctx.params.cleaningAreaM2=40400;})[1]).toMatchObject({status:'refused',refusal:{reason:'throughput_required'}});
  });
  it("retains the shared existing-machine baseline cost in a non-plan alternative without granting it a free saving", () => {
    const ctx=cleaningContext();ctx.params.cleaningAreaM2=800;
    const alternative:ScenarioSpec={key:'plain',name:'Обычный рабочий профиль',kind:'purchase',items:[{process:'cleaning',productSlug:TEST_CLEANER.slug,cleaningProfile:TEST_CLEANING_PROFILE}]};
    const asis:ScenarioSpec={key:'asis',name:'Как есть',kind:'asis',items:[]};
    const alone=computeScenariosCore(ctx,[asis,alternative])[1] as ScenarioOk;
    const p=plan();p.existingMachines.push({id:'m',name:'Оплачиваемая существующая машина',floor:1,capacityM2PerDay:100,operatorHoursPerDay:1,baselineAnnualCostRub:480000,retainedAnnualCostRub:240000,source:'40000 ₽/мес исходно; сохранение 20000 ₽/мес после внедрения — явные оценки'});
    const zoned:ScenarioSpec={key:'zoned',name:'Зонный вариант',kind:'purchase',cleaningPlan:p,items:[{process:'cleaning',productSlug:TEST_CLEANER.slug}]};
    const rows=computeScenariosCore(ctx,[asis,zoned,alternative]);const plain=rows[2] as ScenarioOk;
    expect(rows.every(r=>r.status==='ok'),JSON.stringify(rows.map(r=>r.status==='refused'?r.refusal:r.status))).toBe(true);
    expect((rows[0] as ScenarioOk).opexLines.find(l=>l.key==='existingMachines')!.valueRub).toBe(480000);
    expect(plain.opexLines.find(l=>l.key==='existingMachines')!.valueRub).toBe(480000);
    expect(plain.effectYearRub).toBeCloseTo(alone.effectYearRub,6);expect(plain.npvRub).toBeCloseTo(alone.npvRub!,6);
    expect((rows[1] as ScenarioOk).opexLines.find(l=>l.key==='existingMachines')!.valueRub).toBe(240000);
    const incompatible=structuredClone(zoned);incompatible.key='different-baseline';incompatible.cleaningPlan!.existingMachines[0]!.baselineAnnualCostRub=400000;
    expect(computeScenariosCore(ctx,[asis,zoned,incompatible]).every(r=>r.status==='refused')).toBe(true);
  });
});
