"use client";

import { useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { cleaningOperatingReadiness, cleaningWorkingProfile } from "@/lib/data/cleaning-assumptions";
import { formatNum } from "@/lib/format/rub";
import { cleaningDay, parseCleaningProfile } from "@/lib/tz/econ/cleaning-profile";
import type { CleaningProfile } from "@/lib/tz/types";
import { stableJson } from "@/lib/tz/version";
import { draftText, type EditorDraftBindings } from "./editor-draft";

const NUMBER_FIELDS = [
  ["throughputM2PerH", "Рабочая выработка за активный час, м²/ч", 0.01, 1_000_000],
  ["workBeforeChargeH", "Уборка до зарядки, ч", 1 / 60, 24],
  ["chargeH", "Продолжительность зарядки, ч", 1 / 60, 24],
  ["windowH", "Рабочее окно в день, ч", 1 / 60, 24],
  ["dailyCareMin", "Ежедневный уход внутри окна, мин", 0, 1440],
  ["automatableLabourPct", "Доля труда роботизируемой уборки, %", 0, 100],
] as const;
type NumberKey = typeof NUMBER_FIELDS[number][0];
export type CleaningProfileDraft = Record<NumberKey | "mode" | "source" | "date" | "reason", string>;

function profileDraft(value?: CleaningProfile): CleaningProfileDraft {
  return {
    throughputM2PerH: value ? String(value.throughputM2PerH) : "",
    workBeforeChargeH: value ? String(value.workBeforeChargeH) : "",
    chargeH: value ? String(value.chargeH) : "", windowH: value ? String(value.windowH) : "",
    dailyCareMin: value ? String(value.dailyCareMin) : "",
    automatableLabourPct: value ? String(value.automatableLabourShare * 100) : "",
    mode: value?.mode ?? "", source: value?.source ?? "", date: value?.date ?? "", reason: value?.reason ?? "",
  };
}

/** UI percentages become a domain share; blank numeric fields must never become zero. */
export function parseCleaningProfileDraft(draft: CleaningProfileDraft): CleaningProfile {
  const number = (key: NumberKey) => draft[key].trim() ? Number(draft[key].trim().replace(",", ".")) : NaN;
  return parseCleaningProfile({
    basis: "active-hour", initiallyCharged: true, careWithinWindow: true,
    throughputM2PerH: number("throughputM2PerH"), workBeforeChargeH: number("workBeforeChargeH"),
    chargeH: number("chargeH"), windowH: number("windowH"), dailyCareMin: number("dailyCareMin"),
    automatableLabourShare: number("automatableLabourPct") / 100,
    mode: draft.mode, source: draft.source, date: draft.date, reason: draft.reason,
  });
}

/** Explicit local worksheet examples, never catalogue defaults or measured evidence. */
export function cleaningWorkingEstimate(productSlug: string): CleaningProfile | undefined {
  const profile = cleaningWorkingProfile(productSlug);
  return profile ? parseCleaningProfile(profile) : undefined;
}

function ProfileSummary({ value }: { value?: CleaningProfile }) {
  if (!value) return <p className="text-sm text-muted-foreground">Рабочий профиль не задан. Для финансового расчёта уборки укажите и примените оценку режима: паспортная производительность автоматически не подставляется.</p>;
  const day = cleaningDay(value);
  const rows = [
    ["База выработки", "Активный час (active-hour)"],
    ["Рабочая выработка", `${formatNum(value.throughputM2PerH, 2)} м²/активный ч`],
    ["Уборка / зарядка", `${formatNum(value.workBeforeChargeH, 2)} ч / ${formatNum(value.chargeH, 2)} ч`],
    ["Рабочее окно / ежедневный уход", `${formatNum(value.windowH, 2)} ч / ${formatNum(value.dailyCareMin, 2)} мин`],
    ["Начальное состояние и уход", "Полный заряд; ежедневный уход один раз в начале рабочего окна"],
    ["Оценка на одного робота за день", `${formatNum(day.activeHoursPerDay, 2)} активных ч; ${formatNum(day.capacityM2PerDay, 2)} м²`],
    ["Доля труда роботизируемой уборки", `${formatNum(value.automatableLabourShare * 100, 2)}%`],
    ["Режим и покрытие", value.mode], ["Источник", value.source], ["Дата оценки", value.date], ["Основание и допущения", value.reason],
  ];
  return <dl className="grid min-w-0 gap-3 text-sm sm:grid-cols-2">{rows.map(([label, text]) => <div key={label} className="min-w-0 break-words">
    <dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 whitespace-pre-wrap">{text}</dd>
  </div>)}</dl>;
}

export type CleaningProfileEditorProps = EditorDraftBindings & {
  productSlug: string; value?: CleaningProfile; readOnly?: boolean;
  onChange?: (value: CleaningProfile | undefined) => void;
};

function CleaningOperatingReports({ productSlug }: { productSlug: string }) {
  const report = cleaningOperatingReadiness(productSlug);
  if (!report.observations.length) return null;
  const modes = { all: "Все режимы", scrubbing: "Мойка", sweeping: "Подметание" };
  return <details data-cleaning-operating-reports className="min-w-0 border-t pt-3">
    <summary className="min-h-11 cursor-pointer content-center text-sm font-medium">Отчёты эксплуатации Alfa Robots</summary>
    <div className="mt-3 grid min-w-0 gap-3 text-sm">
      <p>Выборка относится к этой модели. Периоды показаны отдельно: сентябрь и период с 20 сентября пересекаются, складывать их нельзя.</p>
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Выработка модели по отчётам эксплуатации">
        <table className="w-full text-left text-xs">
          <caption className="pb-2 text-left text-muted-foreground">Площадь за час времени заданий из отчёта, м²/ч</caption>
          <thead><tr>{["Период", "Режим", "Роботов с заданиями", "Заданий", "Выработка"].map(label => <th key={label} scope="col" className="border-b px-2 py-2 font-medium">{label}</th>)}</tr></thead>
          <tbody>{report.observations.map(row => <tr key={`${row.from}:${row.through}:${row.mode}`}>
            <td className="whitespace-nowrap border-b px-2 py-2">{row.from} — {row.through}</td>
            <td className="border-b px-2 py-2">{modes[row.mode]}</td>
            <td className="border-b px-2 py-2 tabular-nums">{row.robotsWithTasks}</td>
            <td className="border-b px-2 py-2 tabular-nums">{row.tasks}</td>
            <td className="border-b px-2 py-2 tabular-nums">{row.m2PerRecordedTaskHour === null ? "Нет времени в отчёте" : formatNum(row.m2PerRecordedTaskHour, 2)}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">Источник — выгрузки Alfa Robots за август, сентябрь и 20 сентября — 19 октября 2026 года; модель сопоставлена с реестром оборудования. Время задания пока не приравнено к активному времени уборки или полной смене. Эти наблюдения доступны для сравнения с рабочей оценкой; расчёт использует явно применённый профиль ниже.</p>
    </div>
  </details>;
}

export function CleaningProfileEditor(props: CleaningProfileEditorProps) {
  // Reset only when the accepted profile or product changes; unrelated renders retain the local draft.
  return <CleaningProfileForm key={`${props.productSlug}:${stableJson(props.value ?? null)}`} {...props} />;
}

function CleaningProfileForm({ productSlug, value, readOnly, onChange, draft: savedDraft, onDraftChange }: CleaningProfileEditorProps) {
  const id = useId();
  const [draft, setDraft] = useState(() => {
    const initial = profileDraft(value);
    if (!readOnly && onChange) for (const key of Object.keys(initial) as (keyof CleaningProfileDraft)[]) initial[key] = draftText(savedDraft, key, initial[key]);
    return initial;
  });
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(profileDraft(value));
  const preset = cleaningWorkingEstimate(productSlug);
  const replaceDraft = (next: CleaningProfileDraft) => { setDraft(next); onDraftChange?.(next); };
  const update = (key: keyof CleaningProfileDraft, text: string) => { replaceDraft({ ...draft, [key]: text }); setMessage(null); };
  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const parsed = parseCleaningProfileDraft(draft);
      onChange?.(parsed);
      onDraftChange?.(null);
      setMessage({ error: false, text: "Рабочий профиль применён к сценарию. Пересчитайте финансовый результат." });
    } catch (error) { setMessage({ error: true, text: error instanceof Error ? error.message : "Проверьте рабочий профиль уборки." }); }
  }
  const limits = <p className="text-xs leading-relaxed text-muted-foreground">Это экспертная оценка, а не подтверждённая выработка на объекте или результат 3D-проверки. Модель начинает день с полным зарядом, один раз вычитает уход в начале окна, затем чередует уборку и зарядку до конца окна. На каждого робота предусмотрена отдельная зарядная станция. Вода, лифты, люди, очереди и поломки этим профилем не моделируются.</p>;
  if (readOnly || !onChange) return <section data-cleaning-profile-readonly className="grid min-w-0 gap-3 border-t pt-3">
    <h5 className="text-sm font-medium">Рабочий профиль уборки</h5><ProfileSummary value={value} />{limits}
  </section>;
  return <details data-cleaning-profile-editor className="min-w-0 border-t pt-3">
    <summary className="min-h-11 cursor-pointer content-center text-sm font-medium">Рабочий профиль уборки: выработка, зарядка и труд</summary>
    <div className="mt-3 grid min-w-0 gap-4"><ProfileSummary value={value} />{limits}<CleaningOperatingReports productSlug={productSlug} /></div>
    <form onSubmit={apply} className="mt-4 grid max-w-3xl min-w-0 gap-4">
      {preset && <div className="grid gap-2">
        <Button type="button" variant="outline" className="h-auto min-h-11 w-fit max-w-full whitespace-normal" onClick={() => { replaceDraft(profileDraft(preset)); setMessage({ error: false, text: "Рабочая оценка заполнена только в форме. Проверьте единицы, режим и допущения, затем примените профиль." }); }}>Заполнить рабочую оценку</Button>
        <p className="text-xs text-muted-foreground">Пример команды для этой модели. Заполнение формы не меняет сценарий и не подтверждает оценку измерениями.</p>
      </div>}
      {dirty && <p role="status" className="text-sm">В форме есть неприменённые изменения рабочего профиля. {value ? "В расчёте пока используется ранее принятый профиль." : "Для финансового расчёта уборки сначала примените профиль."}</p>}
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">{NUMBER_FIELDS.map(([key, label, min, max]) => <div key={key} className="grid min-w-0 gap-1 text-sm">
        <label htmlFor={`${id}-${key}`}>{label}</label>
        <input id={`${id}-${key}`} name={key} type="number" step="any" min={min} max={max} required inputMode="decimal" className="field min-h-11 w-full min-w-0" value={draft[key]} onChange={event => update(key, event.target.value)} />
      </div>)}</div>
      <p className="text-xs text-muted-foreground">Доля труда относится к роботизируемой уборке, а не ко всему персоналу. Высвобождение времени и денежная экономия ФОТ оцениваются отдельно.</p>
      <div className="grid gap-1 text-sm"><label htmlFor={`${id}-mode`}>Режим уборки и покрытие</label>
        <input id={`${id}-mode`} name="mode" maxLength={100} required className="field min-h-11 w-full" value={draft.mode} onChange={event => update("mode", event.target.value)} />
      </div>
      <div className="grid max-w-xs gap-1 text-sm"><label htmlFor={`${id}-date`}>Дата рабочей оценки</label>
        <input id={`${id}-date`} name="date" type="date" required className="field min-h-11 w-full min-w-0" value={draft.date} onChange={event => update("date", event.target.value)} />
      </div>
      {(["source", "reason"] as const).map(key => <div key={key} className="grid min-w-0 gap-1 text-sm"><label htmlFor={`${id}-${key}`}>{key === "source" ? "Источник рабочей оценки" : "Основание, условия и допущения"}</label>
        <textarea id={`${id}-${key}`} name={key} required rows={3} maxLength={1000} className="field w-full min-w-0" value={draft[key]} onChange={event => update(key, event.target.value)} />
      </div>)}
      {message && <p role={message.error ? "alert" : "status"} className={message.error ? "text-sm text-destructive" : "text-sm"}>{message.text}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="outline" className="h-auto min-h-11 max-w-full whitespace-normal">Применить рабочий профиль</Button>
        {value && <Button type="button" variant="ghost" className="h-auto min-h-11 max-w-full whitespace-normal" onClick={() => { onChange(undefined); onDraftChange?.(null); }}>Убрать рабочий профиль</Button>}
      </div>
      <p className="text-xs text-muted-foreground">Применение сохраняет профиль как допущение сценария. Удаление профиля остановит финансовый расчёт уборки до новой оценки; паспортный максимум его не заменяет.</p>
    </form>
  </details>;
}
