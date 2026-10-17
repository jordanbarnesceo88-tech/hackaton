import { apiUser, API_AUTH_MESSAGES } from "@/lib/api/auth";
import { apiError, apiJson, isPlainObject, readJsonBody } from "@/lib/api/http";
import { prisma } from "@/lib/db/client";
import { cancelJob } from "@/lib/calculation-jobs/store";
import { foreignOrigin, jobHttpError } from "@/lib/calculation-jobs/http";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await apiUser();
    if (!userId) return apiError(401, API_AUTH_MESSAGES.userRequired);
    if (foreignOrigin(request)) return apiError(403, "Отмените расчёт из этой платформы");
    const body = await readJsonBody(request, 128);
    if (!body.ok) return body.response;
    if (!isPlainObject(body.value) || Object.keys(body.value).length) return apiError(422, "Для отмены передайте JSON {}");
    const { id } = await params;
    const job = await cancelJob(prisma, userId, id);
    if (!job) return apiError(404, "Расчёт не найден");
    if (job.status === "SUCCEEDED" || job.status === "FAILED") return apiError(409, "Расчёт уже завершён. Проверьте сохранённый результат", { job });
    return apiJson({ job });
  } catch (error) { return jobHttpError(error); }
}
