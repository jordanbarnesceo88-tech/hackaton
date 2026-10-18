"use client";

import { useId, useState, type FormEvent } from "react";
import { buttonVariants } from "@/components/ui/button";
import { parseDeploymentLogistics, deploymentLogisticsText } from "@/lib/tz/deployment-logistics";
import type { DeploymentLogistics as Logistics } from "@/lib/tz/types";

export function DeploymentLogistics({ value, readOnly, onChange }: {
  value?: Logistics;
  readOnly?: boolean;
  onChange?: (value: Logistics | undefined) => void;
}) {
  const id = useId();
  const [mode, setMode] = useState<Logistics["mode"] | "unknown">(value?.mode ?? "unknown");
  const [error, setError] = useState("");
  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (mode === "unknown") { onChange?.(undefined); return; }
    const data = new FormData(event.currentTarget);
    try {
      const source = String(data.get("source") ?? "");
      const amount = String(data.get("costRub") ?? "").trim();
      if (mode === "separate" && !amount) throw new Error("Укажите сумму доставки; неизвестная сумма не равна нулю");
      onChange?.(parseDeploymentLogistics(mode === "included" ? { mode, source } : { mode, costRub: Number(amount.replace(",", ".")), source }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Проверьте условия доставки"); }
  }
  const input = "min-h-10 w-full min-w-0 rounded-md border bg-background px-3 py-2 text-sm";
  return <section aria-labelledby={`${id}-title`} className="flex min-w-0 flex-col gap-3 border-y py-5">
    <h4 id={`${id}-title`} className="block-title">Доставка полного внедрения</h4>
    <p className="max-w-3xl text-sm leading-relaxed">{deploymentLogisticsText(value)}</p>
    <p className="max-w-3xl text-sm text-muted-foreground">Одна поставка на весь выбранный сценарий. Таможенные, транспортные и страховые расходы включите в эту согласованную сумму с указанием состава. Оборудование повторно сюда не добавляйте. Смета пилота и обратная логистика пилота остаются отдельными.</p>
    {!readOnly && onChange && <details>
      <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">Уточнить условия доставки</summary>
      <form onSubmit={apply} className="mt-3 grid min-w-0 gap-4 sm:grid-cols-2">
        <label className="flex min-w-0 flex-col gap-1.5 text-sm" htmlFor={`${id}-mode`}>Учёт доставки<select id={`${id}-mode`} className={input} value={mode} onChange={event => { setMode(event.target.value as typeof mode); setError(""); }}><option value="unknown">Не оценена</option><option value="separate">Отдельный разовый платёж</option><option value="included">Включена в уже учтённую цену</option></select></label>
        {mode === "separate" && <label className="flex min-w-0 flex-col gap-1.5 text-sm" htmlFor={`${id}-cost`}>Доставка всего сценария с НДС, ₽<input id={`${id}-cost`} name="costRub" required type="number" min={0} max={1e12} step="any" defaultValue={value?.mode === "separate" ? value.costRub : undefined} className={input} /></label>}
        {mode !== "unknown" && <label className="flex min-w-0 flex-col gap-1.5 text-sm sm:col-span-2" htmlFor={`${id}-source`}>Источник и состав поставки<textarea id={`${id}-source`} name="source" required maxLength={1000} rows={2} defaultValue={value?.source ?? ""} className={input} /></label>}
        {mode === "included" && <p className="text-sm text-caution sm:col-span-2">Укажите коммерческое предложение, договор или явное допущение, в какой уже учтённый платёж входит доставка. Национальность производителя этого не подтверждает.</p>}
        {error && <p role="alert" className="text-sm text-destructive sm:col-span-2">{error}</p>}
        <button type="submit" className={buttonVariants({ variant: "outline", className: "w-fit" })}>Применить и пересчитать</button>
      </form>
    </details>}
  </section>;
}
