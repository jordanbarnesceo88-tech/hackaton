"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatNum } from "@/lib/format/rub";
import { buildCleaningSelectionScenarios, compareCleaningOptions, type CleaningSelectionInput, type CleaningSelectionQuote, type CleaningSelectionRow } from "@/lib/tz/cleaning-selection";
import type { CleaningProfile, ScenarioSpec } from "@/lib/tz/types";
import { CleaningProfileEditor } from "./cleaning-profile";
import { CostPackageEditor } from "./cost-package";
import { RaasPackageEditor } from "./raas-package";

export type CleaningSelectionPanelProps = CleaningSelectionInput & {
  readOnly?: boolean; onApply: (specs: ScenarioSpec[]) => void;
  onWindowChange?: (hours: number) => void; onLabourShareChange?: (share: number) => void;
};
type QuoteDraft = { purchase: string; raas: string; source: string };

/** An explicit local action: rendering or editing a quote never posts or saves a project. */
export function applyCleaningSelection(row: CleaningSelectionRow, onApply: (specs: ScenarioSpec[]) => void): string {
  try { onApply(buildCleaningSelectionScenarios(row)); return `Добавлены покупка и RaaS: ${row.productName}. Проверьте цены и состав затрат перед сохранением.`; }
  catch (error) { return error instanceof Error ? error.message : "Модель нельзя применить"; }
}

export function CleaningSelectionPanel(props: CleaningSelectionPanelProps) {
  const id = useId();
  const [profiles, setProfiles] = useState<Record<string, CleaningProfile | undefined>>({ ...props.profiles });
  const [quotes, setQuotes] = useState<Record<string, CleaningSelectionQuote | undefined>>({ ...props.quotes });
  const [drafts, setDrafts] = useState<Record<string, QuoteDraft>>({});
  const [windowH, setWindowH] = useState(String(props.windowH ?? 8));
  const [labourPct, setLabourPct] = useState(String((props.automatableLabourShare ?? 0.5) * 100));
  const [message, setMessage] = useState("");
  if (props.readOnly) return <section className="grid gap-2 border-t pt-4" aria-label="Сравнение уборочных роботов"><h3>Сравнение уборочных роботов</h3><p className="text-sm text-muted-foreground">Архив открыт без пересчёта. Сохранённые профили и результаты показаны в сценариях; новое сравнение выполняется только в режиме редактирования.</p></section>;
  const commonWindow = props.onWindowChange ? props.windowH ?? 8 : Number(windowH);
  const commonLabour = props.onLabourShareChange ? props.automatableLabourShare ?? 0.5 : Number(labourPct) / 100;
  const rows = compareCleaningOptions({ ...props, profiles, quotes, windowH: commonWindow, automatableLabourShare: commonLabour });
  function updateDraft(row: CleaningSelectionRow, patch: Partial<QuoteDraft>) {
    setDrafts(previous => ({ ...previous, [row.productSlug]: { purchase: row.purchase.priceRub === null ? "" : String(row.purchase.priceRub), raas: row.raas.priceRub === null ? "" : String(row.raas.priceRub), source: quotes[row.productSlug]?.source ?? "", ...previous[row.productSlug], ...patch } }));
  }
  function applyQuote(row: CleaningSelectionRow) {
    const draft = drafts[row.productSlug];
    if (!draft) return;
    const value = (raw: string) => raw.trim() ? Number(raw.replace(",", ".")) : undefined;
    const purchaseRub = value(draft.purchase), raasRubMonth = value(draft.raas);
    if ([purchaseRub, raasRubMonth].some(price => price !== undefined && (!Number.isFinite(price) || price <= 0 || price > 1e12)) || !draft.source.trim() || draft.source.length > 1000) {
      setMessage("Укажите положительные цены и источник или основание оценки. Пустая цена остаётся неизвестной, ноль не принимается."); return;
    }
    setQuotes(previous => ({ ...previous, [row.productSlug]: { ...previous[row.productSlug], purchaseRub, raasRubMonth, source: draft.source.trim() } }));
    setMessage(`Цены ${row.productName} приняты для локального сравнения; проект ещё не изменён.`);
  }
  return <section className="grid min-w-0 gap-4 border-t pt-4" aria-label="Сравнение уборочных роботов">
    <header className="grid gap-2"><h3>Сравнить три уборочных робота</h3>
      <p className="max-w-4xl text-sm text-muted-foreground">Одинаковые площадь, кратность и труд — из параметров объекта; общее рабочее окно и доля роботизируемого труда — ниже. Цикл, уход и выработка редактируются по каждой модели. Это расчёт расписания, не подтверждение качества уборки или 3D-проверка.</p>
      <p className="text-xs text-muted-foreground">Резерв парка: {formatNum(props.norms.reservePct * 100, 1)}%. На каждого робота нужна отдельная зарядная станция. Финансовые места сравниваются отдельно для покупки и RaaS; отрицательный NPV не становится рекомендацией.</p>
    </header>
    {!props.readOnly && <div className="grid max-w-xl gap-3 sm:grid-cols-2">
      <label htmlFor={`${id}-window`} className="grid gap-1 text-sm">Общее окно уборки, ч
        <input id={`${id}-window`} type="number" min={1 / 60} max={24} step="any" className="field min-h-11 w-full" value={props.onWindowChange ? String(commonWindow) : windowH} onChange={event => { setWindowH(event.target.value); props.onWindowChange?.(Number(event.target.value)); }} />
      </label>
      <label htmlFor={`${id}-labour`} className="grid gap-1 text-sm">Доля труда, относящаяся к роботизируемой уборке, %
        <input id={`${id}-labour`} type="number" min={0} max={100} step="any" className="field min-h-11 w-full" value={props.onLabourShareChange ? String(commonLabour * 100) : labourPct} onChange={event => { setLabourPct(event.target.value); props.onLabourShareChange?.(Number(event.target.value) / 100); }} />
      </label>
    </div>}
    {rows.map(row => <article key={row.productSlug} className="grid min-w-0 gap-3 border p-4" aria-label={row.productName}>
      <header className="flex flex-wrap items-baseline justify-between gap-2"><h4>{row.productName}</h4><p className="text-sm font-medium">{row.status === "candidate" ? "Сравним по рабочему профилю" : "Исключён из текущего подбора"}</p></header>
      {row.reasons.map(reason => <p key={reason} className="text-sm text-destructive">{reason}</p>)}
      {row.day && <p className="text-sm">Активно {formatNum(row.day.activeHoursPerDay, 2)} ч; {formatNum(row.day.capacityM2PerDay, 0)} м²/робот/день. Требуется {row.quantity ?? "—"} роботов и {row.chargers ?? "—"} станций; спрос {row.demandM2PerDay === null ? "—" : formatNum(row.demandM2PerDay, 0)} м²/день. Уход: {row.careFte === null ? "—" : formatNum(row.careFte, 2)} ставки.</p>}
      <p className="text-xs text-muted-foreground">{row.profileBasis === "evidence-capped" ? "Выработка ограничена сопоставимым подтверждённым замером; цикл и уход остаются оценками." : "Рабочие допущения, не паспортный максимум и не замеры вашего объекта."} {row.evidence.reason}</p>
      {row.warnings.map(warning => <p key={warning} className="text-xs text-muted-foreground">{warning}</p>)}
      <div className="grid gap-3 md:grid-cols-2">{(["purchase", "raas"] as const).map(kind => <div key={kind} className="grid content-start gap-1 text-sm">
        <p className="font-medium">{kind === "purchase" ? "Покупка" : "RaaS"}: {row[kind].priceRub === null ? "цена не задана" : `${formatNum(row[kind].priceRub, 0)} ₽${kind === "raas" ? "/мес за робота" : " за робота"}`}</p>
        <p>{row[kind].result?.status === "ok" && row[kind].result.npvRub !== null ? `NPV ${formatNum(row[kind].result.npvRub, 0)} ₽${row[kind].rank === null ? "" : ` · место ${row[kind].rank} среди рассчитанных вариантов`}` : "Финансовый вариант не ранжируется"}</p>
        <p className="text-xs text-muted-foreground">{row[kind].reason}</p>
      </div>)}</div>
      {!props.readOnly && <details className="min-w-0"><summary className="tap-target cursor-pointer text-sm font-medium">Цены и условия — {row.productName}</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">{(["purchase", "raas"] as const).map(kind => <label key={kind} htmlFor={`${id}-${row.productSlug}-${kind}`} className="grid gap-1 text-sm">{kind === "purchase" ? "Цена покупки, ₽ за робота" : "RaaS, ₽/мес за робота"}
          <input id={`${id}-${row.productSlug}-${kind}`} type="number" min={0.01} max={1e12} step="any" className="field min-h-11 w-full" value={drafts[row.productSlug]?.[kind] ?? (row[kind].priceRub === null ? "" : String(row[kind].priceRub))} placeholder="Неизвестно" onChange={event => updateDraft(row, { [kind]: event.target.value })} />
        </label>)}</div>
        <label htmlFor={`${id}-${row.productSlug}-source`} className="mt-3 grid gap-1 text-sm">Источник цен / основание рабочей оценки
          <textarea id={`${id}-${row.productSlug}-source`} rows={2} maxLength={1000} className="field w-full" value={drafts[row.productSlug]?.source ?? quotes[row.productSlug]?.source ?? ""} onChange={event => updateDraft(row, { source: event.target.value })} />
        </label>
        <Button type="button" variant="outline" className="mt-3" onClick={() => applyQuote(row)}>Применить цены к сравнению</Button>
        <p className="mt-2 text-xs text-muted-foreground">Неизвестная цена не равна нулю. Прочие затраты покупки оцениваются действующими нормативами, пока не задан состав поставки. Для нового RaaS все услуги изначально не оценены — задайте состав ниже.</p>
        <CostPackageEditor value={quotes[row.productSlug]?.costPackage ?? row.specs.find(spec => spec.kind === "purchase")?.items[0]?.costPackage} chargers={row.chargers ?? 0} onChange={value => setQuotes(previous => ({ ...previous, [row.productSlug]: { ...previous[row.productSlug], source: previous[row.productSlug]?.source || value?.reason || "Оценка состава поставки", costPackage: value } }))} />
        <RaasPackageEditor value={quotes[row.productSlug]?.raasPackage ?? row.specs.find(spec => spec.kind === "raas")?.items[0]?.raasPackage} recurringRubMonth={row.raas.priceRub} onChange={value => setQuotes(previous => ({ ...previous, [row.productSlug]: { ...previous[row.productSlug], source: previous[row.productSlug]?.source || value?.reason || "Оценка состава RaaS", raasPackage: value } }))} />
      </details>}
      <CleaningProfileEditor productSlug={row.productSlug} value={row.profile ?? undefined} readOnly={props.readOnly} onChange={props.readOnly ? undefined : value => {
        setProfiles(previous => ({ ...previous, [row.productSlug]: value }));
        if (value) { setWindowH(String(value.windowH)); setLabourPct(String(value.automatableLabourShare * 100)); props.onWindowChange?.(value.windowH); props.onLabourShareChange?.(value.automatableLabourShare); }
      }} />
      {!props.readOnly && <Button type="button" variant="outline" disabled={row.status !== "candidate"} onClick={() => setMessage(applyCleaningSelection(row, props.onApply))}>Добавить покупку и RaaS — {row.productName}</Button>}
    </article>)}
    {message && <p role="status" className="text-sm">{message}</p>}
  </section>;
}
