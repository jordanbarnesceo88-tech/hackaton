"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { cancelCalculation, forgetSubmission, isPendingJob, readCalculationResult, removeCalculationResult, waitForCalculation, type JobResult } from "@/lib/calculation-jobs/client";
import { operationLabels, stageLabels, statusLabels } from "@/lib/calculation-jobs/labels";
import type { JobReceipt } from "@/lib/calculation-jobs/types";
import { formatRub } from "@/lib/format/rub";

export function CalculationJobView({ initial, autoOpen = false }: { initial: JobReceipt; autoOpen?: boolean }) {
  const router = useRouter();
  const [job, setJob] = useState(initial);
  const [result, setResult] = useState<JobResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [watch, setWatch] = useState(0);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [submittedBusy, setSubmittedBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    if (autoOpen && initial.operation === "CREATE") forgetSubmission("create-project");
    void (async () => {
      try {
        const final = await waitForCalculation(initial.id, setJob, controller.signal);
        if (controller.signal.aborted) return;
        if (final.status === "SUCCEEDED") {
          if (autoOpen && final.operation === "CREATE" && final.publicationState === "PUBLISHED" && final.projectId) {
            router.replace(`/projects/${final.projectId}?edit=1`);
            return;
          }
          const loaded = await readCalculationResult(final.id, controller.signal);
          if (!controller.signal.aborted) setResult(loaded);
        }
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Не удалось прочитать состояние. Расчёт остаётся на сервере");
      }
    })();
    return () => controller.abort();
  }, [initial.id, initial.operation, autoOpen, router, watch]);

  async function cancel() {
    setBusy(true); setError("");
    try { setJob(await cancelCalculation(job.id)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось подтвердить отмену"); }
    finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true); setError("");
    try { await removeCalculationResult(job.id); router.replace("/calculation-jobs"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось удалить результат"); setBusy(false); }
  }
  function exportResult() {
    if (!result?.results) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify({ job: result.job, results: result.results }, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `calculation-${job.id}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function exportSubmitted() {
    setSubmittedBusy(true); setError("");
    try {
      const loaded = result?.submitted ? result : await readCalculationResult(job.id);
      if (!loaded.submitted) throw new Error("Отправленные параметры недоступны");
      const url = URL.createObjectURL(new Blob([JSON.stringify({ projectId: job.projectId, ...loaded.submitted }, null, 2)], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = `submitted-${job.id}.json`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось прочитать отправленные параметры"); }
    finally { setSubmittedBusy(false); }
  }

  return <div className="grid min-w-0 gap-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div className="grid gap-2">
      <h1>{operationLabels[job.operation] ?? "Операция расчёта"}</h1>
      <p className="max-w-3xl text-sm text-muted-foreground">Входные данные и справочники зафиксированы при отправке. Закрытие страницы не отменяет расчёт.</p>
    </div><Link href="/calculation-jobs" className={buttonVariants({ variant: "outline" })}>Все операции</Link></div>
    <section className="grid gap-4 border p-5" aria-label="Состояние расчёта">
      <div role="status" aria-live="polite" className="grid gap-2"><h2 className="text-lg">{statusLabels[job.status]}</h2>
        <p>{job.safeMessage}</p>
        {isPendingJob(job) && <p className="text-sm text-muted-foreground">Этап: {stageLabels[job.stage] ?? "Обработка"}. {job.status === "QUEUED" && "Задание сохранено в очереди и ожидает запуска."}{job.cancelRequestedAt && " Отмена принята; публикация результата запрещена."}</p>}
      </div>
      <dl className="grid gap-3 text-sm sm:grid-cols-3"><div><dt className="text-muted-foreground">Отправлено, UTC</dt><dd>{job.createdAt.slice(0, 19).replace("T", " ")}</dd></div><div><dt className="text-muted-foreground">Попыток выполнения</dt><dd>{job.attempts}</dd></div><div className="min-w-0"><dt className="text-muted-foreground">Номер операции</dt><dd className="break-all font-mono text-xs">{job.id}</dd></div></dl>
      {job.publicationState === "STALE" && <p className="callout" data-tone="warn">Расчёт завершён, но проект изменили во время его выполнения. Этот результат сохранён отдельно. Текущие параметры проекта не перезаписаны; сравните данные и запустите новый расчёт при необходимости.</p>}
      {job.publicationState === "PUBLISHED" && <p className="callout" data-tone="ok">Проект сохранён, ревизия {job.publishedRevision}. Результат расчёта доступен независимо от последующих изменений проекта.</p>}
      {error && <div role="alert" className="grid gap-2 text-sm"><p>{error}</p><Button variant="outline" onClick={() => { setError(""); setWatch(x => x + 1); }}>Обновить состояние</Button></div>}
      <div className="flex flex-wrap gap-2">
        {job.projectId && <Link className={buttonVariants({ variant: "outline" })} href={`/projects/${job.projectId}`}>Открыть проект</Link>}
        {isPendingJob(job) && <Button variant="outline" disabled={busy || !!job.cancelRequestedAt} onClick={cancel}>{job.cancelRequestedAt ? "Отмена принята" : "Отменить расчёт"}</Button>}
        {result?.results && <Button variant="outline" onClick={exportResult}>Скачать результат JSON</Button>}
        {job.operation === "SAVE" && <Button variant="outline" disabled={submittedBusy} onClick={exportSubmitted}>{submittedBusy ? "Читаем параметры…" : "Скачать отправленные параметры"}</Button>}
      </div>
      {job.operation === "SAVE" && <p className="text-sm text-muted-foreground">Отправленные параметры и сценарии доступны даже после отмены или ошибки расчёта. JSON сохраняет ваш ввод для сравнения и восстановления; он не изменяет текущую версию проекта.</p>}
    </section>
    {job.status === "SUCCEEDED" && !result && !error && <p role="status" className="text-sm text-muted-foreground">Читаем сохранённый результат…</p>}
    {result?.results && <section className="grid gap-4" aria-label="Сохранённый результат">
      <h2>Результат этого запуска</h2>
      <p className="text-sm text-muted-foreground">Модель {result.results.modelVersion} · имитация {result.results.simModelVersion} · {result.results.calculatedAt}. Финансовые показатели следует оценивать вместе с ограничениями и проверкой нагрузки в проекте.</p>
      <div className="grid gap-3 lg:grid-cols-2">{result.results.results.map(scenario => <article key={scenario.key} className="grid gap-2 border p-4"><h3 className="text-base">{scenario.name}</h3>
        {scenario.status === "ok" ? <dl className="grid gap-2 text-sm"><div><dt className="text-muted-foreground">Вложения CAPEX</dt><dd>{formatRub(scenario.capexRub)}</dd></div><div><dt className="text-muted-foreground">Чистый годовой эффект</dt><dd>{formatRub(scenario.effectYearRub)}</dd></div><div><dt className="text-muted-foreground">NPV</dt><dd>{scenario.npvRub === null ? "Не определён" : formatRub(scenario.npvRub)}</dd></div></dl> : <p className="text-sm">Сценарий не рассчитан. Причины сохранены в результате JSON.</p>}
        {scenario.risks.length > 0 && <details className="text-sm"><summary className="cursor-pointer py-2">Ограничения и риски ({scenario.risks.length})</summary><ul className="list-disc pl-5">{scenario.risks.map((risk, i) => <li key={i}>{risk.text}</li>)}</ul></details>}
      </article>)}</div>
    </section>}
    {!isPendingJob(job) && <section className="grid gap-3 border-t pt-4 text-sm">
      {confirmRemove ? <><p>Удалить исходный вход и результат этого технического запуска? Сохранённый проект и его отчёты останутся. Восстановить удалённый результат нельзя.</p><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={remove}>Удалить технический результат</Button><Button variant="ghost" disabled={busy} onClick={() => setConfirmRemove(false)}>Оставить</Button></div></> : <Button className="justify-self-start" variant="ghost" onClick={() => setConfirmRemove(true)}>Удалить технический результат…</Button>}
    </section>}
  </div>;
}
