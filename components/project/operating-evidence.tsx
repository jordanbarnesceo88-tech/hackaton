"use client";

import { useId } from "react";
import type { ItemResult, ProductForCalc } from "@/lib/tz/types";
import { measuredThroughput } from "@/lib/catalog/operating-evidence";
import { formatNum } from "@/lib/format/rub";

const modeLabels: Record<string, string> = { scrubbing: "Влажная мойка", sweeping: "Подметание", vacuuming: "Уборка пылесосом", mopping: "Сухая протирка", transport: "Перевозка", disinfection: "Дезинфекция" };

export function OperatingEvidencePanel({ product, result, mode, onMode }: {
  product?: ProductForCalc; result?: ItemResult; mode?: string; onMode?: (value: string | undefined) => void;
}) {
  const id = useId();
  const evidence = product?.operatingEvidence;
  if (!evidence) return <p className="text-xs text-muted-foreground">Полевой замер не предоставлен. Паспортная норма и расчётный цикл показаны как исходные данные модели.</p>;
  return <section className="grid gap-2 border-t pt-3 text-sm" aria-label="Паспорт и эксплуатационный замер">
    <p className="font-medium">Паспорт и эксплуатационный замер</p>
    <p>{evidence.confirmed && product?.operatingEvidenceConfirmed ? "Запись замера подтверждена." : "Запись замера не подтверждена и не используется как эксплуатационный факт."}</p>
    <p>На участке «{evidence.site}» наблюдалось {formatNum(measuredThroughput(evidence), 2)} {evidence.unit}, {evidence.basis === "shift-hour" ? "за час смены со всеми простоями" : "за час чистой работы"}. Режим: {modeLabels[evidence.mode] ?? evidence.mode}.</p>
    <p className="text-xs text-muted-foreground">Измерено {evidence.measuredAt}, проверено {evidence.verifiedAt}, повторов {evidence.samples}. {evidence.validUntil ? `Применимость до ${evidence.validUntil}.` : "Срок применимости не задан; подтвердите актуальность перед пилотом."} Источник: {evidence.sourceRef}; измерил: {evidence.measuredBy}. {product?.operatingEvidenceEvaluatedOn ? `Дата оценки: ${product.operatingEvidenceEvaluatedOn}.` : "Дата оценки не зафиксирована."}</p>
    <p className="text-xs">{result?.thrEvidence?.reason ?? "Совпадение процесса, объекта, единиц и режима будет проверено при расчёте; паспортные значения не заменяются замером."}</p>
    {onMode ? <label className="grid max-w-md gap-1" htmlFor={id}>Режим сценария для сопоставления замера
      <select id={id} value={mode ?? ""} onChange={event => onMode(event.target.value || undefined)} className="min-h-11 rounded-md border bg-background px-3">
        <option value="">Не выбран — замер не применять</option>
        <option value={evidence.mode}>{modeLabels[evidence.mode] ?? evidence.mode}</option>
        {mode && mode !== evidence.mode && <option value={mode}>{modeLabels[mode] ?? mode}</option>}
      </select>
    </label> : <p className="text-xs">Режим сценария: {mode ? modeLabels[mode] ?? mode : "не выбран; автоматического применения замера нет"}.</p>}
    {evidence.sourceUrl && <a className="text-xs text-primary underline" href={evidence.sourceUrl} target="_blank" rel="noopener noreferrer">Источник замера ↗</a>}
  </section>;
}
