"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNum, formatRub } from "@/lib/format/rub";
import { formatYearsRu } from "@/lib/format/plural";
import type { SimInput, SimSummaryStored } from "@/lib/sim/types";
import { buildDecision, type DecisionModel } from "@/lib/tz/decision";

export type DecisionSummaryProps = {
  model: DecisionModel;
  scenarioKey?: string;
  stale?: boolean;
  expectedInput?: SimInput | null;
  simSummary?: SimSummaryStored | null;
  onCompare?: () => void;
  onSimulation?: () => void;
  onPilot?: () => void;
};

export function DecisionSummary({ model, scenarioKey, stale = false, expectedInput, simSummary, onCompare, onSimulation, onPilot }: DecisionSummaryProps) {
  const d = buildDecision(model, scenarioKey, expectedInput, stale, simSummary), e = d.spatial.evidence, f = d.finance;
  const spatial = d.verification.kind === "spatial", analytical = d.verification.kind === "analytical";
  const metrics = d.verification.metrics, unit = d.processes.length === 1 ? d.processes[0]!.unit : "ед./ч";
  const tone = d.status === "suitable" ? "ok" : ["invalid", "refused"].includes(d.status) ? "crit" : ["missing", "baseline", "unverified"].includes(d.status) ? "info" : "warn";
  const pct = (value: number) => `${formatNum(value * 100, 1)} %`;
  const statusLabel = d.status === "suitable" ? "Критерии выполнены" : d.status === "partial" ? "Есть ограничения" : d.status === "financial-limit" ? "Экономика не сходится" : d.status === "stale" ? "Требуется пересчёт" : d.status === "unsupported" ? "Нет применимой модели" : d.status === "unverified" ? "Проверка не завершена" : d.status === "baseline" ? "База сравнения" : "Требуется проверка";
  const needsSimulation = !["suitable", "financial-limit", "baseline", "missing", "refused"].includes(d.status);
  return (
    <Card className="decision-summary min-w-0" data-decision-status={d.status} data-tone={tone}>
      <CardHeader className="flex flex-wrap items-center justify-between gap-3"><CardTitle as="h3">{d.scenarioName}</CardTitle><span className="decision-status">{statusLabel}</span></CardHeader>
      <CardContent className="grid min-w-0 gap-5">
        <p className="text-base font-semibold">{d.headline}</p>
        {f && <dl className="decision-metrics grid grid-cols-1 gap-x-5 gap-y-4 border-y border-border py-4 text-sm tabular-nums min-[430px]:grid-cols-2 xl:grid-cols-3" aria-label="Ключевые показатели решения">
          <div><dt className="text-xs text-muted-foreground">Парк / зарядки</dt><dd className="m-0 font-semibold">{d.processes.map(p => `${p.n ?? '—'} / ${p.chargers}`).join(' · ') || 'Без роботов'}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Доставлено / требуется, {unit}</dt><dd className="m-0 font-semibold">{d.status === 'baseline' ? 'Не применяется' : metrics ? `${formatNum(metrics.achievedPerH,1)} / ${formatNum(metrics.requiredPerH,1)}` : d.verification.supported ? 'Не проверено' : 'Модель не поддерживается'}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Вложения</dt><dd className="m-0 font-semibold">{formatRub(f.capexRub)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">NPV{d.horizonYears === null ? '' : ` за ${formatYearsRu(d.horizonYears)}`} · {pct(d.discountRate)}</dt><dd className="m-0 font-semibold">{formatRub(f.npvRub)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Чистый эффект в год</dt><dd className="m-0 font-semibold">{formatRub(f.effectYearRub)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Простая окупаемость</dt><dd className="m-0 font-semibold">{f.paybackYears === null ? 'Не достигается' : `${formatNum(f.paybackYears,1)} лет`}</dd></div>
        </dl>}
        <p className="callout" data-tone={tone}>{d.nextAction}</p>
        {(onSimulation || onCompare || onPilot) && <div className="no-print flex flex-wrap gap-2">
          {onSimulation&&d.verification.supported&&needsSimulation&&<Button type="button" className="min-h-11" onClick={onSimulation} disabled={stale}>{spatial && d.spatial.state==='fresh'?'Разобрать ограничения в 3D':analytical?'Открыть аналитическую имитацию':'Открыть проверку сценария'}</Button>}
          {onCompare&&<Button type="button" className="min-h-11" variant={d.status === 'financial-limit' ? 'default' : 'outline'} onClick={onCompare} disabled={stale}>Сравнить варианты</Button>}
          {onPilot && d.finance && d.status !== 'baseline' && <Button type="button" className="min-h-11" variant={d.status === 'suitable' ? 'default' : 'outline'} onClick={onPilot} disabled={stale}>Составить план и бюджет пилота</Button>}
          {onSimulation&&d.verification.supported&&!needsSimulation&&<Button type="button" className="min-h-11" variant="outline" onClick={onSimulation} disabled={stale}>{spatial?'Открыть прогон в 3D':'Открыть аналитическую имитацию'}</Button>}
        </div>}
        <details className="min-w-0" open={!onCompare && !onSimulation && !onPilot}><summary className="cursor-pointer py-2 text-sm font-semibold">Обоснование: нагрузка, экономика, труд и источники</summary><div className="grid min-w-0 gap-5 pt-3">
        {d.processes.length > 0 && <section className="grid gap-3" aria-label="Состав и выполнение работы">
          {d.processes.map(p => <div key={`${p.process}:${p.productName}`} className="grid gap-1 border-b border-border pb-3">
            <h4 className="text-sm font-semibold">{p.label} · {p.productName}</h4>
            <p className="text-sm">Парк: {p.n ?? "не определён"} · зарядок: {p.chargers}. Требуется {formatNum(p.requiredPerH, 1)} {p.unit}.</p>
            <p className="text-xs text-muted-foreground">Расчётный предел охвата по производительности: {p.analyticCoverage === null ? "не определён" : pct(p.analyticCoverage)}.{p.annualCoverageShare !== null && <> Годовое допущение сценария: {pct(p.annualCoverageShare)}.</>} Принято в экономике: {pct(p.financialCoverage)}{p.coverageOverridden ? " — меньшее из расчётного предела и годового допущения" : " — по расчётной производительности"}. Это отдельный расчёт, а не подтверждение 3D.</p>
            <p className="text-xs text-muted-foreground">Эффективная выработка: {p.thrEff === null ? "не определена" : `${formatNum(p.thrEff,1)} ${p.unit}`}. Основание: {p.thrSource}. Загрузка U: {pct(d.analyticAssumptions.utilization)}; доступность A: {pct(d.analyticAssumptions.availability)}.</p>
          </div>)}
        </section>}
        {d.status === 'baseline' ? null : spatial ? <section className="grid gap-2" aria-label="Пространственная проверка">
          <h4 className="text-sm font-semibold">Выполнение нагрузки в 3D</h4>
          {e ? <>
            <p className="text-sm">{e.assessment.status === "NOT_EVALUATED" ? "Выполнение нагрузки не оценено" : d.spatial.state === "fresh" ? "Актуальная проверка этого входа" : d.spatial.state === "stale" ? "Прежняя проверка — текущий вход не подтверждён" : "Сохранённая проверка — актуальность не установлена"}. {e.assessment.headline}</p>
            {d.spatial.metrics ? <dl className="grid gap-2 text-sm tabular-nums sm:grid-cols-3">
              <div><dt className="text-xs text-muted-foreground">Доставлено / требуется</dt><dd className="m-0 font-semibold">{formatNum(e.summary.achievedPerH, 1)} / {formatNum(e.summary.requiredPerH, 1)} <span className="whitespace-nowrap">пал./ч</span></dd></div>
              <div><dt className="text-xs text-muted-foreground">Ещё не начата обработка</dt><dd className="m-0 font-semibold">{formatNum(e.summary.queueEnd)} заявок</dd></div>
              <div><dt className="text-xs text-muted-foreground">Ожидание до начала обработки p95</dt><dd className="m-0 font-semibold">{formatNum(e.summary.waitP95Min, 1)} мин</dd></div>
            </dl> : <p className="text-sm text-muted-foreground">Доставленный поток, очередь и ожидание — не оценены. Требуемая нагрузка: {formatNum(e.input.demand.peakPerH,1)} <span className="whitespace-nowrap">пал./ч</span>. Отсутствие оценки не означает отсутствие работы или очереди.</p>}
            <p className="text-xs text-muted-foreground">Модель {e.simModelVersion}. Окно: {formatNum(e.input.demand.peakMin, 1)} мин после {formatNum(e.input.demand.warmupMin, 1)} мин прогрева; seed {e.input.seed}. Очередь не включает уже назначенные незавершённые задания. Причину ограничения нужно смотреть в доказательствах 3D.</p>
          </> : <p className="text-sm text-muted-foreground">Пространственной проверки для этого сценария нет. Расчётный охват сам по себе не подтверждает доставку заданного потока.</p>}
        </section> : analytical ? <section className="grid gap-2" aria-label="Аналитическая проверка нагрузки">
          <h4 className="text-sm font-semibold">Аналитическая 2D-имитация одиночной перевозки</h4>
          {d.verification.analytical ? <>
            <p className="text-sm">Актуальная проверка этого входа: {d.verification.analytical.verdict === "CONFIRMED" ? "критерии выполнены" : "критерии не выполнены"}.</p>
            <p className="text-sm">Достигнуто {formatNum(d.verification.analytical.achievedPerH, 1)} из {formatNum(d.verification.analytical.requiredPerH, 1)} {unit}; p95 ожидания {formatNum(d.verification.analytical.waitP95Min, 2)} мин.</p>
            <p className="text-xs text-muted-foreground">Модель {d.verification.analytical.simModelVersion}; seed {d.verification.analytical.seed}.</p>
          </> : <p className="text-sm">Нет актуальной сводки для текущего входа и версии модели. Повторите серверный расчёт.</p>}
          <p className="text-xs text-muted-foreground">Проверяются задания, очередь, зарядка и критерии аналитической модели. Подхват мобильного стеллажа, столкновения и пространственная безопасность этим прогоном не подтверждаются.</p>
        </section> : <section className="grid gap-2" aria-label="Границы проверки нагрузки"><h4 className="text-sm font-semibold">Проверка нагрузки не поддерживается</h4><p className="text-sm">Финансовый результат остаётся предварительным. Для этого состава нет применимой имитационной проверки всего сценария; нужны отдельные проверки процессов или замеры на объекте.</p></section>}
        {f && <section className="grid gap-3" aria-label="Финансы выбранного сценария">
          <h4 className="text-sm font-semibold">Экономика этого сценария{d.horizonYears === null ? "" : ` · горизонт ${formatYearsRu(d.horizonYears)}`}</h4>
          <dl className="grid gap-x-5 gap-y-3 text-sm tabular-nums sm:grid-cols-2 lg:grid-cols-3">
            {[['Вложения CAPEX',formatRub(f.capexRub)],['OPEX в год',formatRub(f.opexYearRub)],['Чистый годовой эффект к «Как есть»',formatRub(f.effectYearRub)],['NPV за горизонт',formatRub(f.npvRub)],['Простая окупаемость',f.paybackYears === null ? 'Не достигается при расчётном эффекте' : `${formatNum(f.paybackYears,1)} лет`],[`TCO за ${f.tcoYears} лет`,formatRub(f.tcoRub)]].map(([label,value])=><div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="m-0 font-semibold">{value}</dd></div>)}
          </dl>
          <p className="text-xs text-muted-foreground">Это показатели существующего финансового расчёта с его нормативами и корректировками. При невыполненной или неактуальной проверке нагрузки они остаются сравнением затрат и эффектов; положительный NPV не делает сценарий технически подходящим.</p>
        </section>}
        {d.processes.length > 0 && <section className="grid gap-2" aria-label="Труд и денежная реализация">
          <h4 className="text-sm font-semibold">Объём труда и денежный эффект</h4>
          <p className="text-sm">Доля труда процесса, которую берут роботы: {pct(d.analyticAssumptions.laborShare)} — {d.analyticAssumptions.laborSource}.</p>
          {d.processes.map(p=><p key={`${p.process}:${p.productName}`} className="text-sm">{p.label}: модельно высвобождается {formatNum(p.releasedFte,2)} ставки; остаток ручной работы — {formatNum(p.remainingWorkFte,2)} ставки в эквиваленте трудозатрат. Оставшийся ФОТ процесса в расчёте — {formatRub(p.remainingLabourRub)} в год.</p>)}
          <p className="text-sm">Денежная реализация высвобождаемого труда: <strong>{pct(d.cashRealizationShare)}</strong> — {d.cashRealizationExplicit ? "задано в сценарии" : "исходное допущение модели"}.</p>
          <p className="text-xs text-muted-foreground">Высвобождение времени не равно увольнению людей или автоматическому сокращению ФОТ. Физический остаток работы и сохраняемые денежные затраты показаны раздельно.</p>
        </section>}
        {(d.constraints.length > 0 || d.sources.length > 0) && <details className="min-w-0 text-sm"><summary className="cursor-pointer py-2 font-semibold">Ограничения и откуда взяты затраты</summary>
          {d.constraints.length>0&&<ul className="mt-2 grid list-disc gap-1 pl-5">{d.constraints.map((text,i)=><li key={i}>{text}</li>)}</ul>}
          {d.sources.length>0&&<ul className="mt-3 grid list-disc gap-1 pl-5 text-xs text-muted-foreground">{d.sources.map((text,i)=><li key={i}>{text}</li>)}</ul>}
        </details>}
        </div></details>
      </CardContent>
    </Card>
  );
}
