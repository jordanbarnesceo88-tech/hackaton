"use client";

import { useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { formatNum } from "@/lib/format/rub";
import { parseCostPackage } from "@/lib/tz/econ/cost-package";
import type { CostPackage, RaasCharge } from "@/lib/tz/types";
import { draftChecked, draftText, readEditorFormDraft, type EditorDraftBindings, type EditorFormDraft } from "./editor-draft";

const CHARGES = [
  ["startup", "Разовый запуск: интеграция, пусконаладка и обучение", "₽ разово"],
  ["platformMonthly", "Ежемесячная платформа / лицензия", "₽/мес"],
] as const;
type ChargeKey = typeof CHARGES[number][0];

/** Parse the entire form so editing older controls preserves the newer package scope. */
export function parseCostPackageForm(data: FormData, chargers: number): CostPackage {
  const allChargersIncluded = data.has("allChargers");
  const rawChargers = String(data.get("chargers") ?? "").trim();
  const includedChargers = allChargersIncluded ? 0 : rawChargers ? Number(rawChargers) : NaN;
  if (!Number.isSafeInteger(chargers) || chargers < 0 || chargers > 2000 || !Number.isSafeInteger(includedChargers) || includedChargers < 0 || includedChargers > chargers) {
    throw new Error(`Число включённых станций должно быть целым от 0 до ${chargers}.`);
  }
  const draft: Record<string, unknown> = {
    softwareIncludedInIntegration: data.has("software"), repairsIncludedInService: data.has("repair"),
    includedChargers, reason: String(data.get("reason") ?? "").trim(),
    ...(allChargersIncluded ? { allChargersIncluded: true } : {}),
  };
  for (const [key] of CHARGES) {
    const mode = data.get(`${key}-mode`);
    if (mode === "legacy") continue;
    const amount = String(data.get(`${key}-amount`) ?? "").trim();
    draft[key] = mode === "separate" ? {
      mode, amountRub: amount ? Number(amount) : NaN, basis: data.get(`${key}-basis`),
    } : { mode };
  }
  return parseCostPackage(draft);
}

function chargeSummary(value: RaasCharge | undefined, monthly: boolean): string {
  if (!value) return "Исходные отдельные статьи расчёта; состав предложения не уточнён.";
  if (value.mode === "included") return "Включено в стоимость по указанному основанию; отдельный платёж не начисляется.";
  if (value.mode === "unassessed") return "Не оценено — финансовый расчёт остановится до уточнения стоимости.";
  const amount = `${formatNum(value.amountRub, 2)} ₽`;
  if (monthly) return value.basis === "per-robot"
    ? `${amount}/мес за каждого робота; годовая сумма = ставка × 12 × число роботов.`
    : `${amount}/мес за всю площадку; годовая сумма = ставка × 12, без умножения на число роботов.`;
  return value.basis === "per-robot" ? `${amount} разово за каждого робота.` : `${amount} разово за всю площадку.`;
}

function ChargeFields({ name, title, unit, value, draft }: { name: ChargeKey; title: string; unit: string; value?: RaasCharge; draft?: EditorFormDraft }) {
  const id = useId();
  const [mode, setMode] = useState(() => draftText(draft, `${name}-mode`, value?.mode ?? "legacy"));
  return <fieldset className="grid min-w-0 gap-3 border-t pt-3">
    <legend className="px-0 text-sm font-medium">{title}</legend>
    <div className="grid min-w-0 gap-3 sm:grid-cols-3">
      <div className="grid min-w-0 content-start gap-1 text-sm"><label htmlFor={`${id}-mode`}>Как учитывается платёж</label>
        <select id={`${id}-mode`} name={`${name}-mode`} value={mode} onChange={event => setMode(event.target.value as typeof mode)} className="field min-h-11 w-full min-w-0">
          <option value="legacy">Исходные отдельные статьи</option><option value="included">Включён в стоимость</option>
          <option value="separate">Отдельная плата / оценка</option><option value="unassessed">Не оценено</option>
        </select>
      </div>
      {mode === "separate" && <>
        <div className="grid min-w-0 content-start gap-1 text-sm"><label htmlFor={`${id}-amount`}>{unit}</label>
          <input id={`${id}-amount`} name={`${name}-amount`} type="number" min={0} max={1e12} step="any" required inputMode="decimal" defaultValue={draftText(draft, `${name}-amount`, value?.mode === "separate" ? value.amountRub : "")} className="field min-h-11 w-full min-w-0" />
        </div>
        <div className="grid min-w-0 content-start gap-1 text-sm"><label htmlFor={`${id}-basis`}>База начисления</label>
          <select id={`${id}-basis`} name={`${name}-basis`} defaultValue={draftText(draft, `${name}-basis`, value?.mode === "separate" ? value.basis : "per-robot")} className="field min-h-11 w-full min-w-0">
            <option value="per-robot">За каждого робота</option><option value="per-site">За всю площадку</option>
          </select>
        </div>
      </>}
    </div>
    <p className="text-xs text-muted-foreground">{name === "startup" ? "Явный запуск заменяет исходные статьи интеграции, пусконаладки и обучения, а не добавляется к ним." : "Явная ежемесячная платформа заменяет исходную годовую оценку лицензии. При плате за площадку не умножайте её на парк."}</p>
  </fieldset>;
}

export function CostPackageEditor({ value, chargers, readOnly, onChange, draft, onDraftChange }: EditorDraftBindings & {
  value?: CostPackage; chargers: number; readOnly?: boolean; onChange?: (value: CostPackage | undefined) => void;
}) {
  const id = useId();
  const [error, setError] = useState("");
  const [allChargers, setAllChargers] = useState(() => draftChecked(draft, "allChargers", value?.allChargersIncluded ?? false));
  const [fixedChargers, setFixedChargers] = useState(() => draftText(draft, "chargers", value?.includedChargers ?? 0));
  const editable = !readOnly && Boolean(onChange);
  const Container = editable ? "details" : "section";
  const Heading = editable ? "summary" : "h5";
  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try { const parsed = parseCostPackageForm(new FormData(event.currentTarget), chargers); onChange?.(parsed); onDraftChange?.(null); setError(""); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Проверьте состав ценового пакета."); }
  }
  return <Container data-cost-package className="min-w-0 border-t pt-3">
    <Heading className="min-h-11 content-center text-sm font-medium">Комплектация и границы платежей</Heading>
    {value ? <dl className="mt-3 grid min-w-0 gap-3 text-sm">
      <div><dt className="text-xs text-muted-foreground">Разовое ПО и ремонт</dt><dd>ПО {value.softwareIncludedInIntegration ? "включено в интеграцию / запуск" : "оплачивается отдельно"}; ремонт {value.repairsIncludedInService ? "включён в сервис" : "вне сервисного договора"}.</dd></div>
      <div><dt className="text-xs text-muted-foreground">Зарядные станции</dt><dd>{value.allChargersIncluded ? `Все необходимые станции включены в оборудование (сейчас ${chargers}); фиксированное число в данных — 0.` : `${value.includedChargers} из ${chargers} станций включены в оборудование; остальные оплачиваются отдельно.`}</dd></div>
      {CHARGES.map(([key, title]) => <div key={key} className="min-w-0 break-words"><dt className="text-xs text-muted-foreground">{title}</dt><dd>{chargeSummary(value[key], key === "platformMonthly")}</dd></div>)}
      <div className="min-w-0 break-words"><dt className="text-xs text-muted-foreground">Источник / основание комплектации</dt><dd className="whitespace-pre-wrap">{value.reason}</dd></div>
    </dl> : <p className="mt-3 max-w-3xl text-sm leading-relaxed">Исходное допущение: ПО, интеграция, зарядные станции и ремонт вне сервиса оплачиваются отдельно. Состав конкретного предложения поставщика не подтверждён.</p>}
    <p className="mt-2 max-w-3xl text-xs text-muted-foreground">Отмечайте включение только по составу предложения или явно указанному допущению. Обзорная статья производителя не заменяет коммерческое предложение. Разовое ПО и ежемесячная платформа — разные статьи. АКБ, расходные материалы и диспетчеризация остаются самостоятельными условиями.</p>
    {editable && <form onSubmit={apply} onChange={event => onDraftChange?.(readEditorFormDraft(event.currentTarget))} className="mt-4 grid max-w-3xl min-w-0 gap-4">
      <label htmlFor={`${id}-software`} className="flex min-h-11 items-center gap-3 text-sm"><input id={`${id}-software`} name="software" type="checkbox" defaultChecked={draftChecked(draft, "software", value?.softwareIncludedInIntegration ?? false)} className="size-4 shrink-0 accent-primary" />Разовое ПО уже включено в стоимость интеграции / запуска</label>
      <label htmlFor={`${id}-repair`} className="flex min-h-11 items-center gap-3 text-sm"><input id={`${id}-repair`} name="repair" type="checkbox" defaultChecked={draftChecked(draft, "repair", value?.repairsIncludedInService ?? false)} className="size-4 shrink-0 accent-primary" />Ремонт уже включён в стоимость сервисного обслуживания</label>
      <label htmlFor={`${id}-all-chargers`} className="flex min-h-11 items-center gap-3 text-sm"><input id={`${id}-all-chargers`} name="allChargers" type="checkbox" checked={allChargers} onChange={event => setAllChargers(event.target.checked)} className="size-4 shrink-0 accent-primary" />Все необходимые зарядные станции включены в цену оборудования</label>
      <div className="grid max-w-xl gap-1.5 text-sm"><label htmlFor={`${id}-chargers`}>Фиксированное число станций, включённых в цену оборудования</label>
        <input id={`${id}-chargers`} name="chargers" type="number" required={!allChargers} disabled={allChargers} min={0} max={chargers} step={1} value={allChargers ? "0" : fixedChargers} onChange={event => setFixedChargers(event.target.value)} className="field min-h-11 w-full" />
      </div>
      {allChargers && <p className="text-xs text-muted-foreground">Включены все станции, которые потребуются расчётному парку (сейчас {chargers}). В данных фиксированное число записывается как 0; это не отсутствие включённых станций.</p>}
      {CHARGES.map(([name, title, unit]) => <ChargeFields key={name} name={name} title={title} unit={unit} value={value?.[name]} draft={draft} />)}
      <div className="grid min-w-0 gap-1.5 text-sm"><label htmlFor={`${id}-reason`}>Источник / основание комплектации</label>
        <textarea id={`${id}-reason`} name="reason" rows={3} required maxLength={1000} defaultValue={draftText(draft, "reason", value?.reason ?? "")} className="field w-full min-w-0" />
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2"><Button type="submit" variant="outline" className="h-auto min-h-11 max-w-full whitespace-normal">Применить комплектацию</Button>{value && <Button type="button" variant="ghost" className="h-auto min-h-11 max-w-full whitespace-normal" onClick={() => { onChange?.(undefined); onDraftChange?.(null); }}>Вернуть исходные отдельные статьи</Button>}</div>
    </form>}
  </Container>;
}
