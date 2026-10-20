import type { SimInput, SimSummaryStored } from "@/lib/sim/types";
import type { ProjectModel } from "@/lib/tz/model";
import type { ParamSpec, ParamValues } from "@/lib/tz/types";
import { formatNum, formatRub } from "@/lib/format/rub";
import { Button } from "@/components/ui/button";
import { DecisionSummary } from "./decision-summary";
import { stepHeading } from "./step-nav";

/** The executive view reads the same model and never creates another calculation. */
export function WorkspaceOverview({ step, model, scenarioKey, params, defs, stale, archived = false, expectedInput, simSummary, onDetails }: {
  step: number; model: ProjectModel; scenarioKey?: string; params: ParamValues;
  defs: readonly ParamSpec[]; stale: boolean; archived?: boolean; expectedInput?: SimInput | null; simSummary?: SimSummaryStored | null; onDetails: () => void;
}) {
  const selected = model.scenarios.find(s => s.key === scenarioKey);
  const summaries: Record<number, string> = {
    1: "Объект и состав выполняемой работы. Подробный режим содержит все процессы и источники.",
    2: "Основные условия расчёта. Для изменения параметров откройте подробности этого шага.",
    3: "Выбранное оборудование. В подробностях доступны кандидаты, причины исключения и рабочие профили.",
    4: "Сравнение решений проводится на одинаковой нагрузке. Технические характеристики и источники доступны в подробностях.",
    5: "Финансовый результат выбранного сценария с отдельной оценкой выполнения нагрузки.",
    6: "Варианты на одном объёме работ. Показатели относятся к сохранённым условиям расчёта.",
    7: "Итог проверки нагрузки. Просмотр модели, расписание и причины ограничений доступны в подробностях.",
    8: "Результат и следующий шаг. План пилота, его фактические результаты, сохранение и выгрузки доступны в подробностях.",
  };
  const keyParams = defs.filter(def => /AreaM2|cleaningsPerDay|Count$|SalaryRubMonth|workingDaysYear|shiftsPerDay|hoursPerShift/.test(def.key)).slice(0, 12);
  return <section className="grid min-w-0 gap-5" aria-label="Краткий вид текущего шага" data-workspace-overview={step}>
    <header className="grid gap-2"><h2 tabIndex={-1}>{stepHeading(step)}</h2><p className="text-sm text-muted-foreground">{summaries[step]}</p></header>
    {stale && <p className="callout" data-tone="warn">Условия изменены. До пересчёта вывод относится к предыдущим данным.</p>}
    {step === 2 ? <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">{keyParams.map(def => <div key={def.key}><dt className="text-xs text-muted-foreground">{def.label}{def.unit ? `, ${def.unit}` : ""}</dt><dd className="mt-1 font-semibold">{params[def.key] === null || params[def.key] === undefined ? "Не задано" : typeof params[def.key] === "number" ? formatNum(params[def.key] as number, 2) : String(params[def.key])}</dd></div>)}</dl>
      : step <= 4 ? <div className="grid gap-3 text-sm"><p><strong>Сценарий:</strong> {selected?.name ?? "Не выбран"}</p><ul className="grid list-disc gap-2 pl-5">{selected?.items.map(item => <li key={`${item.process}:${item.productSlug}`}>{model.productSnapshots[item.productSlug]?.name ?? item.productSlug}{item.quantityOverride ? ` — ${item.quantityOverride} шт.` : " — парк определяется расчётом"}</li>)}</ul><p className="text-muted-foreground">{model.conclusion.headline}</p></div>
      : step === 6 ? <div className="grid gap-4">{model.results.map(row => <div key={row.key} className="grid gap-1 border-b border-border pb-3 text-sm"><h3 className="font-semibold">{row.name}</h3>{row.status === "ok" ? <p>Вложения {formatRub(row.capexRub)} · OPEX {formatRub(row.opexYearRub)}/год · NPV {formatRub(row.npvRub)} · окупаемость {row.paybackYears === null ? "не достигается" : `${formatNum(row.paybackYears, 1)} лет`}</p> : <p className="text-muted-foreground">Недостаточно применимых данных для расчёта. Причина указана в подробностях.</p>}</div>)}</div>
      : archived ? <div className="grid gap-2 text-sm"><p>Сохранённый вывод модели {model.modelVersion}</p><p>{model.conclusion.headline}</p><ul className="list-disc pl-5">{model.conclusion.bullets.map((text, index) => <li key={index}>{text}</li>)}</ul></div> : <DecisionSummary model={model} scenarioKey={scenarioKey} stale={stale} expectedInput={expectedInput} simSummary={simSummary} />}
    <Button type="button" variant="outline" className="w-fit min-h-11" onClick={onDetails}>Открыть подробности этого шага</Button>
  </section>;
}
