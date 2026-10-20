import { apiUser, API_AUTH_MESSAGES } from "@/lib/api/auth";
import { apiError, apiJson, isPlainObject, readJsonBody } from "@/lib/api/http";
import { prisma } from "@/lib/db/client";
import { getOwnedJob, deleteOwnedTerminalJob } from "@/lib/calculation-jobs/store";
import { foreignOrigin, jobHttpError } from "@/lib/calculation-jobs/http";
import { scheduleOwnedCalculations } from "@/lib/calculation-jobs/schedule";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await apiUser();
    if (!userId) return apiError(401, API_AUTH_MESSAGES.userRequired);
    const { id } = await params;
    const job = await getOwnedJob(prisma, userId, id);
    if (job) scheduleOwnedCalculations(prisma, userId, [job]);
    return job ? apiJson({ job }) : apiError(404, "Расчёт не найден");
  } catch (error) { return jobHttpError(error); }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await apiUser();
    if (!userId) return apiError(401, API_AUTH_MESSAGES.userRequired);
    if (foreignOrigin(request)) return apiError(403, "Удаляйте результат из этой платформы");
    const body = await readJsonBody(request, 128);
    if (!body.ok) return body.response;
    if (!isPlainObject(body.value) || Object.keys(body.value).length !== 0) return apiError(422, "Передайте пустой JSON-объект {}");
    const { id } = await params;
    return await deleteOwnedTerminalJob(prisma, userId, id) ? apiJson({ ok: true }) : apiError(404, "Расчёт не найден");
  } catch (error) { return jobHttpError(error); }
}
