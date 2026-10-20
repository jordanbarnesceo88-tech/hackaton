"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { evaluatePilotAcceptance, parsePilotAcceptanceThresholds, parsePilotObservation } from "@/lib/tz/pilot-evaluation";
import type { PilotAcceptanceMetric, PilotAcceptanceThresholds, PilotObservation, PilotPlanInput } from "@/lib/tz/types";

export type PilotEvaluationProps = {
  plan: PilotPlanInput; productSlug: string; metric: PilotAcceptanceMetric; readOnly?: boolean;
  onApply?: (value: { acceptanceThresholds: PilotAcceptanceThresholds; actualResult: PilotObservation }) => void;
};
const METRIC_LABEL = { "accepted-area-m2-day": "Принятая площадь, м²/день", "completed-operations-hour": "Завершённые операции, операций/ч окна" } as const;
const STATUS_LABEL = { PASS: "Критерии выполнены", FAIL: "Критерии не выполнены", INCOMPLETE: "Недостаточно сопоставимых данных" } as const;

export function PilotEvaluation({ plan, productSlug, metric, readOnly = false, onApply }: PilotEvaluationProps) {
  const [thresholds, setThresholds] = useState<PilotAcceptanceThresholds>(() => structuredClone(plan.acceptanceThresholds ?? {
    schemaVersion: "pilot-acceptance-1", scope: "", metric, source: "", date: null, minAcceptedPerUnit: null, minPlanCompletionPct: null, maxManualReworkPct: null,
    maxDowntimePct: null, maxIncidents: null, maxInterventionsPerShift: null, minCustomerScore: null, minDurationDays: null,
  }));
  const [actual, setActual] = useState<PilotObservation>(() => structuredClone(plan.actualResult ?? {
    schemaVersion: "pilot-observation-1", scope: "", metric, productSlug, fleet: null, periodStart: null, periodEnd: null, observedDays: null, dayBasis: plan.dayBasis,
    acceptedQuantity: null, plannedQuantity: null, manualReworkQuantity: null, scheduledHours: null, downtimeHours: null, incidents: null, interventions: null, shifts: null, customerScore: null, source: "", date: null,
  }));
  const [message, setMessage] = useState("");
  const accepted = evaluatePilotAcceptance(plan, { metric, productSlug });
  const editable = !readOnly && Boolean(onApply);
  const dirty = JSON.stringify(thresholds) !== JSON.stringify(plan.acceptanceThresholds) || JSON.stringify(actual) !== JSON.stringify(plan.actualResult);
  const numberField = (label: string, value: number | null, update: (value: number | null) => void, options: { max?: number; min?: number; integer?: boolean } = {}) => <label className="grid min-w-0 gap-1 text-sm">{label}<input className="field min-h-11" type="number" min={options.min ?? 0} max={options.max ?? 1_000_000_000} step={options.integer ? 1 : "any"} value={value ?? ""} placeholder="Нет данных" onChange={e => update(e.target.value === "" ? null : e.target.valueAsNumber)} /></label>;
  const textField = (label: string, value: string, update: (value: string) => void, maxLength = 1000) => <label className="grid min-w-0 gap-1 text-sm">{label}<input className="field min-h-11" maxLength={maxLength} value={value} onChange={e => update(e.target.value)} /></label>;
  const dateField = (label: string, value: string | null, update: (value: string | null) => void) => <label className="grid min-w-0 gap-1 text-sm">{label}<input className="field min-h-11" type="date" value={value ?? ""} onChange={e => update(e.target.value || null)} /></label>;
  const metricField = (label: string, value: PilotAcceptanceMetric, update: (value: PilotAcceptanceMetric) => void) => <label className="grid min-w-0 gap-1 text-sm">{label}<select className="field min-h-11" value={value} onChange={e => update(e.target.value as PilotAcceptanceMetric)}>{Object.entries(METRIC_LABEL).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>;
  return <section className="grid min-w-0 gap-4 border-t border-border pt-4" aria-label="Фактическая приёмка пилота" data-pilot-acceptance={accepted.status}>
    <h4 className="font-semibold">Фактическая приёмка пилота</h4>
    <p className="text-sm">{STATUS_LABEL[accepted.status]}. Вердикт вычислен из применённых критериев и наблюдений участка. Это не промышленная сертификация и не автоматическое одобрение полного внедрения.</p>
    <dl className="grid gap-2 text-sm sm:grid-cols-2">
      <div><dt className="text-muted-foreground">Критерии</dt><dd className="m-0 break-words">{plan.acceptanceThresholds ? `${plan.acceptanceThresholds.scope || "Участок не указан"}; ${plan.acceptanceThresholds.source || "Источник не указан"}; ${plan.acceptanceThresholds.date ?? "Дата не указана"}` : "Не заданы"}</dd></div>
      <div><dt className="text-muted-foreground">Наблюдения</dt><dd className="m-0 break-words">{plan.actualResult ? `${plan.actualResult.periodStart ?? "?"} — ${plan.actualResult.periodEnd ?? "?"}; ${plan.actualResult.source || "Источник не указан"}; запись ${plan.actualResult.date ?? "без даты"}` : "Не заданы"}</dd></div>
    </dl>
    <ul className="grid gap-2 text-sm">{accepted.checks.map(check => <li key={check.key}><strong>{check.label}: {check.status === "PASS" ? "выполнено" : check.status === "FAIL" ? "не выполнено" : "не оценено"}.</strong> {check.reason}</li>)}</ul>
    {editable && <details className="no-print min-w-0 border-t border-border pt-2"><summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">Внести критерии и фактические результаты</summary>
      <form className="grid gap-4 pt-3" onSubmit={event => {
        event.preventDefault();
        try {
          const acceptanceThresholds = parsePilotAcceptanceThresholds(thresholds), actualResult = parsePilotObservation(actual);
          evaluatePilotAcceptance({ ...plan, acceptanceThresholds, actualResult }, { metric, productSlug });
          onApply?.({ acceptanceThresholds, actualResult });
          setMessage("Критерии и наблюдения применены. Сохраните проект для записи результатов; вердикт сервер вычислит заново.");
        } catch (error) { setMessage(error instanceof Error ? error.message : "Проверьте критерии и наблюдения"); }
      }}>
        <p className="text-sm text-muted-foreground">Пустое поле означает «нет данных», а не ноль. Пороговые значения задаются по согласованным условиям конкретного пилота. Сначала заполните черновик, затем примените его; измерения не создаются из расчётного прогноза.</p>
        <fieldset className="grid gap-3"><legend className="mb-2 font-semibold">Согласованные критерии</legend><div className="grid min-w-0 gap-3 sm:grid-cols-2">
          {textField("Участок критериев", thresholds.scope, scope => setThresholds({ ...thresholds, scope }))}
          {metricField("Единица целевой выработки", thresholds.metric, value => setThresholds({ ...thresholds, metric: value }))}
          {textField("Источник критериев", thresholds.source, source => setThresholds({ ...thresholds, source }), 2000)}
          {dateField("Дата согласования критериев", thresholds.date, date => setThresholds({ ...thresholds, date }))}
          {numberField(METRIC_LABEL[thresholds.metric] + ", не менее", thresholds.minAcceptedPerUnit, value => setThresholds({ ...thresholds, minAcceptedPerUnit: value }), { min: 0.000001, max: 1_000_000 })}
          {numberField("Выполнение плана, не менее %", thresholds.minPlanCompletionPct, value => setThresholds({ ...thresholds, minPlanCompletionPct: value }), { max: 100 })}
          {numberField("Ручная повторная работа, не более % принятого объёма", thresholds.maxManualReworkPct, value => setThresholds({ ...thresholds, maxManualReworkPct: value }), { max: 100 })}
          {numberField("Простой, не более % окна", thresholds.maxDowntimePct, value => setThresholds({ ...thresholds, maxDowntimePct: value }), { max: 100 })}
          {numberField("Инциденты за период, не более", thresholds.maxIncidents, value => setThresholds({ ...thresholds, maxIncidents: value }), { max: 1_000_000, integer: true })}
          {numberField("Вмешательства за смену, не более", thresholds.maxInterventionsPerShift, value => setThresholds({ ...thresholds, maxInterventionsPerShift: value }), { max: 10000 })}
          {numberField("Оценка заказчика из 5, не менее", thresholds.minCustomerScore, value => setThresholds({ ...thresholds, minCustomerScore: value }), { max: 5 })}
          {numberField(`Наблюдавшиеся ${plan.dayBasis === "working" ? "рабочие" : "календарные"} дни, не менее`, thresholds.minDurationDays, value => setThresholds({ ...thresholds, minDurationDays: value }), { min: 1, max: 365, integer: true })}
        </div></fieldset>
        <fieldset className="grid gap-3"><legend className="mb-2 font-semibold">Фактические наблюдения</legend><div className="grid min-w-0 gap-3 sm:grid-cols-2">
          {textField("Участок наблюдений", actual.scope, scope => setActual({ ...actual, scope }))}
          {metricField("Единица принятого объёма", actual.metric, value => setActual({ ...actual, metric: value }))}
          {textField("Модель робота (slug)", actual.productSlug, value => setActual({ ...actual, productSlug: value }), 200)}
          {numberField("Фактический парк, роботов", actual.fleet, value => setActual({ ...actual, fleet: value }), { min: 1, max: 500, integer: true })}
          {dateField("Начало наблюдений", actual.periodStart, value => setActual({ ...actual, periodStart: value }))}
          {dateField("Конец наблюдений", actual.periodEnd, value => setActual({ ...actual, periodEnd: value }))}
          {numberField("Наблюдавшиеся дни", actual.observedDays, value => setActual({ ...actual, observedDays: value }), { min: 1, max: 365, integer: true })}
          <label className="grid min-w-0 gap-1 text-sm">Базис дней наблюдений<select className="field min-h-11" value={actual.dayBasis} onChange={e => setActual({ ...actual, dayBasis: e.target.value as PilotObservation["dayBasis"] })}><option value="working">Рабочие дни (факт)</option><option value="calendar">Календарные дни</option></select></label>
          {numberField(actual.metric === "accepted-area-m2-day" ? "Принятая площадь за период, м²" : "Завершённые операции за период", actual.acceptedQuantity, value => setActual({ ...actual, acceptedQuantity: value }))}
          {numberField(actual.metric === "accepted-area-m2-day" ? "Плановая площадь за период, м²" : "Плановые операции за период", actual.plannedQuantity, value => setActual({ ...actual, plannedQuantity: value }), { min: 0.000001 })}
          {numberField(actual.metric === "accepted-area-m2-day" ? "Часть принятой площади с ручной доработкой, м²" : "Принятые операции с ручной доработкой", actual.manualReworkQuantity, value => setActual({ ...actual, manualReworkQuantity: value }))}
          {numberField("Часы всего окна наблюдений, включая простой", actual.scheduledHours, value => setActual({ ...actual, scheduledHours: value }), { min: 0.000001, max: 8760 })}
          {numberField("Простой за период, часов", actual.downtimeHours, value => setActual({ ...actual, downtimeHours: value }), { max: 8760 })}
          {numberField("Инциденты за период", actual.incidents, value => setActual({ ...actual, incidents: value }), { max: 1_000_000, integer: true })}
          {numberField("Ручные вмешательства за период", actual.interventions, value => setActual({ ...actual, interventions: value }), { max: 1_000_000, integer: true })}
          {numberField("Наблюдавшиеся смены", actual.shifts, value => setActual({ ...actual, shifts: value }), { min: 1, max: 10000, integer: true })}
          {numberField("Оценка заказчика, от 0 до 5", actual.customerScore, value => setActual({ ...actual, customerScore: value }), { max: 5 })}
          {textField("Источник наблюдений", actual.source, source => setActual({ ...actual, source }), 2000)}
          {dateField("Дата фиксации результатов", actual.date, date => setActual({ ...actual, date }))}
        </div></fieldset>
        <p className="text-xs text-muted-foreground">Повторные проходы не добавляются к принятой площади. Ручная доработка — часть принятого объёма, потребовавшая повторной работы. Операций/ч считаются по всему окну с простоем; день и активный час не взаимозаменяемы.</p>
        <Button type="submit">Применить критерии и результаты пилота</Button>
        {dirty && <p className="text-sm text-muted-foreground">Черновик формы ещё не включён в сохранённую приёмку.</p>}
        {message && <p role="status" className="text-sm">{message}</p>}
      </form>
    </details>}
  </section>;
}
