"use client";

import { useId, useState, type FormEvent } from "react";
import { buttonVariants } from "@/components/ui/button";
import { parseRaasPackage, raasPackageDescription } from "@/lib/tz/econ/raas-package";
import type { RaasCharge, RaasBatteryCharge, RaasPackage } from "@/lib/tz/types";
import { draftText, readEditorFormDraft, type EditorDraftBindings, type EditorFormDraft } from "./editor-draft";

const CHARGES = [
  ["startup", "Запуск: подготовка, интеграция и обучение", "₽ разово"],
  ["platform", "Платформа / лицензия ПО", "₽/мес"],
  ["service", "Плановое сервисное обслуживание", "₽/год"],
  ["consumables", "Расходные материалы", "₽/год"],
  ["repair", "Ремонт вне оплаченного сервиса", "₽/год"],
  ["battery", "Замена АКБ", "₽ за замену"],
] as const;

function ChargeFields({ name, title, unit, value, draft }: {
  name: typeof CHARGES[number][0]; title: string; unit: string; value?: RaasCharge | RaasBatteryCharge;
  draft?: EditorFormDraft;
}) {
  const id = useId();
  const [mode, setMode] = useState(() => draftText(draft, `${name}-mode`, value?.mode ?? "unassessed"));
  return <fieldset className="grid min-w-0 gap-2 border-t pt-3">
    <legend className="px-0 text-sm font-medium">{title}</legend>
    <div className="grid min-w-0 gap-3 sm:grid-cols-3">
      <div className="grid content-start gap-1 text-sm"><label htmlFor={`${id}-mode`}>Оплата</label>
        <select id={`${id}-mode`} name={`${name}-mode`} value={mode} onChange={event => setMode(event.target.value as RaasCharge["mode"])} className="field min-h-11 w-full">
          <option value="unassessed">Не оценено</option>
          <option value="included">Включено в тариф</option>
          <option value="separate">Отдельная плата / оценка</option>
        </select>
      </div>
      {mode === "separate" && <>
        <label className="grid content-start gap-1 text-sm" htmlFor={`${id}-amount`}>{unit}
          <input id={`${id}-amount`} name={`${name}-amount`} type="number" min={0} max={1e12} step="any" required defaultValue={draftText(draft, `${name}-amount`, value?.mode === "separate" ? value.amountRub : "")} className="field min-h-11 w-full" />
        </label>
        <div className="grid content-start gap-1 text-sm"><label htmlFor={`${id}-basis`}>База начисления</label>
          <select id={`${id}-basis`} name={`${name}-basis`} defaultValue={draftText(draft, `${name}-basis`, value?.mode === "separate" ? value.basis : "per-robot")} className="field min-h-11 w-full">
            <option value="per-robot">За каждого робота</option>
            <option value="per-site">За всю площадку</option>
          </select>
        </div>
        {name === "battery" && <label className="grid max-w-xs content-start gap-1 text-sm" htmlFor={`${id}-years`}>Замена каждые, лет
          <input id={`${id}-years`} name="battery-years" type="number" min={1} max={100} step={1} required defaultValue={draftText(draft, "battery-years", value?.mode === "separate" && "everyYears" in value ? value.everyYears : "")} className="field min-h-11 w-full" />
        </label>}
      </>}
    </div>
  </fieldset>;
}

export function RaasPackageEditor({ value, recurringRubMonth, readOnly, onChange, draft, onDraftChange }: EditorDraftBindings & {
  value?: RaasPackage; recurringRubMonth: number | null; readOnly?: boolean;
  onChange?: (value: RaasPackage | undefined) => void;
}) {
  const id = useId();
  const [error, setError] = useState("");
  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const draft: Record<string, unknown> = { reason: String(data.get("reason") ?? "").trim() };
    const first = String(data.get("firstMonth") ?? "").trim();
    if (first) draft.firstMonthRub = Number(first);
    for (const [name] of CHARGES) {
      const mode = data.get(`${name}-mode`);
      draft[name] = mode === "separate" ? {
        mode, amountRub: Number(data.get(`${name}-amount`)), basis: data.get(`${name}-basis`),
        ...(name === "battery" ? { everyYears: Number(data.get("battery-years")) } : {}),
      } : { mode };
    }
    try {
      const parsed = parseRaasPackage(draft);
      if (parsed.firstMonthRub !== undefined && recurringRubMonth !== null && parsed.firstMonthRub < recurringRubMonth) throw new Error("Первый месяц должен быть не дешевле регулярного тарифа. Скидки первого месяца модель пока не учитывает.");
      setError("");
      onChange?.(parsed);
      onDraftChange?.(null);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Проверьте состав и суммы RaaS."); }
  }
  const summary = value ? raasPackageDescription(value) : "Включение ПО, сервиса, расходников, ремонта и АКБ пока принято допущением, состав предложения не задан. Укажите отдельные платежи и включённые услуги, чтобы проверить полную стоимость.";
  if (readOnly || !onChange) return <section className="grid min-w-0 gap-2 border-t pt-3 text-sm"><h5 className="font-medium">Состав услуги RaaS</h5><p className="max-w-3xl break-words leading-relaxed">{summary}</p></section>;
  return <details className="min-w-0 border-t pt-3">
    <summary className="tap-target cursor-pointer text-sm font-medium">Состав услуги RaaS и отдельные платежи</summary>
    <p className="mt-3 max-w-3xl break-words text-sm leading-relaxed">{summary}</p>
    <form onSubmit={apply} onChange={event => onDraftChange?.(readEditorFormDraft(event.currentTarget))} className="mt-4 grid max-w-3xl min-w-0 gap-5">
      <p className="text-sm text-muted-foreground">Неизвестная стоимость не равна нулю: с неоценёнными статьями финансовый расчёт остановится. Можно задать рабочую оценку, указав её основание. Платёж за площадку указывайте один раз, даже если в сценарии несколько позиций.</p>
      <p className="text-xs text-muted-foreground">Применение заменяет прежнюю отдельную корректировку сервиса условиями этого состава. Разовый запуск заменяет исходные статьи интеграции, пусконаладки и обучения.</p>
      <label className="grid max-w-xl gap-1.5 text-sm" htmlFor={`${id}-first`}>Полная ставка первого месяца за робота, ₽ (если отличается)
        <input id={`${id}-first`} name="firstMonth" type="number" min={recurringRubMonth ?? 0} max={1e12} step="any" defaultValue={draftText(draft, "firstMonth", value?.firstMonthRub ?? "")} className="field min-h-11 w-full" aria-describedby={`${id}-first-help`} />
      </label>
      <p id={`${id}-first-help`} className="-mt-3 text-xs text-muted-foreground">Разница с регулярным тарифом учитывается один раз в начальном платеже. Не включайте в отдельный запуск работы, уже оплаченные этой разницей.</p>
      {CHARGES.map(([name, title, unit]) => <ChargeFields key={name} name={name} title={title} unit={unit} value={value?.[name]} draft={draft} />)}
      <label className="grid gap-1.5 text-sm" htmlFor={`${id}-reason`}>Источник, состав предложения и оценочные допущения
        <textarea id={`${id}-reason`} name="reason" rows={3} required maxLength={1000} defaultValue={draftText(draft, "reason", value?.reason ?? "")} className="field w-full" />
      </label>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={buttonVariants({ variant: "outline" })}>Применить состав RaaS</button>
        {value && <button type="button" className={buttonVariants({ variant: "ghost" })} onClick={() => { onChange(undefined); onDraftChange?.(null); }}>Вернуть исходные допущения</button>}
      </div>
    </form>
  </details>;
}
