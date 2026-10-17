"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNum, formatRub } from "@/lib/format/rub";
import { pluralRu } from "@/lib/format/plural";
import { buildPilotBudget, defaultPilotPlan, parsePilotPlanInput, PILOT_READINESS, PILOT_WORKS, pilotProductSource, type PilotBudgetModel } from "@/lib/tz/pilot-budget";
import type { PilotPlanInput } from "@/lib/tz/types";

type Props = {
  model: PilotBudgetModel;
  scenarioKey: string;
  readOnly?: boolean;
  onChange?: (value: { pilotPlan: PilotPlanInput; terminalResidualRub: number }) => void;
};
type Budget = ReturnType<typeof buildPilotBudget>;
type WorkKey = keyof typeof PILOT_WORKS;

export function PilotBudgetReadout({ budget }: { budget: Budget }) {
  const country = budget.product.sources.find(source => source.key === "countryOfOrigin") ?? budget.product.sources.find(source => source.key === "country");
  return <div className="grid min-w-0 gap-4" data-pilot-budget={budget.totalRub === null ? "partial" : "complete"}>
    <p className="text-sm"><strong>{budget.plan.fleet} {pluralRu(budget.plan.fleet,["робот","робота","роботов"])} · {budget.plan.chargers} {pluralRu(budget.plan.chargers,["зарядка","зарядки","зарядок"])} · {budget.plan.durationDays} {budget.plan.dayBasis === "working" ? "рабочих" : "календарных"} дней</strong>. {budget.plan.dayBasis === "working" && <>Для подписки принято около {budget.calendarDays} календарных дней, без учёта праздников. </>}{budget.plan.acquisition === "raas" ? `Оплата RaaS: ${budget.subscriptionMonths} полных мес., дневной пропорции нет.` : "Оборудование приобретается в собственность; после пилота остаётся у заказчика."}</p>
    <p className="callout text-sm" data-tone="info">{budget.warning} {budget.financialStatus}</p>
    <div className="max-w-full overflow-x-auto"><table className="print-table w-full text-left text-sm"><caption className="sr-only">Оценочный бюджет пилота с источниками</caption><thead><tr><th className="py-2 pr-3">Статья</th><th className="py-2 pr-3">Оценка</th><th className="py-2">Основание</th></tr></thead><tbody>{budget.lines.map(line => <tr key={line.key} className="border-t border-border align-top"><th className="py-2 pr-3 font-normal">{line.label}</th><td className="py-2 pr-3 tabular-nums">{line.valueRub === null ? "Не определено" : formatRub(line.valueRub)}</td><td className="max-w-xl break-words py-2 text-xs text-muted-foreground">{line.formula}. {line.source}</td></tr>)}</tbody></table></div>
    <dl className="grid gap-3 text-sm sm:grid-cols-3"><div><dt className="text-muted-foreground">Известная часть сметы</dt><dd className="m-0 font-semibold">{formatRub(budget.knownSubtotalRub)}</dd></div><div><dt className="text-muted-foreground">Резерв {formatNum(budget.plan.contingencyPct)}%</dt><dd className="m-0">{budget.reserveRub === null ? "После заполнения всех статей" : formatRub(budget.reserveRub)}</dd></div><div><dt className="text-muted-foreground">Полный бюджет пилота</dt><dd className="m-0 font-semibold">{budget.totalRub === null ? "Не определён" : formatRub(budget.totalRub)}</dd></div></dl>
    {budget.unknowns.length > 0 && <p className="text-sm">Не определены: {budget.unknowns.join(", ")}. Введите оценку и источник; если статья включена в договор, явно задайте 0 и укажите это основание.</p>}
    <p className="text-xs text-muted-foreground">{budget.quoteNote}</p>
    <section className="grid gap-2 text-sm"><h4 className="font-semibold">Измеримые критерии приёмки участка</h4><ul className="list-disc space-y-1 pl-5">{budget.criteria.map(text => <li key={text}>{text}</li>)}</ul></section>
    <section className="grid gap-2 text-sm"><h4 className="font-semibold">Подготовка к запуску: {budget.readiness.filter(r => r.ready).length} из {budget.readiness.length}</h4><ul className="list-disc space-y-1 pl-5">{budget.readiness.map(r => <li key={r.key}>{r.ready ? "Готово" : "Нужно подготовить"}: {r.label}</li>)}</ul></section>
    <p className="text-sm"><strong>Остаточная стоимость сценария после {budget.residual.year} лет: {formatRub(budget.residual.valueRub)}.</strong> {budget.residual.valueRub === 0 ? "Остаточная стоимость исключена из денежного потока и NPV." : budget.residual.includedInNpv ? "Входит в последний денежный поток и NPV выбранного горизонта." : `Не входит в NPV за ${budget.residual.financialHorizonYears} лет: поступление находится за его горизонтом.`} {budget.residual.note}</p>
    {budget.plan.notes && <p className="whitespace-pre-line break-words text-sm">{budget.plan.notes}</p>}
    <details className="min-w-0 text-sm"><summary className="cursor-pointer py-2 font-semibold">Происхождение решения и условия обслуживания</summary><p className="mt-2">{budget.productName}. Производитель: {budget.product.manufacturer ?? "не указан в источнике"}. Страна происхождения по каталожному источнику: {country ? `${country.value}${country.confirmed ? "" : " (требует подтверждения)"}` : "не указана; уточнить у поставщика"}. Сервис: {budget.product.serviceRubYear === null ? "стоимость не опубликована; нужен договор обслуживания" : `${formatRub(budget.product.serviceRubYear)} в год по каталожному снимку, условия подтвердить`}.</p><p className="mt-2">Местный сервис, срок поставки, запчасти и логистика должны быть согласованы для объекта. Логистика вынесена в отдельную статью сметы.</p><ul className="mt-2 list-disc space-y-1 break-all pl-5 text-xs text-muted-foreground">{pilotProductSource(budget.product).map((source,i) => <li key={i}>{source.label}: {source.value}; {source.sourceUrl ?? source.sourceRef ?? source.origin}{source.date ? `; дата источника ${source.date}` : ""}{source.confirmed ? "" : "; требует подтверждения"}.</li>)}</ul></details>
  </div>;
}

export function PilotPlan(props: Props) {
  const spec = props.model.scenarios.find(s => s.key === props.scenarioKey);
  let initial: PilotPlanInput;
  try { initial = spec?.pilotPlan ?? defaultPilotPlan(props.model, props.scenarioKey); }
  catch (error) { return <Card><CardHeader><CardTitle as="h3">План пилота и бюджет</CardTitle></CardHeader><CardContent><p className="text-sm text-muted-foreground">{error instanceof Error ? error.message : "Выберите рассчитанное решение для подготовки пилота."}</p></CardContent></Card>; }
  return <PilotEditor key={`${props.scenarioKey}:${JSON.stringify(spec?.pilotPlan)}:${spec?.terminalResidualRub ?? 0}`} {...props} initial={initial} initialResidual={spec?.terminalResidualRub ?? 0} saved={Boolean(spec?.pilotPlan)} />;
}

function PilotEditor({ model, scenarioKey, readOnly = false, onChange, initial, initialResidual, saved }: Props & { initial: PilotPlanInput; initialResidual: number; saved: boolean }) {
  const [draft, setDraft] = useState(() => structuredClone(initial)), [residual, setResidual] = useState(initialResidual), [message, setMessage] = useState("");
  let budget: Budget | null = null, inputError = "";
  try { budget = buildPilotBudget({ ...model, scenarios: model.scenarios.map(spec => spec.key === scenarioKey ? { ...spec, terminalResidualRub: Number.isFinite(residual) && residual >= 0 ? residual : initialResidual } : spec) }, scenarioKey, draft); } catch (error) { inputError = error instanceof Error ? error.message : "Проверьте параметры пилота"; }
  const field = (label: string, value: number | null, change: (next: number | null) => void, options: { min?: number; max?: number; integer?: boolean; nullable?: boolean; unit?: string } = {}) => <label className="grid min-w-0 gap-1 text-sm">{label}{options.unit ? `, ${options.unit}` : ""}<input className="min-h-11 w-full rounded border bg-background px-3" type="number" min={options.min ?? 0} max={options.max ?? 1_000_000_000_000} step={options.integer ? 1 : "any"} required={!options.nullable} placeholder={options.nullable ? "Не определено" : undefined} value={value === null || Number.isNaN(value) ? "" : value} onChange={e => change(e.target.value === "" && options.nullable ? null : e.target.valueAsNumber)} /></label>;
  const update = <K extends keyof PilotPlanInput>(key: K, value: PilotPlanInput[K]) => setDraft(previous => ({ ...previous, [key]: value }));
  return <Card className="min-w-0" data-pilot-scenario={scenarioKey}><CardHeader><CardTitle as="h3">План пилота и бюджет</CardTitle></CardHeader><CardContent className="grid min-w-0 gap-5">
    <p className="text-sm">Выберите участок, состав, срок и критерии приёмки. Смета собирается из цен выбранного решения и оценок работ; уточните её с заказчиком и интегратором перед запуском.</p>
    {!saved && <p className="callout text-sm" data-tone="info">План ещё не задан в сценарии. Показаны стартовые оценки по его ценам и нормативам; условия пилота пока не согласованы.</p>}
    {!readOnly && onChange && <details className="no-print border-y border-border py-2"><summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">Настроить состав, смету и критерии пилота</summary><form className="grid gap-4 pt-3" onSubmit={event => { event.preventDefault(); try { const pilotPlan = parsePilotPlanInput(draft); if (!Number.isFinite(residual) || residual < 0 || residual > 1_000_000_000_000) throw new Error("Укажите неотрицательную чистую остаточную стоимость"); onChange({ pilotPlan, terminalResidualRub: residual }); setMessage("План и денежное допущение применены к сценарию. Сохраните проект, чтобы записать их."); } catch (error) { setMessage(error instanceof Error ? error.message : "Не удалось применить план"); } }}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {field("Роботов в пилоте", draft.fleet, value => update("fleet", value!), { min: 1, max: 500, integer: true })}
        {field("Зарядок в пилоте", draft.chargers, value => update("chargers", value!), { max: 2000, integer: true })}
        {field("Длительность пилота", draft.durationDays, value => update("durationDays", value!), { min: 1, max: 365, integer: true, unit: "дней" })}
        <label className="grid gap-1 text-sm">Считаем дни<select className="min-h-11 w-full rounded border bg-background px-3" value={draft.dayBasis} onChange={e => update("dayBasis", e.target.value as PilotPlanInput["dayBasis"])}><option value="working">Рабочие (оценка 5/7)</option><option value="calendar">Календарные</option></select></label>
        <label className="grid gap-1 text-sm">Оборудование пилота<select className="min-h-11 w-full rounded border bg-background px-3" value={draft.acquisition} onChange={e => { const acquisition = e.target.value as PilotPlanInput["acquisition"], defaults = defaultPilotPlan(model, scenarioKey, acquisition); setDraft(previous => ({ ...previous, acquisition, equipmentUnitRubOverride: null, chargerBudgetRubOverride: null, chargerBudgetSource: "", costs: defaults.costs })); setMessage("Способ получения оборудования изменён. Оценки работ обновлены по составу услуги; проверьте источники перед применением плана."); }}><option value="purchase">Покупка</option><option value="raas">Услуга RaaS</option></select></label>
        {field(draft.acquisition === "purchase" ? "Своя оценка цены за робота" : "Своя оценка RaaS за робота/месяц", draft.equipmentUnitRubOverride, value => update("equipmentUnitRubOverride", value), { nullable: true, unit: "₽" })}
        {field("Своя оценка бюджета зарядок пилота", draft.chargerBudgetRubOverride ?? null, value => update("chargerBudgetRubOverride", value), { nullable: true, unit: "₽" })}
        <label className="grid min-w-0 gap-1 text-sm">Источник своей оценки зарядок<input className="min-h-11 w-full rounded border bg-background px-3" maxLength={1000} required={draft.chargerBudgetRubOverride !== undefined && draft.chargerBudgetRubOverride !== null} value={draft.chargerBudgetSource ?? ""} onChange={e => update("chargerBudgetSource", e.target.value)} placeholder="Например, включены в подписку по договору" /></label>
        {field("Резерв сметы", draft.contingencyPct, value => update("contingencyPct", value!), { max: 100, unit: "%" })}
        {field("Цель потока участка пилота", draft.targetThroughputPerH, value => update("targetThroughputPerH", value), { min: 0.000001, max: 1_000_000, nullable: true, unit: "операций/ч" })}
        {field("Допуск p95 ожидания", draft.maxP95WaitMin, value => update("maxP95WaitMin", value!), { max: 1440, unit: "мин" })}
        {field("Допуск вмешательств за смену", draft.maxInterventionsPerShift, value => update("maxInterventionsPerShift", value!), { max: 10000, integer: true })}
      </div>
      <details className="min-w-0" open><summary className="cursor-pointer py-2 text-sm font-semibold">Работы и источники оценки — пустое значение означает «не определено»</summary><div className="grid gap-4 pt-2 sm:grid-cols-2">{(Object.keys(PILOT_WORKS) as WorkKey[]).map(key => <div key={key} className="grid min-w-0 gap-2 border-t pt-3">{field(PILOT_WORKS[key], draft.costs[key].valueRub, valueRub => update("costs", { ...draft.costs, [key]: { ...draft.costs[key], valueRub } }), { nullable: true, unit: "₽" })}<label className="grid gap-1 text-xs">Источник — {PILOT_WORKS[key]}<textarea className="min-h-16 w-full rounded border bg-background px-3 py-2" maxLength={1000} required value={draft.costs[key].source} onChange={e => update("costs", { ...draft.costs, [key]: { ...draft.costs[key], source: e.target.value } })} /></label></div>)}</div></details>
      <fieldset className="grid gap-2"><legend className="mb-2 text-sm font-semibold">Готовность участка</legend>{Object.entries(PILOT_READINESS).map(([key,label]) => <label key={key} className="flex min-h-11 items-start gap-2 text-sm"><input className="mt-1 size-4 shrink-0" type="checkbox" checked={draft.readiness.includes(key)} onChange={e => update("readiness", e.target.checked ? [...draft.readiness,key] : draft.readiness.filter(k => k !== key))} />{label}</label>)}</fieldset>
      {field(`Остаточная стоимость собственных активов после ${budget?.residual.year ?? "TCO"} лет (чистая сумма)`, residual, value => setResidual(value!), { unit: "₽" })}
      <p className="text-xs text-muted-foreground">По умолчанию 0: остаточная стоимость исключена. Это оценка после налогов, демонтажа и вывоза, а не подтверждённая цена продажи. {budget && !budget.residual.includedInNpv && `При горизонте NPV ${budget.residual.financialHorizonYears} лет поступление после ${budget.residual.year} лет в него не включается.`}</p>
      <label className="grid gap-1 text-sm">Примечание к плану<textarea className="min-h-20 w-full rounded border bg-background px-3 py-2" maxLength={4000} value={draft.notes} onChange={e => update("notes",e.target.value)} /></label>
      <Button type="submit" className="min-h-11" disabled={Boolean(inputError)}>Применить план и пересчитать сценарий</Button>
      {(message || inputError) && <p role="status" className="text-sm">{inputError || message}</p>}
    </form></details>}
    {budget && <PilotBudgetReadout budget={budget} />}
  </CardContent></Card>;
}
