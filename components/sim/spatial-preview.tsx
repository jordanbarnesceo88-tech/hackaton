"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatNum } from "@/lib/format/rub";
import {
  createSpatialProjectSnapshot,
  parseSpatialProjectResult,
  spatialProjectMessageMatches,
  type SpatialProjectResult,
  type SpatialProjectSnapshot,
} from "@/lib/sim/spatial-bridge";
import { parseSpatialScenarioProposal, type SpatialScenarioProposal } from "@/lib/sim/spatial-proposal";

type Selection = Omit<SpatialProjectSnapshot, "schemaVersion" | "requestId" | "inputKey">;
export type SpatialFinancialAssumptions = { annualCoverageShare: number; cashRealizationShare: number };
type Feedback = { key: string; message: string; result?: SpatialProjectResult; proposal?: SpatialScenarioProposal; error?: boolean };
type Props = {
  selection: Selection | null; stale: boolean; readOnly?: boolean;
  onResult?: (snapshot: SpatialProjectSnapshot, result: SpatialProjectResult) => void;
  onCreateScenario?: (proposal: SpatialScenarioProposal, assumptions: SpatialFinancialAssumptions) => void;
};

/** Spatial facts and financial assumptions remain separate until an explicit scenario calculation. */
export function SpatialPreview({ selection, stale, readOnly = false, onResult, onCreateScenario }: Props) {
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [coveragePct, setCoveragePct] = useState(100);
  const [cashPct, setCashPct] = useState(0);
  const [accepted, setAccepted] = useState(false);
  const cleanup = useRef<(() => void) | null>(null);
  const handlers = useRef({ onResult, onCreateScenario });
  useEffect(() => { handlers.current = { onResult, onCreateScenario }; }, [onResult, onCreateScenario]);
  const currentKey = selection ? `${selection.scenarioKey}:${selection.variantId}:${JSON.stringify(selection.input)}` : "";
  useEffect(() => () => { cleanup.current?.(); cleanup.current = null; }, [currentKey, stale]);

  function acceptReply(key: string, proposal: SpatialScenarioProposal) {
    const s = proposal.result.summary;
    setFeedback({ key, message: proposal.result.assessment.headline, result: proposal.result, proposal });
    setCoveragePct(Math.floor(Math.min(1, s.requiredPerH > 0 ? s.achievedPerH / s.requiredPerH : 0) * 10000) / 100);
    setCashPct(0); setAccepted(false);
  }

  function open() {
    if (!selection || stale) return;
    cleanup.current?.();
    let snapshot: SpatialProjectSnapshot;
    try { snapshot = createSpatialProjectSnapshot({ ...selection, requestId: crypto.randomUUID() }); }
    catch (error) { setFeedback({ key: currentKey, message: error instanceof Error ? error.message : "Не удалось собрать снимок проекта", error: true }); return; }
    const origin = window.location.origin;
    let child: Window | null = null, ready = false;
    let timeout: ReturnType<typeof setTimeout>;
    function stop() { clearTimeout(timeout); window.removeEventListener("message", receive); }
    function failed(message: string) { stop(); setFeedback({ key: currentKey, message, error: true }); }
    function receive(event: MessageEvent) {
      if (!spatialProjectMessageMatches(event, { origin, source: child, requestId: snapshot.requestId })) return;
      const data = event.data;
      if (data.type === "spatial-project-ready" && !ready) {
        ready = true; clearTimeout(timeout);
        child?.postMessage({ type: "spatial-project-snapshot", requestId: snapshot.requestId, payload: snapshot }, origin);
        setFeedback({ key: currentKey, message: "Снимок передан в 3D. Проверяем выбранный парк на заданной нагрузке." });
        timeout = setTimeout(() => failed("3D не вернула итог за 120 с. Проверьте открытую вкладку и повторите запуск."), 120_000);
      } else if (data.type === "spatial-project-error") {
        failed(typeof data.message === "string" ? `3D: ${data.message.slice(0, 1000)}` : "Пространственная проверка не выполнена.");
      } else if (data.type === "spatial-project-result" && ready) {
        try {
          const result = parseSpatialProjectResult(data, snapshot);
          clearTimeout(timeout);
          acceptReply(currentKey, { type: "spatial-scenario-proposal", requestId: snapshot.requestId, originalInputKey: snapshot.inputKey, candidate: snapshot, result });
          handlers.current.onResult?.(snapshot, result);
        } catch { failed("Ответ 3D не совпал с переданным снимком. Повторите проверку актуального сценария."); }
      } else if (data.type === "spatial-scenario-proposal" && ready) {
        try { const proposal = parseSpatialScenarioProposal(data, snapshot); clearTimeout(timeout); acceptReply(currentKey, proposal); }
        catch { setFeedback({ key: currentKey, message: "В предложенном варианте изменились неподтверждённые условия. Повторите его проверку из проекта.", error: true }); }
      }
    }
    window.addEventListener("message", receive);
    timeout = setTimeout(() => failed("Не удалось передать снимок в 3D за 30 с. Проверьте новую вкладку и повторите открытие."), 30_000);
    cleanup.current = stop;
    child = window.open(`/demo/warehouse#project=${snapshot.requestId}`, "_blank");
    if (!child) { failed("Браузер заблокировал новую вкладку. Разрешите всплывающие окна для этого сайта и повторите."); return; }
    setFeedback({ key: currentKey, message: "Открываем 3D выбранного варианта." });
  }

  const shown = !stale && feedback?.key === currentKey ? feedback : null;
  const proposal = shown?.proposal;
  const eligible = proposal && ["OK", "PARTIAL"].includes(proposal.result.assessment.status);
  const valid = Number.isFinite(coveragePct) && coveragePct >= 0 && coveragePct <= 100 && Number.isFinite(cashPct) && cashPct >= 0 && cashPct <= 100;
  return (
    <section className="grid gap-3 border-y border-border py-4" aria-label="Пространственная проверка и финансовый вариант">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" className="min-h-11" onClick={open} disabled={!selection || stale}>Проверить этот вариант в 3D ↗</Button>
        <p className="text-xs text-muted-foreground">Тот же парк, нагрузка и инфраструктура · с защитными остановками и объездами</p>
      </div>
      {stale && <p role="status" className="text-sm">Условия изменены. Пересчитайте сценарий перед проверкой.</p>}
      {shown && <div role="status" aria-live="polite" className="grid gap-2 text-sm" data-spatial-status={shown.result?.assessment.status ?? (shown.error ? "ERROR" : "WAITING")}>
        <p className={shown.error || shown.result?.assessment.status === "FAIL" ? "text-destructive" : "font-medium"}>{shown.message}</p>
        {shown.result && <p>Парк: {shown.result.summary.fleet}. Доставлено {formatNum(shown.result.summary.achievedPerH, 1)} из требуемых {formatNum(shown.result.summary.requiredPerH, 1)} пал./ч. Очередь в конце: {shown.result.summary.queueEnd} заданий.</p>}
      </div>}
      {eligible && <form className="grid gap-3 border-t pt-3" onSubmit={event => {
        event.preventDefault();
        if (!accepted || !valid || stale || readOnly || !onCreateScenario) return;
        try { handlers.current.onCreateScenario?.(proposal, { annualCoverageShare: coveragePct / 100, cashRealizationShare: cashPct / 100 }); }
        catch (error) { setFeedback({ ...shown, key: currentKey, message: error instanceof Error ? error.message : "Не удалось рассчитать вариант", error: true }); }
      }}>
        <h4 className="font-medium">Рассчитать экономику проверенного состава</h4>
        <p className="text-xs text-muted-foreground">Создадим отдельный сценарий: {proposal.candidate.input.robots.count} роботов, {proposal.candidate.input.layout.chargers} зарядок. Исходный вариант сохранится для сравнения.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm">Доля годовой нагрузки для роботов, %
            <input className="min-h-11 w-full rounded border bg-background px-3" type="number" min="0" max="100" step="0.01" required value={Number.isNaN(coveragePct) ? "" : coveragePct} onChange={e => { setCoveragePct(e.target.valueAsNumber); setAccepted(false); }} disabled={readOnly} />
          </label>
          <label className="grid gap-1 text-sm">Доля высвобождённого труда, сокращающая расходы, %
            <input className="min-h-11 w-full rounded border bg-background px-3" type="number" min="0" max="100" step="0.01" required value={Number.isNaN(cashPct) ? "" : cashPct} onChange={e => { setCashPct(e.target.valueAsNumber); setAccepted(false); }} disabled={readOnly} />
          </label>
        </div>
        <p className="text-xs text-muted-foreground">Первое значение предложено по выработке этого окна и задаёт оценочный профиль года. Второе равно 0%, пока вы явно не заложите сокращение расходов. Освободившееся время сотрудников показывается отдельно.</p>
        <label className="flex items-start gap-2 text-sm"><input className="mt-1 size-4 shrink-0" type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} disabled={readOnly} />Принимаю эти значения как допущения сценария для пересчёта годового денежного потока.</label>
        <Button type="submit" disabled={!valid || !accepted || readOnly || !onCreateScenario}>Создать финансовый вариант</Button>
        {readOnly && <p className="text-xs text-muted-foreground">Открыт режим просмотра. Создайте редактируемую копию проекта для расчёта нового варианта.</p>}
      </form>}
    </section>
  );
}
