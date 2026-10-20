"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { evaluateCleaningPlan, isCleaningProcess, parseCleaningPlan } from "@/lib/tz/cleaning-zones";
import type { CleaningPlan, CleaningProfile, CleaningZone, ProductForCalc, ScenarioItem } from "@/lib/tz/types";
import { formatNum } from "@/lib/format/rub";
import { stableJson } from "@/lib/tz/version";
import { CleaningProfileEditor } from "./cleaning-profile";

export type CleaningZonesEditorProps = {
  value?: CleaningPlan;
  items: readonly ScenarioItem[];
  products: readonly ProductForCalc[];
  kind: "purchase" | "raas";
  readOnly?: boolean;
  evaluationOptions?: Parameters<typeof evaluateCleaningPlan>[1];
  onApply?: (value: { plan: CleaningPlan; items: ScenarioItem[] }) => void;
};

const emptyPlan = (): CleaningPlan => ({ schemaVersion: "cleaning-zones-1", source: "", disjointAreaReason: "", robots: [], existingMachines: [], zones: [] });
const maintenanceSource = "Изменяемая оценка Екатерины от 19.10.2026: содержание одной существующей машины 40 000 ₽/мес; подтвердить состав расходов. Труд оператора задаётся отдельно.";
function nextId(prefix: string, ids: string[]) { let n = 1; while (ids.includes(`${prefix}-${n}`)) n++; return `${prefix}-${n}`; }

/** Commercial quotes belong to distinct products, not to their repeated zone assignments. */
export function cleaningPlanItems(plan: CleaningPlan, items: readonly ScenarioItem[]): ScenarioItem[] {
  const process = items.find(i => isCleaningProcess(i.process))?.process ?? "cleaning";
  return [...items.filter(i => !isCleaningProcess(i.process)), ...[...new Set(plan.robots.map(r => r.productSlug))].map(productSlug => {
    const old = items.find(i => isCleaningProcess(i.process) && i.productSlug === productSlug);
    const fleet = plan.robots.filter(r => r.productSlug === productSlug).length;
    return { ...(old ?? { process, productSlug }), quantityOverride: fleet, chargersOverride: Math.max(fleet, old?.chargersOverride ?? 0) };
  })];
}

function Numeric({ label, value, onChange, min = 0, max = 1e12 }: { label: string; value: number | null; onChange: (value: number) => void; min?: number; max?: number }) {
  return <label className="grid min-w-0 gap-1 text-sm">{label}<input className="field min-h-11 w-full min-w-0" type="number" step="any" min={min} max={max} value={value !== null && Number.isFinite(value) ? value : ""} onChange={e => onChange(e.target.value.trim() ? Number(e.target.value) : NaN)} /></label>;
}

function AssignmentProfile({ profile, onChange }: { profile: CleaningProfile; onChange?: (profile: CleaningProfile) => void }) {
  if (!onChange) return <div className="grid gap-1 text-sm"><p>{formatNum(profile.throughputM2PerH,2)} м²/активный ч; работа {profile.workBeforeChargeH} ч / зарядка {profile.chargeH} ч; окно зоны {profile.windowH} ч.</p><p>Ежедневный уход {profile.dailyCareMin} мин, один раз на физический ID; роботизируемая доля труда {profile.automatableLabourShare * 100}%.</p><p>{profile.mode}; {profile.source}, {profile.date}. {profile.reason}</p></div>;
  return <div className="grid min-w-0 gap-3 sm:grid-cols-2">
    {([['throughputM2PerH','Выработка в этой зоне, м²/активный ч',.01,1e6],['workBeforeChargeH','Работа до зарядки, ч',1/60,24],['chargeH','Полная зарядка, ч',1/60,24],['dailyCareMin','Ежедневный уход один раз на ID, мин',0,1440],['automatableLabourShare','Доля роботизируемого труда, 0–1',0,1]] as const).map(([key,label,min,max])=><Numeric key={key} label={label} value={profile[key]} min={min} max={max} onChange={v=>onChange({...profile,[key]:v})}/>)}
    <p className="text-xs text-muted-foreground">Окно {profile.windowH} ч берётся из зоны. Заряд и единственный ежедневный уход считаются общим расписанием ID; отдельное назначение не начинает новый день с полной АКБ.</p>
    {(['mode','source','reason','date'] as const).map(key=><label key={key} className="grid min-w-0 gap-1 text-sm">{({mode:'Режим и покрытие',source:'Источник профиля зоны',reason:'Условия и допущения профиля зоны',date:'Дата оценки'})[key]}<input className="field min-h-11 w-full min-w-0" type={key==='date'?'date':'text'} maxLength={key==='mode'?100:key==='date'?10:1000} value={profile[key]} onChange={e=>onChange({...profile,[key]:e.target.value})}/></label>)}
  </div>;
}

export function CleaningZonesEditor(props: CleaningZonesEditorProps) {
  return <ZoneForm key={stableJson(props.value ?? null)} {...props} />;
}

function ZoneForm({ value, items, products, kind, readOnly, onApply, evaluationOptions }: CleaningZonesEditorProps) {
  const [plan, setPlan] = useState<CleaningPlan>(() => structuredClone(value ?? emptyPlan()));
  const [quotes, setQuotes] = useState<ScenarioItem[]>(() => structuredClone([...items]));
  const [message, setMessage] = useState("");
  const editable = !readOnly && Boolean(onApply);
  const modelItems = cleaningPlanItems(plan, quotes);
  let preview: ReturnType<typeof evaluateCleaningPlan> | null = null, issue = "";
  try { preview = evaluateCleaningPlan(plan, evaluationOptions ? { ...evaluationOptions, items: modelItems } : undefined); }
  catch (error) { issue = error instanceof Error ? error.message : "Проверьте план зон"; }
  function update(next: CleaningPlan) { setPlan(next); setMessage(""); }
  function zone(index: number, changes: Partial<CleaningZone>) { update({ ...plan, zones: plan.zones.map((z,i) => i === index ? { ...z, ...changes, ...(changes.windowH === undefined ? {} : {assignments:z.assignments.map(a=>({...a,profile:{...a.profile,windowH:changes.windowH!}}))}) } : z) }); }
  function quote(productSlug: string, changes: Partial<ScenarioItem>) {
    const next = cleaningPlanItems(plan, quotes).map(i => i.productSlug === productSlug && isCleaningProcess(i.process) ? { ...i, ...changes } : i);
    setQuotes(next); setMessage("");
  }
  const field = (label: string, content: string, onChange: (value: string) => void, maxLength = 1000) => <label className="grid min-w-0 gap-1 text-sm">{label}<input className="field min-h-11 w-full min-w-0" maxLength={maxLength} value={content} onChange={e => onChange(e.target.value)} /></label>;
  return <section data-cleaning-zones className="grid min-w-0 gap-4 border-t pt-4">
    <h4 className="font-semibold">Смешанный план уборки по этажам и зонам</h4>
    <p className="text-sm text-muted-foreground">Зоны — непересекающиеся площади. Повторные уборки увеличивают работу, а один ID робота означает одну оплачиваемую машину во всех зонах. Это прогноз по заданным профилям, не подтверждение качества, безопасности или работы лифта.</p>
    {!editable && !value ? <p>План зон не задан.</p> : null}
    {editable ? <>
      {field("Источник и условия плана", plan.source, source => update({ ...plan, source }))}
      {field("Основание отсутствия пересечений площадей", plan.disjointAreaReason, disjointAreaReason => update({ ...plan, disjointAreaReason }))}
      <div className="grid gap-3"><h5 className="text-sm font-semibold">Физические роботы — ID и модель</h5>
        {plan.robots.map((r,index) => <div key={index} className="grid gap-2 border-t pt-3 sm:grid-cols-3">
          {field("ID физического робота", r.id, id => update({ ...plan, robots: plan.robots.map((x,i) => i === index ? { ...x,id } : x), zones: plan.zones.map(z => ({ ...z, assignments: z.assignments.map(a => a.robotId === r.id ? { ...a,robotId:id } : a) })) }),80)}
          <label className="grid gap-1 text-sm">Модель<select className="field min-h-11" value={r.productSlug} onChange={e => { update({ ...plan, robots: plan.robots.map((x,i) => i === index ? { ...x,productSlug:e.target.value } : x), zones:plan.zones.map(z=>({...z,assignments:z.assignments.filter(a=>a.robotId!==r.id)})) }); setMessage("Модель изменена. Заново назначьте робот зонам с профилем выбранной модели; прежняя выработка не перенесена."); }}><option value="">Выберите модель</option>{products.filter(p => p.handlingClass === "cleaner").map(p => <option key={p.slug} value={p.slug}>{p.name}</option>)}</select></label>
          <Button type="button" variant="ghost" onClick={() => update({ ...plan, robots: plan.robots.filter((_,i) => i !== index), zones: plan.zones.map(z => ({ ...z, assignments:z.assignments.filter(a => a.robotId !== r.id) })) })}>Убрать робота</Button>
        </div>)}
        <Button type="button" variant="outline" disabled={plan.robots.length >= 100} onClick={() => update({ ...plan, robots:[...plan.robots,{id:nextId("robot",plan.robots.map(r=>r.id)),productSlug:""}] })}>Добавить физического робота</Button>
      </div>
      {modelItems.filter(i => isCleaningProcess(i.process) && i.productSlug).map(item => <div key={item.productSlug} className="grid gap-3 border-t pt-3">
        <h5 className="text-sm font-semibold">{products.find(p=>p.slug===item.productSlug)?.name ?? item.productSlug}: условия модели, один раз на парк</h5>
        <p className="text-xs text-muted-foreground">Без корректировки используется цена из снимка каталога; неизвестная цена не заменяется оценкой. Состав поставки и услуг сохранён из коммерческой позиции; перенос в другую зону его не умножает.</p>
        <Numeric label={kind === "purchase" ? "Явная цена одного робота, ₽" : "Явная ставка RaaS за робота в месяц, ₽"} value={(kind === "purchase" ? item.priceRubOverride : item.raasRubMonthOverride) ?? null} onChange={v => quote(item.productSlug,kind === "purchase" ? {priceRubOverride:Number.isFinite(v)?v:undefined} : {raasRubMonthOverride:Number.isFinite(v)?v:undefined,raasFromEstimate:undefined})} min={.01} />
        {kind === "purchase" && <Numeric label="Явный сервис за робота в год, ₽" value={item.serviceRubYearOverride ?? null} onChange={v=>quote(item.productSlug,{serviceRubYearOverride:Number.isFinite(v)?v:undefined})} />}
        <p className="text-xs">Профиль для новых назначений этой модели. В каждой зоне профиль можно уточнить отдельно.</p>
        <CleaningProfileEditor productSlug={item.productSlug} value={item.cleaningProfile} onChange={cleaningProfile=>quote(item.productSlug,{cleaningProfile})} />
      </div>)}
      <h5 className="text-sm font-semibold">Зоны и назначения</h5>
      {plan.zones.map((z,index) => <fieldset key={index} className="grid min-w-0 gap-3 border p-3"><legend className="px-1 text-sm font-medium">{z.name || `Новая зона ${index+1}`}</legend>
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          {field("Название зоны",z.name,name=>zone(index,{name}),160)}
          {([['floor','Этаж',-20,200],['areaM2','Непересекающаяся площадь, м²',.01,1e9],['cleaningsPerDay','Уборок в день',.01,100],['windowStartH','Начало окна, час суток',0,24],['windowH','Окно, ч',1/60,24],['baselineLabourHoursPerDay','Исходный труд людей, ч/день',0,12000],['retainedLabourHoursPerDay','Оставшийся труд людей, ч/день, включая уход и операторов',0,12000],['manualThroughputM2PerH','Выработка оставшейся ручной уборки, м²/ч',.01,1e6]] as const).map(([key,label,min,max]) => <Numeric key={key} label={label} min={min} max={max} value={z[key]} onChange={v=>zone(index,{[key]:key==='manualThroughputM2PerH'&&!Number.isFinite(v)?null:v})} />)}
        </div>
        <p className="text-xs text-muted-foreground">Суммарные часы людей проверяются по оплаченному годовому фонду. Уход, переносы и операторы существующих машин занимают оставшиеся часы до ручной уборки.</p>
        {plan.robots.filter(r=>r.productSlug).map(r => { const a=z.assignments.find(a=>a.robotId===r.id); return <div key={r.id} className="grid min-w-0 gap-2 border-t pt-2">
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(a)} onChange={e=>{
            if(!e.target.checked) {zone(index,{assignments:z.assignments.filter(a=>a.robotId!==r.id)});return;}
            const profile=quotes.find(i=>i.productSlug===r.productSlug)?.cleaningProfile;
            if(!profile){setMessage(`Сначала примените явный профиль модели ${r.productSlug} для новых назначений.`);return;}
            zone(index,{assignments:[...z.assignments,{robotId:r.id,profile:{...profile,windowH:z.windowH},transferMin:0,transferLabourMin:0}]});
          }} />Назначить {r.id} ({products.find(p=>p.slug===r.productSlug)?.name ?? r.productSlug})</label>
          {a && <><Numeric label="Перенос/переезд перед этой зоной внутри окна, мин" value={a.transferMin} onChange={v=>zone(index,{assignments:z.assignments.map(x=>x.robotId===r.id?{...x,transferMin:v}:x)})} max={1440}/><Numeric label="Труд людей на перенос, мин" value={a.transferLabourMin} onChange={v=>zone(index,{assignments:z.assignments.map(x=>x.robotId===r.id?{...x,transferLabourMin:v}:x)})} max={1440}/><AssignmentProfile profile={a.profile} onChange={profile=>zone(index,{assignments:z.assignments.map(x=>x.robotId===r.id?{...x,profile}:x)})} /></>}
        </div>; })}
        {plan.existingMachines.map(m=><label key={m.id} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={z.existingMachineIds.includes(m.id)} onChange={e=>zone(index,{existingMachineIds:e.target.checked?[...z.existingMachineIds,m.id]:z.existingMachineIds.filter(id=>id!==m.id)})}/>Существующая машина {m.name || m.id}, этаж {m.floor}</label>)}
        <Button type="button" variant="ghost" onClick={()=>update({...plan,zones:plan.zones.filter((_,i)=>i!==index)})}>Убрать зону</Button>
      </fieldset>)}
      <Button type="button" variant="outline" disabled={plan.zones.length>=30} onClick={()=>update({...plan,zones:[...plan.zones,{id:nextId('zone',plan.zones.map(z=>z.id)),name:'',floor:1,areaM2:NaN,cleaningsPerDay:1,windowStartH:0,windowH:8,baselineLabourHoursPerDay:NaN,retainedLabourHoursPerDay:NaN,manualThroughputM2PerH:null,existingMachineIds:[],assignments:[]}]})}>Добавить непересекающуюся зону</Button>
      <h5 className="text-sm font-semibold">Существующие машины и операторы</h5>
      {plan.existingMachines.map((m,index)=><div key={index} className="grid gap-3 border-t pt-3 sm:grid-cols-2">
        {field("Название существующей машины",m.name,name=>update({...plan,existingMachines:plan.existingMachines.map((x,i)=>i===index?{...x,name}:x)}),160)}
        {([['floor','Этаж машины',-20,200],['capacityM2PerDay','Явная выработка машины, м²/день',0,1e9],['operatorHoursPerDay','Часы оператора в день',0,24]] as const).map(([key,label,min,max])=><Numeric key={key} label={label} value={m[key]} min={min} max={max} onChange={v=>update({...plan,existingMachines:plan.existingMachines.map((x,i)=>i===index?{...x,[key]:v}:x)})}/>)}
        {(['baselineAnnualCostRub','retainedAnnualCostRub'] as const).map(key=><Numeric key={key} label={key==='baselineAnnualCostRub'?'Исходное содержание машины, ₽/мес':'Оставшееся содержание машины, ₽/мес'} value={m[key]/12} onChange={v=>update({...plan,existingMachines:plan.existingMachines.map((x,i)=>i===index?{...x,[key]:v*12}:x)})}/>)}
        <p className="text-xs">Годовые затраты: {m.baselineAnnualCostRub} ₽ исходно; {m.retainedAnnualCostRub} ₽ после внедрения. Месячная оценка × 12, одна машина = один ID.</p>
        {field("Источник выработки, операторов и затрат машины",m.source,source=>update({...plan,existingMachines:plan.existingMachines.map((x,i)=>i===index?{...x,source}:x)}))}
        <Button type="button" variant="ghost" onClick={()=>update({...plan,existingMachines:plan.existingMachines.filter((_,i)=>i!==index),zones:plan.zones.map(z=>({...z,existingMachineIds:z.existingMachineIds.filter(id=>id!==m.id)}))})}>Убрать существующую машину</Button>
      </div>)}
      <Button type="button" variant="outline" disabled={plan.existingMachines.length>=50} onClick={()=>update({...plan,existingMachines:[...plan.existingMachines,{id:nextId('machine',plan.existingMachines.map(m=>m.id)),name:'',floor:1,capacityM2PerDay:NaN,operatorHoursPerDay:NaN,baselineAnnualCostRub:40000*12,retainedAnnualCostRub:40000*12,source:maintenanceSource}]})}>Добавить существующую машину — оценка содержания 40 000 ₽/мес</Button>
    </> : value && <><p>{value.source}</p><p>Непересекающиеся площади: {value.disjointAreaReason}</p><ul>{value.robots.map(r=><li key={r.id}>{r.id}: {products.find(p=>p.slug===r.productSlug)?.name ?? r.productSlug}</li>)}</ul>{value.zones.map(z=><div key={z.id} className="grid gap-1 border-t pt-2"><strong>{z.name}, этаж {z.floor}</strong><p>{z.areaM2} м² × {z.cleaningsPerDay}; окно {z.windowStartH}–{z.windowStartH+z.windowH} ч. Люди: {z.baselineLabourHoursPerDay} → {z.retainedLabourHoursPerDay} ч/день; ручная выработка {z.manualThroughputM2PerH ?? 'неизвестна'} м²/ч.</p>{z.assignments.map(a=><div key={a.robotId}><p>{a.robotId}; перенос {a.transferMin} мин, труд переноса {a.transferLabourMin} мин.</p><AssignmentProfile profile={a.profile} /></div>)}</div>)}{value.existingMachines.map(m=><p key={m.id}>{m.name} ({m.id}), этаж {m.floor}: {m.capacityM2PerDay} м²/день; оператор {m.operatorHoursPerDay} ч/день; содержание {m.baselineAnnualCostRub/12} → {m.retainedAnnualCostRub/12} ₽/мес × 12 = {m.baselineAnnualCostRub} → {m.retainedAnnualCostRub} ₽/год. {m.source}</p>)}</>}
    {preview && <div data-cleaning-zones-preview className="grid gap-2 text-sm"><p>Прогноз: {preview.status==='full'?'все зоны покрыты':'есть непокрытая работа или необеспеченный труд'}. Уникальных роботов: {plan.robots.length}; площадь {preview.areaM2} м²; проходов {preview.demandM2PerDay} м²/день.</p>{preview.zones.map(z=><p key={z.id}>{z.name}, этаж {z.floor}: роботы {z.robotAcceptedM2PerDay.toFixed(1)}, существующие машины {z.machineCoveredM2PerDay.toFixed(1)}, люди {z.manualCoveredM2PerDay.toFixed(1)}, дефицит {z.uncoveredM2PerDay.toFixed(1)} м²/день.{!z.manualCapacityKnown&&' Ручная выработка неизвестна.'}{!z.careProvided&&' Не хватает часов операторов, ухода или переносов.'}</p>)}</div>}
    {issue && <p role="alert" className="text-sm text-destructive">{issue}</p>}
    {message && <p role="status" className="text-sm">{message}</p>}
    {editable && <Button type="button" variant="outline" onClick={()=>{try{const accepted=parseCleaningPlan(plan),acceptedItems=cleaningPlanItems(accepted,quotes);evaluateCleaningPlan(accepted,evaluationOptions?{...evaluationOptions,items:acceptedItems}:undefined);onApply?.({plan:accepted,items:acceptedItems});setMessage('План зон и условия моделей применены. Пересчитайте и сохраните проект.');}catch(error){setMessage(error instanceof Error?error.message:'Проверьте план зон');}}}>Применить план зон и состав моделей</Button>}
  </section>;
}
