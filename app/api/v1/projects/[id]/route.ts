import { API_AUTH_MESSAGES, apiUser } from "@/lib/api/auth";
import { apiError, apiJson, dbUnavailable } from "@/lib/api/http";
import { prisma } from "@/lib/db/client";
import { getProject } from "@/lib/projects/queries";
import { liveDataVersion } from "@/lib/projects/recalc";
import { TZ_MODEL_VERSION } from "@/lib/tz/version";

/**
 * GET /api/v1/projects/{id} — проект пользователя с параметрами, сценариями и сохранёнными
 * результатами (ТЗ §3.1.3, §3.1.5). Нужна сессия; чужой проект неотличим от несуществующего
 * (404, изоляция проектов §4.4.2).
 *
 * Результаты — снимок сохранённого расчёта с версиями модели и данных. `liveDataVersion` —
 * версия, которую получил бы тот же проект на текущих данных каталога и нормативов; если она
 * отличается от `dataVersion`, данные изменились после расчёта (`dataChanged: true`);
 * `modelChanged` — проект посчитан другой версией модели. Пересчёт выполняется в рабочей
 * области проекта кнопкой «Пересчитать на актуальных данных».
 */

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const userId = await apiUser();
    if (!userId) return apiError(401, API_AUTH_MESSAGES.userRequired);
    const project = await getProject(prisma, id, userId);
    if (!project) return apiError(404, "Проект не найден — проверьте id или войдите под владельцем проекта");
    const live = project.results ? await liveDataVersion(prisma, project.results) : null;
    return apiJson({
      id: project.id,
      name: project.name,
      objectName: project.objectName,
      facility: project.facility,
      url: `/projects/${project.id}`,
      isDemo: project.isDemo,
      copiedFromId: project.copiedFromId,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
      calculatedAt: project.calculatedAt ? project.calculatedAt.toISOString() : null,
      modelVersion: project.modelVersion,
      dataVersion: project.dataVersion,
      liveDataVersion: live,
      dataChanged: live !== null && project.dataVersion !== null ? live !== project.dataVersion : null,
      currentModelVersion: TZ_MODEL_VERSION,
      modelChanged: project.modelVersion !== null ? project.modelVersion !== TZ_MODEL_VERSION : null,
      params: project.params,
      paramsSource: project.paramsSource,
      scenarios: project.scenarios,
      results: project.results,
    });
  } catch (e) {
    return dbUnavailable(`GET /api/v1/projects/${id}`, e);
  }
}
