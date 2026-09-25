import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { loadReportData } from "@/components/report/tz/data";
import { ProjectReport, ReportNeedsSave } from "@/components/report/tz/project-report";
import { getSessionUser, requireUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/db/client";

/**
 * Отчёт по проекту для печати и сохранения в PDF (ТЗ §2.2 шаг 8, §3.7.2): все разделы строятся
 * из сохранённого расчёта проекта — components/report/tz/project-report.tsx. Доступен только
 * владельцу проекта; чужой проект неотличим от несуществующего (404).
 */

type Params = Promise<{ projectId: string }>;

/**
 * Загрузка отчёта один раз на запрос: React cache() делит результат между generateMetadata и
 * страницей, поэтому проект, живые входы (описания параметров, продукты и нормативы для
 * сравнения версии данных) и журнал читаются из БД однократно.
 */
const loadReport = cache((projectId: string, userId: string) => loadReportData(prisma, projectId, userId));

const TITLE_SUFFIX = "Платформа оценки роботизации";

/** Заголовок вкладки — он же имя файла по умолчанию при «Сохранить как PDF». */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { projectId } = await params;
  const user = await getSessionUser();
  const data = user ? await loadReport(projectId, user.userId) : null;
  return { title: data ? `Отчёт по проекту «${data.project.name}» — ${TITLE_SUFFIX}` : `Отчёт по проекту — ${TITLE_SUFFIX}` };
}

export default async function ProjectReportPage({ params }: { params: Params }) {
  await connection();
  const user = await requireUser();
  const { projectId } = await params;
  const data = await loadReport(projectId, user.userId);
  if (!data) notFound();
  const { project } = data;
  if (!project.results) return <ReportNeedsSave projectId={project.id} projectName={project.name} />;
  return (
    <ProjectReport
      project={{
        id: project.id,
        name: project.name,
        objectName: project.objectName,
        facility: project.facility,
        paramsSource: project.paramsSource,
      }}
      results={project.results}
      defs={data.defs}
      changes={data.changes}
      liveDataVersion={data.liveDataVersion}
    />
  );
}
