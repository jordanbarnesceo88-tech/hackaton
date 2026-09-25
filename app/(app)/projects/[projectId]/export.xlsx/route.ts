import type { NextRequest } from "next/server";
import { projectExportResponse } from "@/components/report/tz/export";
import { loadReportData } from "@/components/report/tz/data";
import { getSessionUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/db/client";

/**
 * Выгрузка проекта в Excel (ТЗ §3.7.3): книга из 13 листов с живыми формулами итогов —
 * lib/report/tz/xlsx. Доступна только владельцу проекта; ссылка — обычный `<a download>` на
 * странице отчёта. Коды ответов и заголовки — в components/report/tz/export.ts.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const user = await getSessionUser();
  return projectExportResponse("xlsx", projectId, {
    userId: user?.userId ?? null,
    load: (id, userId) => loadReportData(prisma, id, userId),
  });
}
