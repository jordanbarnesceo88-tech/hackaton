"use client";

import { useId, useState, type FormEvent } from "react";
import { buttonVariants } from "@/components/ui/button";
import type { CostPackage } from "@/lib/tz/types";

export function CostPackageEditor({ value, chargers, readOnly, onChange }: {
  value?: CostPackage; chargers: number; readOnly?: boolean; onChange?: (value: CostPackage | undefined) => void;
}) {
  const id = useId();
  const [error, setError] = useState("");
  const Container = readOnly ? "section" : "details";
  const Heading = readOnly ? "h5" : "summary";
  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const reason = String(data.get("reason") ?? "").trim();
    if (!reason) { setError("Укажите источник комплектации или явно обозначьте оценочное допущение."); return; }
    const includedChargers = Number(data.get("chargers"));
    if (!Number.isInteger(includedChargers) || includedChargers < 0 || includedChargers > chargers) { setError(`Число включённых станций должно быть целым от 0 до ${chargers}.`); return; }
    setError("");
    onChange?.({ softwareIncludedInIntegration: data.has("software"), repairsIncludedInService: data.has("repair"), includedChargers, reason });
  }
  return <Container className="min-w-0 border-t pt-3">
    <Heading className="cursor-pointer text-sm font-medium">Комплектация и границы платежей</Heading>
    <p className="mt-3 max-w-3xl text-sm leading-relaxed">{value ? `ПО ${value.softwareIncludedInIntegration ? "включено в интеграцию" : "оплачивается отдельно"}; ремонт ${value.repairsIncludedInService ? "включён в сервис" : "вне сервисного договора"}; ${value.includedChargers} из ${chargers} зарядок включены в оборудование. Основание: ${value.reason}` : "Исходное допущение: ПО, интеграция, зарядные станции и ремонт вне сервиса оплачиваются отдельно. Состав конкретного предложения поставщика не подтверждён."}</p>
    <p className="mt-2 max-w-3xl text-xs text-muted-foreground">Отмечайте включение только по составу предложения или явно указанному допущению. Обзорная статья производителя не заменяет коммерческое предложение. АКБ, расходные материалы и диспетчеризация остаются самостоятельными условиями.</p>
    {!readOnly && onChange && <form onSubmit={apply} className="mt-4 flex min-w-0 flex-col gap-4">
      <label className="flex items-start gap-2 text-sm"><input name="software" type="checkbox" defaultChecked={value?.softwareIncludedInIntegration ?? false} className="mt-0.5" />ПО уже включено в стоимость интеграции</label>
      <label className="flex items-start gap-2 text-sm"><input name="repair" type="checkbox" defaultChecked={value?.repairsIncludedInService ?? false} className="mt-0.5" />Ремонт уже включён в стоимость сервисного обслуживания</label>
      <label htmlFor={`${id}-chargers`} className="flex max-w-xl flex-col gap-1.5 text-sm">Зарядных станций уже включено в цену оборудования<input id={`${id}-chargers`} name="chargers" type="number" required min={0} max={chargers} step={1} defaultValue={value?.includedChargers ?? 0} className="h-10 w-full rounded-md border bg-background px-3 text-sm" /></label>
      <label htmlFor={`${id}-reason`} className="flex max-w-3xl flex-col gap-1.5 text-sm">Источник / основание комплектации<textarea id={`${id}-reason`} name="reason" rows={2} required maxLength={1000} defaultValue={value?.reason ?? ""} className="w-full rounded-md border bg-background px-3 py-2 text-sm" /></label>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2"><button type="submit" className={buttonVariants({ variant: "outline" })}>Применить комплектацию</button>{value && <button type="button" className={buttonVariants({ variant: "ghost" })} onClick={() => onChange(undefined)}>Вернуть исходные отдельные статьи</button>}</div>
    </form>}
  </Container>;
}
