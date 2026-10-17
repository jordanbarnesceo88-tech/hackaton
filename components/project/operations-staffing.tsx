"use client";

import { useId, useState, type FormEvent } from "react";
import { buttonVariants } from "@/components/ui/button";
import { formatRub } from "@/lib/format/rub";
import type { ScenarioSpec } from "@/lib/tz/types";

type Staffing = NonNullable<ScenarioSpec["operationsStaffing"]>;
type Mode = Staffing["mode"] | "legacy";
const INPUT = "h-10 w-full min-w-0 rounded-md border bg-background px-3 text-sm";

/** Draft fields do not change the result until their cost basis is explicitly applied. */
export function OperationsStaffing({ value, annualCostRub, breakEvenAnnualRub, defaultSalaryRubMonth, defaultPayrollMultiplier, defaultAnnualHours, readOnly, onChange }: {
  value?: Staffing;
  annualCostRub: number | null;
  breakEvenAnnualRub?: number | null;
  defaultSalaryRubMonth: number;
  defaultPayrollMultiplier: number;
  defaultAnnualHours: number;
  readOnly?: boolean;
  onChange?: (value: Staffing | undefined) => void;
}) {
  const id = useId();
  const [mode, setMode] = useState<Mode>(value?.mode ?? "legacy");
  const [billing, setBilling] = useState<"separate" | "included-in-service">(value?.mode === "integrator" ? value.billing : "separate");
  const [error, setError] = useState("");
  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (mode === "legacy") { onChange?.(undefined); return; }
    const data = new FormData(event.currentTarget);
    const reason = String(data.get("reason") ?? "").trim();
    const num = (key: string) => Number(String(data.get(key) ?? "").replace(",", "."));
    if (!reason) { setError("Укажите источник или обоснование дополнительных расходов."); return; }
    const next: Staffing = mode === "dedicated"
      ? { mode, grossSalaryRubMonth: num("salary"), payrollMultiplier: num("payroll"), annualHoursPerFte: num("annualHours"), reason }
      : mode === "shared-existing"
        ? { mode, incrementalHoursYear: num("hours"), grossHourlyRub: num("hourly"), payrollMultiplier: num("payroll"), reason }
        : billing === "separate"
          ? { mode: "integrator", billing, annualFeeRub: num("fee"), reason }
          : { mode: "integrator", billing, reason };
    const numbers = Object.values(next).filter(v => typeof v === "number");
    if (numbers.some(v => !Number.isFinite(v) || v < 0)) { setError("Проверьте числовые значения: нужны неотрицательные конечные суммы и часы."); return; }
    onChange?.(next);
  }
  const summary = value?.mode === "dedicated" ? "Выделенный новый персонал"
    : value?.mode === "shared-existing" ? "Дополнительная оплата существующему персоналу"
      : value?.mode === "integrator" ? value.billing === "separate" ? "Диспетчеризация интегратором: отдельный платёж" : "Диспетчеризация включена в сервис / RaaS"
        : "Исходное допущение: отдельный пост на весь режим работы объекта";
  const field = (name: string, label: string, initial: number | undefined, options: { min?: number; max?: number; step?: number } = {}) => <label className="flex min-w-0 flex-col gap-1.5 text-sm" htmlFor={`${id}-${name}`}>{label}<input id={`${id}-${name}`} name={name} type="number" required defaultValue={initial} min={options.min ?? 0} max={options.max ?? 1e12} step={options.step ?? "any"} className={INPUT} /></label>;
  return <section aria-labelledby={`${id}-title`} className="flex min-w-0 flex-col gap-3 border-y py-5">
    <div className="flex flex-wrap items-baseline justify-between gap-2"><h4 id={`${id}-title`} className="block-title">Кто обслуживает парк и что добавится к расходам</h4><strong className="text-sm tabular-nums">{annualCostRub === null ? "Не рассчитано" : `${formatRub(annualCostRub)}/год`}</strong></div>
    <p className="max-w-3xl text-sm leading-relaxed">{summary}. {value ? `Основание: ${value.reason}` : "Это допущение модели, а не требование ТЗ. Оно оплачивает полное покрытие часов склада по ставке сотрудника процесса."}</p>
    <p className="max-w-3xl text-sm text-muted-foreground">Существующий ФОТ уже учтён в процессе. Здесь учитываются только новые расходы на эксплуатацию парка. Высвобождение труда и фактическое сокращение расходов на персонал считаются отдельно.</p>
    {breakEvenAnnualRub !== undefined && breakEvenAnnualRub !== null && <p className="max-w-3xl text-sm">{breakEvenAnnualRub < 0
      ? "При остальных текущих условиях NPV отрицателен даже без дополнительных расходов на эксплуатационный персонал. Одной смены организации персонала недостаточно."
      : `При остальных текущих условиях NPV достигает нуля при дополнительных расходах эксплуатации до ${formatRub(breakEvenAnnualRub)}/год. Это граница расчёта при неизменной выработке и денежных допущениях; организация работы требует отдельного подтверждения.`}</p>}
    {!readOnly && onChange && <details className="min-w-0">
      <summary className="cursor-pointer text-sm font-medium">Изменить организацию эксплуатации</summary>
      <form onSubmit={apply} className="mt-4 flex min-w-0 flex-col gap-4">
        <label className="flex max-w-xl flex-col gap-1.5 text-sm" htmlFor={`${id}-mode`}>Организация работы<select id={`${id}-mode`} className={INPUT} value={mode} onChange={event => { setMode(event.target.value as Mode); setError(""); }}>
          <option value="legacy">Исходное допущение модели</option><option value="dedicated">Выделенный новый персонал</option><option value="shared-existing">Часть времени существующего сотрудника</option><option value="integrator">Диспетчеризация интегратором</option>
        </select></label>
        <div key={`${mode}-${billing}`} className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {mode === "dedicated" && <>{field("salary", "Оклад нового сотрудника до начислений, ₽/мес", value?.mode === mode ? value.grossSalaryRubMonth : defaultSalaryRubMonth, { min: .01, max: 1e7 })}{field("payroll", "Множитель начислений на ФОТ", value?.mode === mode ? value.payrollMultiplier : defaultPayrollMultiplier, { min: 1, max: 3 })}{field("annualHours", "Рабочих часов на одну ставку в год", value?.mode === mode ? value.annualHoursPerFte : defaultAnnualHours, { min: 1, max: 8784 })}</>}
          {mode === "shared-existing" && <>{field("hours", "Дополнительно оплачиваемые часы на весь парк, ч/год", value?.mode === mode ? value.incrementalHoursYear : undefined, { max: 1e7 })}{field("hourly", "Дополнительная оплата до начислений, ₽/ч", value?.mode === mode ? value.grossHourlyRub : undefined, { max: 1e7 })}{field("payroll", "Множитель начислений на ФОТ", value?.mode === mode ? value.payrollMultiplier : defaultPayrollMultiplier, { min: 1, max: 3 })}</>}
          {mode === "integrator" && <label className="flex flex-col gap-1.5 text-sm" htmlFor={`${id}-billing`}>Состав платежа<select id={`${id}-billing`} className={INPUT} value={billing} onChange={event => setBilling(event.target.value as typeof billing)}><option value="separate">Отдельная годовая плата</option><option value="included-in-service">Включено в сервис / RaaS</option></select></label>}
          {mode === "integrator" && billing === "separate" && field("fee", "Плата за весь парк, ₽/год", value?.mode === mode && value.billing === billing ? value.annualFeeRub : undefined, { max: 1e12 })}
        </div>
        {mode === "dedicated" && <p className="max-w-3xl text-xs text-muted-foreground">Число одновременных постов определяется по общему парку и нормативу роботов на пост; количество ставок — по режиму работы склада и годовому фонду часов.</p>}
        {mode === "shared-existing" && <p className="max-w-3xl text-xs text-muted-foreground">Если доплаты нет, явно укажите 0 и обоснуйте, кто выполняет эту работу в пределах текущих обязанностей. Нулевой платёж не означает, что работа не требует времени.</p>}
        {mode === "integrator" && billing === "included-in-service" && <p className="max-w-3xl text-xs text-caution">Укажите документ или допущение, по которому диспетчеризация включена в уже оплачиваемый сервис. Техническое обслуживание само по себе этого не гарантирует.</p>}
        {mode !== "legacy" && <label htmlFor={`${id}-reason`} className="flex max-w-3xl flex-col gap-1.5 text-sm">Источник / обоснование<textarea id={`${id}-reason`} name="reason" required maxLength={1000} defaultValue={value?.reason ?? ""} rows={2} className="w-full rounded-md border bg-background px-3 py-2 text-sm" /></label>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <button type="submit" className={buttonVariants({ variant: "outline", className: "w-fit" })}>Применить и пересчитать</button>
      </form>
    </details>}
  </section>;
}
