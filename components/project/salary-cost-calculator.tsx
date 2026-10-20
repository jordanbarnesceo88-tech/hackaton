"use client";

import { useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { formatNum } from "@/lib/format/rub";
import { DEFAULT_PAYROLL_DRAFT, PAYROLL_FIELDS, parsePayrollDraft, payrollApplication, type PayrollApplication, type PayrollDraft, type PayrollNumberKey } from "@/lib/tz/payroll-breakdown";

export type PayrollSalaryOption = { key: string; label: string; grossSalaryRubMonth: number | null };

/** Local price worksheet; only explicit apply changes the true gross and common multiplier. */
export function SalaryCostCalculator({ salaries, currentPayrollMultiplier, onApply }: {
  salaries: readonly PayrollSalaryOption[];
  currentPayrollMultiplier: number | null;
  onApply: (application: PayrollApplication) => void;
}) {
  const id = useId();
  const [pickedKey, setPickedKey] = useState(salaries.find(salary => salary.key === "forkliftSalaryRubMonth")?.key ?? salaries[0]?.key ?? "");
  const [draft, setDraft] = useState<PayrollDraft>({ ...DEFAULT_PAYROLL_DRAFT });
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const salary = salaries.find(item => item.key === pickedKey) ?? salaries[0];
  if (!salary) return null;
  const calculation = parsePayrollDraft(draft);
  const issues = calculation.ok ? {} : calculation.issues;
  let application: PayrollApplication | null = null;
  let applicationError = "";
  if (calculation.ok) {
    try { application = payrollApplication(salary.key, calculation); }
    catch (error) { applicationError = error instanceof Error ? error.message : "Проверьте расчёт оплаты."; }
  }
  const update = (key: PayrollNumberKey | "basis", value: string) => {
    setDraft(previous => ({ ...previous, [key]: value })); setMessage(null);
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!application) return;
    try {
      onApply(application);
      setMessage({ error: false, text: "Gross и общий коэффициент применены к параметрам объекта. Пересчитайте результат." });
    } catch (error) {
      setMessage({ error: true, text: error instanceof Error ? error.message : "Не удалось применить расчёт оплаты." });
    }
  };
  const numberField = (key: PayrollNumberKey) => {
    const disabled = key === "contractorMarkupPct" && !draft.contractor;
    return <div key={key} className="flex min-w-0 flex-col gap-1 text-sm">
      <label htmlFor={`${id}-${key}`}>{PAYROLL_FIELDS[key]}</label>
      <input id={`${id}-${key}`} type="text" inputMode="decimal" autoComplete="off" maxLength={32}
        className="field min-h-11 w-full min-w-0 tabular-nums" value={draft[key]} disabled={disabled}
        aria-invalid={Boolean(issues[key]) || undefined} aria-describedby={issues[key] ? `${id}-${key}-error` : undefined}
        onChange={event => update(key, event.target.value)} />
      {issues[key] && <span id={`${id}-${key}-error`} role="alert" className="text-xs text-destructive">{issues[key]}</span>}
    </div>;
  };
  const b = calculation.ok ? calculation.breakdown : null;
  const money = (value: number) => `${formatNum(value, 2)} ₽`;
  const pct = (value: number) => formatNum(value, 2);
  const a = calculation.ok ? calculation.assumptions : null;
  const rows = b && a ? [
    { label: "Сотруднику на руки", value: b.netMonthRub, formula: `${money(a.netShiftRub)} × ${formatNum(a.paidShiftsMonth, 2)} смен` },
    { label: "Начисленная зарплата (gross)", value: b.grossSalaryRubMonth, formula: `${money(b.netMonthRub)} / (1 − ${pct(a.incomeTaxPct)}%)` },
    { label: "С начислениями работодателя", value: b.employerCostRubMonth, formula: `${money(b.grossSalaryRubMonth)} × (1 + ${pct(a.employerContributionsPct)}%)` },
    { label: "С накладными расходами", value: b.withOverheadRubMonth, formula: `${money(b.employerCostRubMonth)} × (1 + ${pct(a.overheadPct)}%)` },
    { label: "Полная стоимость в месяц", value: b.allInRubMonth, formula: a.contractor ? `${money(b.withOverheadRubMonth)} × (1 + ${pct(a.contractorMarkupPct)}%)` : "Без наценки подрядчика" },
  ] : [];

  return <details data-payroll-calculator className="min-w-0 border-y py-3">
    <summary className="min-h-11 cursor-pointer content-center text-sm font-semibold">Калькулятор ФОТ: от оплаты смены к стоимости сотрудника</summary>
    <form onSubmit={submit} className="mt-4 grid min-w-0 gap-6 xl:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-4">
        <p className="text-sm text-muted-foreground">Начальные числа — пример команды. Измените оплату и проценты по своим данным. Смены здесь задают месячную оплату; численность, рабочий график и ставки персонала не меняются.</p>
        <div className="flex min-w-0 flex-col gap-1 text-sm"><label htmlFor={`${id}-salary`}>Зарплатная роль</label>
          <select id={`${id}-salary`} className="field min-h-11 w-full min-w-0" value={salary.key} onChange={event => { setPickedKey(event.target.value); setMessage(null); }}>
            {salaries.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
        </div>
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          {(Object.keys(PAYROLL_FIELDS) as PayrollNumberKey[]).filter(key => key !== "contractorMarkupPct").map(numberField)}
        </div>
        <label htmlFor={`${id}-contractor`} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
          <input id={`${id}-contractor`} type="checkbox" className="size-4 shrink-0 accent-primary" checked={draft.contractor}
            onChange={event => { setDraft(previous => ({ ...previous, contractor: event.target.checked })); setMessage(null); }} />
          Включить наценку подрядчика
        </label>
        {numberField("contractorMarkupPct")}
        <p className="-mt-2 text-xs text-muted-foreground">Наценка добавляется к стоимости с накладными расходами. Это процент к себестоимости.</p>
        <div className="flex min-w-0 flex-col gap-1 text-sm"><label htmlFor={`${id}-basis`}>Источник / основание расчёта</label>
          <input id={`${id}-basis`} type="text" maxLength={100} className="field min-h-11 w-full min-w-0" value={draft.basis}
            aria-invalid={Boolean(issues.basis) || undefined} aria-describedby={issues.basis ? `${id}-basis-error` : undefined}
            onChange={event => update("basis", event.target.value)} />
          {issues.basis && <span id={`${id}-basis-error`} role="alert" className="text-xs text-destructive">{issues.basis}</span>}
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <h4 className="text-sm font-semibold">Из чего складывается стоимость</h4>
        {b ? <>
          <dl className="grid min-w-0 gap-3" aria-live="polite">
            {rows.map((row, index) => <div key={row.label} className={`grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1 ${index === rows.length - 1 ? "border-t pt-3 font-semibold" : ""}`}>
              <dt className="text-sm">{row.label}</dt><dd className="min-w-0 text-right text-sm tabular-nums">{money(row.value)}</dd>
              <dd className="col-span-full break-words text-xs font-normal text-muted-foreground">{row.formula}</dd>
            </div>)}
          </dl>
          <p className="text-sm">Стоимость за год: <strong className="tabular-nums">{money(b.allInRubMonth * 12)}</strong> = месячная стоимость × 12.</p>
          <div className="border-t pt-4 text-sm">
            <p>В поле gross выбранной роли: <strong className="tabular-nums">{salary.grossSalaryRubMonth === null ? "не задано" : money(salary.grossSalaryRubMonth)} → {money(b.grossSalaryRubMonth)}</strong>.</p>
            <p className="mt-2">Общий коэффициент: <strong className="tabular-nums">{currentPayrollMultiplier === null ? "не задан" : formatNum(currentPayrollMultiplier, 6)} → {formatNum(b.payrollMultiplier, 6)}</strong>.</p>
            <p className="mt-2 font-medium">Коэффициент применяется ко всем зарплатным ролям объекта. Начисления, накладные расходы и наценка входят в него один раз.</p>
          </div>
        </> : <p className="text-sm text-muted-foreground">Исправьте исходные значения, чтобы получить расшифровку. Ранее принятые параметры объекта остаются в расчёте.</p>}
        {(issues.total || applicationError) && <p role="alert" className="text-sm text-destructive">{issues.total || applicationError}</p>}
        <Button type="submit" variant="outline" size="lg" className="h-auto min-h-11 w-fit max-w-full whitespace-normal text-left" disabled={!application}>Применить gross и общий коэффициент</Button>
        <p className="text-xs text-muted-foreground">Расшифровка и источник попадут в журнал изменений вместе с параметрами. Пока вы не применили расчёт, показанный пример не меняет экономику проекта.</p>
        {message && <p role={message.error ? "alert" : "status"} className={message.error ? "text-sm text-destructive" : "text-sm"}>{message.text}</p>}
      </div>
    </form>
  </details>;
}
