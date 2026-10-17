"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { isPendingJob } from "@/lib/calculation-jobs/client";
import type { JobReceipt } from "@/lib/calculation-jobs/types";

export function calculationStageText(job: Pick<JobReceipt, "stage" | "status" | "cancelRequestedAt">): string {
  if (job.cancelRequestedAt && isPendingJob(job)) return "Отмена принята — результат не будет опубликован";
  const stages: Record<string, string> = {
    queued: "Ожидает свободного вычислителя", retry_pending: "Восстанавливаем расчёт после остановки вычислителя",
    preparing: "Проверяем исходные данные", calculating: "Выполняем расчёт",
    "spatial-check": "Проверяем движение роботов на планировке", simulation: "Моделируем выполнение нагрузки",
    "fleet-search": "Проверяем варианты численности парка", finalizing: "Собираем результат",
    publishing: "Сохраняем результат", succeeded: "Расчёт завершён", failed: "Расчёт не завершён", cancelled: "Расчёт отменён",
  };
  return stages[job.stage] ?? "Выполняем расчёт";
}

export function CalculationJobStatus({ job, onCancel, cancelling = false }: {
  job: JobReceipt | null; onCancel: () => void; cancelling?: boolean;
}) {
  if (!job) return null;
  const pending = isPendingJob(job);
  return <div className="flex min-w-0 flex-col gap-2 border-t pt-3 text-sm">
    <p role="status" aria-live="polite">{calculationStageText(job)}</p>
    <div className="flex flex-wrap items-center gap-3">
      <Link href={`/calculation-jobs/${encodeURIComponent(job.id)}`} className="tap-target text-primary underline underline-offset-2">Открыть расчёт и его результат</Link>
      {pending && <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={cancelling || Boolean(job.cancelRequestedAt)}>
        {cancelling ? "Отменяем…" : job.cancelRequestedAt ? "Отмена принята" : "Отменить расчёт"}
      </Button>}
    </div>
    {pending && <p className="max-w-3xl text-xs text-muted-foreground">Отправленный расчёт продолжится после закрытия страницы. Более поздние несохранённые правки остаются в этой вкладке. Состояние расчёта и результат доступны по ссылке.</p>}
  </div>;
}
