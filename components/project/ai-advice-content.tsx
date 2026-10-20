import { ADVICE_NOTE, SEVERITY_LABEL, type AdviceView } from "@/lib/ai/advice/view";
import { formatCalcDate } from "@/lib/report/tz/rows";

/**
 * Содержимое рекомендаций ИИ — одно для экрана проекта, демо и печатного отчёта: итог, почему,
 * действия, риски с мерами и проверкой на пилоте, что изменит вывод, шаги и что уточнить.
 * Без состояния и обработчиков — его рендерит и серверная страница отчёта.
 */

const SEVERITY_TONE = { high: "crit", medium: "warn", low: "info" } as const;

export function AiAdviceContent({ advice, headingLevel = 4 }: { advice: AdviceView; headingLevel?: 3 | 4 }) {
  const { content } = advice;
  const H = headingLevel === 3 ? "h3" : "h4";
  return (
    <div className="flex flex-col gap-4 text-sm" data-ai-advice={advice.stale ? "stale" : "fresh"}>
      {advice.stale && (
        <p role="note" data-tone="warn" className="callout callout--sm">
          Рекомендации относятся к прежнему расчёту: после него условия изменились.
        </p>
      )}
      <div className="flex flex-col gap-2">
        <p className="text-base font-medium">{content.summary}</p>
        <p>{content.whyThisScenario}</p>
      </div>

      <section className="flex flex-col gap-2">
        <H className="font-semibold">Что сделать</H>
        <ol className="flex list-decimal flex-col gap-1 pl-5">
          {content.recommendations.map((r, i) => (
            <li key={i}>
              <span className="font-medium">{r.action}</span> — {r.why}
            </li>
          ))}
        </ol>
      </section>

      {content.risks.length > 0 && (
        <section className="flex flex-col gap-2">
          <H className="font-semibold">Главные риски</H>
          <ul className="flex flex-col gap-3">
            {content.risks.map((r, i) => (
              <li key={i} className="flex flex-col gap-1">
                <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="badge" data-tone={SEVERITY_TONE[r.severity]}>{SEVERITY_LABEL[r.severity]}</span>
                  <span className="text-muted-foreground">{r.scenario}</span>
                </p>
                <p>{r.risk}</p>
                <p><span className="text-muted-foreground">Как снизить:</span> {r.mitigation}</p>
                <p><span className="text-muted-foreground">Проверить на пилоте:</span> {r.checkOnPilot}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {content.whenConclusionChanges.length > 0 && (
        <section className="flex flex-col gap-2">
          <H className="font-semibold">Что изменит вывод</H>
          <ul className="flex list-disc flex-col gap-1 pl-5">
            {content.whenConclusionChanges.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <H className="font-semibold">Шаги до пилота</H>
        <ol className="flex list-decimal flex-col gap-1 pl-5">
          {content.nextSteps.map((s, i) => <li key={i}>{s}</li>)}
        </ol>
      </section>

      {content.missingData.length > 0 && (
        <section className="flex flex-col gap-2">
          <H className="font-semibold">Что уточнить</H>
          <ul className="flex list-disc flex-col gap-1 pl-5">
            {content.missingData.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </section>
      )}

      <p className="text-xs text-muted-foreground">
        {ADVICE_NOTE} Модель {advice.model}, {formatCalcDate(advice.createdAt)}.
      </p>
    </div>
  );
}
