import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CleaningZonesEditor, cleaningPlanItems } from "./cleaning-zones";
import { TEST_CLEANER, TEST_CLEANING_PROFILE } from "@/lib/tz/econ/cleaning-fixtures";
import type { CleaningPlan, ScenarioItem } from "@/lib/tz/types";

const plan: CleaningPlan = { schemaVersion:'cleaning-zones-1',source:'Явная оценка объекта',disjointAreaReason:'Разные комнаты на плане',robots:[{id:'robot-1',productSlug:TEST_CLEANER.slug}],existingMachines:[],zones:[{id:'zone-1',name:'Первый этаж',floor:1,areaM2:1000,cleaningsPerDay:1,windowStartH:8,windowH:8,baselineLabourHoursPerDay:8,retainedLabourHoursPerDay:4,manualThroughputM2PerH:null,existingMachineIds:[],assignments:[{robotId:'robot-1',profile:TEST_CLEANING_PROFILE,transferMin:0,transferLabourMin:0}]}] };

describe('cleaning-zone editor and quote handoff',()=>{
  it('preserves every real product quote and package once while deduplicating shared robot assignments',()=>{
    const p=structuredClone(plan);p.zones.push({...p.zones[0]!,id:'other',windowStartH:16});p.robots.push({id:'robot-2',productSlug:'second'});
    const items:ScenarioItem[]=[{process:'cleaning',productSlug:TEST_CLEANER.slug,priceRubOverride:123456,serviceRubYearOverride:500,quantityOverride:8,costPackage:{softwareIncludedInIntegration:true,repairsIncludedInService:false,includedChargers:0,reason:'Точные условия'}},{process:'cleaning',productSlug:'second',raasRubMonthOverride:9876},{process:'pallet-transport',productSlug:'transport'}];
    const before=structuredClone(items),result=cleaningPlanItems(p,items);
    expect(result).toHaveLength(3);expect(result.find(i=>i.productSlug===TEST_CLEANER.slug)).toMatchObject({...items[0],quantityOverride:1,chargersOverride:1});
    expect(result.find(i=>i.productSlug==='second')).toMatchObject({raasRubMonthOverride:9876,quantityOverride:1});expect(items).toEqual(before);
    p.robots.push({id:'robot-3',productSlug:'unknown-price'});
    const added=cleaningPlanItems(p,items).find(i=>i.productSlug==='unknown-price')!;
    expect(added).not.toHaveProperty('priceRubOverride');expect(added).not.toHaveProperty('raasRubMonthOverride');
  });
  it('starts without invented floor areas, prices or productivity and does not apply by rendering',()=>{
    const onApply=vi.fn();const html=renderToStaticMarkup(createElement(CleaningZonesEditor,{items:[],products:[TEST_CLEANER],kind:'purchase',onApply}));
    expect(html).toContain('Добавить непересекающуюся зону');expect(html).toContain('Добавить физического робота');
    expect(html).toContain('40 000 ₽/мес');expect(html).not.toContain('value="40000"');expect(html).not.toContain('value="550"');
    expect(html).toContain('Применить план зон и состав моделей');expect(onApply).not.toHaveBeenCalled();
  });
  it('renders accepted floor allocations, manual work and full sources read-only, with actual coverage forecast',()=>{
    const p=structuredClone(plan);p.existingMachines=[{id:'machine-1',name:'Существующая машина',floor:1,capacityM2PerDay:100,operatorHoursPerDay:1,baselineAnnualCostRub:480000,retainedAnnualCostRub:240000,source:'40 000 ₽/мес × 12, явная оценка Екатерины19.10'}];
    const html=renderToStaticMarkup(createElement(CleaningZonesEditor,{value:p,items:[{process:'cleaning',productSlug:TEST_CLEANER.slug}],products:[TEST_CLEANER],kind:'purchase',readOnly:true,onApply:vi.fn()}));
    for(const value of ['Первый этаж','этаж 1','robot-1','Существующая машина','480000','240000','Явная оценка объекта','Разные комнаты на плане','все зоны покрыты','550,00'])expect(html).toContain(value);
    expect(html).not.toContain('<input');expect(html).not.toContain('<button');expect(html).not.toContain('<form');
  });
  it('shows partial rather than claiming full coverage for residual work with unknown manual productivity',()=>{
    const p=structuredClone(plan);p.zones[0]!.areaM2=10000;
    const html=renderToStaticMarkup(createElement(CleaningZonesEditor,{value:p,items:[],products:[TEST_CLEANER],kind:'purchase',readOnly:true}));
    expect(html).toContain('есть непокрытая работа');expect(html).toContain('Ручная выработка неизвестна');expect(html).toContain('дефицит 7800.0');
  });
  it('renders a short later zone as part of one robot day rather than a second standalone care window',()=>{
    const p=structuredClone(plan);p.zones[0]!.areaM2=400;p.zones[0]!.windowH=2;p.zones[0]!.assignments[0]!.profile={...TEST_CLEANING_PROFILE,workBeforeChargeH:8,chargeH:1,windowH:2};
    p.zones.push({...p.zones[0]!,id:'short',name:'Короткая зона',areaM2:50,windowStartH:12,windowH:1/6,assignments:[{...p.zones[0]!.assignments[0]!,profile:{...p.zones[0]!.assignments[0]!.profile,windowH:1/6}}]});
    const html=renderToStaticMarkup(createElement(CleaningZonesEditor,{value:p,items:[],products:[TEST_CLEANER],kind:'purchase',readOnly:true}));
    expect(html).toContain('все зоны покрыты');expect(html).toContain('Короткая зона');expect(html).not.toContain('уход занимает всё рабочее окно');
    expect(html).toContain('один раз на физический ID');
  });
});
