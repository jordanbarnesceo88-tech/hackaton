import { connection } from "next/server";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/db/client";
import { getOwnedJob } from "@/lib/calculation-jobs/store";
import { CalculationJobView } from "@/components/project/calculation-job-view";

export const metadata = { title: "Результат операции — Платформа оценки роботизации" };

export default async function CalculationJobPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ open?: string }> }) {
  await connection();
  const user = await requireUser();
  const { id } = await params;
  const job = await getOwnedJob(prisma, user.userId, id);
  if (!job) notFound();
  const query = await searchParams;
  return <div className="surface-data py-10"><CalculationJobView key={job.id} initial={job} autoOpen={query.open === "1"} /></div>;
}
