import Link from "next/link";
import { connection } from "next/server";
import { requireUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/db/client";
import { listOwnedJobs } from "@/lib/calculation-jobs/store";
import { operationLabels, statusLabels } from "@/lib/calculation-jobs/labels";
import { buttonVariants } from "@/components/ui/button";

export const metadata = { title: "Операции расчёта — Платформа оценки роботизации" };

export default async function CalculationJobsPage() {
  await connection();
  const user = await requireUser();
  const jobs = await listOwnedJobs(prisma, user.userId, { limit: 50 });
  return <div className="surface-data grid gap-6 py-10">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="grid gap-2"><h1>Операции расчёта</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">Расчёты продолжаются после закрытия страницы. Здесь можно вернуться к результату, проверить сохранение или отменить работу. Показаны последние 50 операций.</p>
      </div>
      <Link href="/projects" className={buttonVariants({ variant: "outline" })}>Мои проекты</Link>
    </div>
    <p className="callout text-sm">Храним до 200 технических результатов на пользователя. Завершённые результаты можно удалить на их странице; сохранённые проекты и их отчёты остаются доступными.</p>
    {jobs.length === 0 ? <p>Операций пока нет. Создайте проект или сохраните изменения в существующем.</p> : <ol className="divide-y border-y">
      {jobs.map(job => <li key={job.id} className="grid gap-2 py-4 sm:grid-cols-[1fr_auto]">
        <div className="min-w-0 grid gap-1"><Link className="font-semibold underline underline-offset-4" href={`/calculation-jobs/${job.id}`}>{operationLabels[job.operation] ?? job.operation} · {job.createdAt.slice(0, 19).replace("T", " ")} UTC</Link>
          <p className="text-sm text-muted-foreground">{job.safeMessage}</p>
          {job.publicationState === "STALE" && <p className="text-sm">Результат готов, проект не обновлён: его изменили во время расчёта.</p>}
        </div>
        <span className="text-sm font-semibold">{statusLabels[job.status]}</span>
      </li>)}
    </ol>}
  </div>;
}
