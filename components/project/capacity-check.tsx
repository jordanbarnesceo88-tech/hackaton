"use client";

import { Button } from "@/components/ui/button";
import { formatNum } from "@/lib/format/rub";
import { capacityDisplayRows, capacityNominalDisplayRows } from "@/lib/sim/capacity-presentation";
import { capacityEvidenceQualifies, capacityProofMatchesInput } from "@/lib/sim/spatial-evidence";
import type { SimInput } from "@/lib/sim/types";
import type { SpatialEvidence } from "@/lib/tz/types";

export function CapacityCheck({ evidence, expectedInput, fresh, onRequest, archived = false }: {
  evidence: SpatialEvidence;
  expectedInput?: SimInput | null;
  fresh: boolean;
  onRequest?: () => void;
  archived?: boolean;
}) {
  const proof = evidence.capacityProof;
  const current = !archived && fresh && capacityProofMatchesInput(proof, expectedInput);
  const measured = proof?.terminal && proof.status !== "NOT_EVALUATED";
  const passed = !archived && fresh && capacityEvidenceQualifies(evidence, expectedInput);
  return <section className="grid min-w-0 gap-3 border-y border-border py-4" aria-label="Контролируемая проверка мощности" data-capacity-status={proof?.status ?? "NOT_REQUESTED"}>
    <h4 className="text-sm font-semibold">Проверка целевой мощности</h4>
    <p className="text-sm">Номинальный прогон: <strong>{evidence.assessment.status}</strong>. {evidence.assessment.status === "NOT_EVALUATED" ? "Выпуск не оценён." : `Доставлено ${formatNum(evidence.summary.achievedPerH, 2)} из ${formatNum(evidence.summary.requiredPerH, 2)} пал./ч.`}</p>
    {proof ? <>
      <p className="text-sm font-semibold">{archived ? `Сохранённый тест: ${proof.status === "PASS" ? "критерии выполнены" : proof.status === "FAIL" ? "критерии не выполнены" : "результат не оценён"}` : passed ? "Целевая мощность подтверждена контролируемым модельным тестом" : proof.status === "NOT_EVALUATED" ? "Контролируемая проверка мощности не выполнена" : !current ? "Сохранённый тест не подтверждает текущие условия" : proof.status === "PASS" ? "Тест достиг целевой мощности; номинальная работа требует разбора" : "Контролируемый тест не подтвердил целевую мощность"}</p>
      <p className="text-sm">{proof.reason ?? "Обоснование не сохранено."}</p>
      {measured ? <dl className="grid gap-3 text-sm tabular-nums sm:grid-cols-3">
        <div><dt className="text-xs text-muted-foreground">Доставки когорты / цель, пал./ч</dt><dd className="m-0 font-semibold">{formatNum(proof.metrics.deliveredCohortPerH, 2)} / {formatNum(proof.metrics.requiredPerH, 2)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Полные циклы / цель, пал./ч</dt><dd className="m-0 font-semibold">{formatNum(proof.metrics.closedCohortPerH, 2)} / {formatNum(proof.metrics.requiredPerH, 2)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Тестовая подача, пал./ч</dt><dd className="m-0 font-semibold">{formatNum(proof.metrics.offeredPerH, 2)}</dd></div>
      </dl> : <p className="text-sm text-muted-foreground">Выпуск и незавершённые работы тестом не оценены.</p>}
      {passed && <p className="text-sm">Конфигурацию можно рассматривать как кандидата для целевой мощности в условиях этого теста. Финансовый вывод и результат номинального прогона приведены отдельно.</p>}
      <details className="min-w-0 text-sm"><summary className="cursor-pointer py-2">Условия теста и незавершённые работы</summary>
        <dl className="grid gap-3 py-2">{[...capacityNominalDisplayRows(evidence.capacityNominalReview), ...capacityDisplayRows(proof)].map((row, index) => <div key={`${row.label}:${index}`} className="min-w-0"><dt className="text-xs text-muted-foreground">{row.label}</dt><dd className="m-0 break-words">{typeof row.value === "number" ? formatNum(row.value, 2) : row.value}{row.unit ? ` ${row.unit}` : ""}</dd></div>)}</dl>
      </details>
    </> : <p className="text-sm">Проверим полные циклы на периодической подаче 110% от исходной цели: 15 минут прогрева и 120 минут измерения. Возвраты пустых носителей входят в работу; обычный прогон сохраняет свой результат. Запас подачи 10% — условие теста, а не норматив заказчика.</p>}
    {onRequest && <Button type="button" variant="outline" className="h-auto min-h-11 w-fit max-w-full whitespace-normal text-left" onClick={onRequest} disabled={!fresh}>{proof ? "Повторить проверку мощности на сервере" : "Проверить целевую мощность на сервере"}</Button>}
  </section>;
}
