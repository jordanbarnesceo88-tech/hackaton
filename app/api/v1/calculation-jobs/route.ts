import { apiUser, API_AUTH_MESSAGES } from "@/lib/api/auth";
import { apiError, apiJson, readJsonBody } from "@/lib/api/http";
import { prisma } from "@/lib/db/client";
import { enqueueCalculation } from "@/lib/calculation-jobs/service";
import { listOwnedJobs } from "@/lib/calculation-jobs/store";
import { foreignOrigin, jobHttpError } from "@/lib/calculation-jobs/http";
import { PROJECT_INPUT_MAX_BYTES } from "@/lib/projects/payload-limit";

export async function POST(request: Request) {
  try {
    const userId = await apiUser();
    if (!userId) return apiError(401, API_AUTH_MESSAGES.userRequired);
    if (foreignOrigin(request)) return apiError(403, "Отправьте расчёт из этой платформы");
    const body = await readJsonBody(request, PROJECT_INPUT_MAX_BYTES);
    if (!body.ok) return body.response;
    const job = await enqueueCalculation(prisma, userId, body.value, request.headers.get("idempotency-key") ?? "");
    return apiJson({ job }, { status: 202, headers: { Location: `/api/v1/calculation-jobs/${job.id}`, "Retry-After": "1" } });
  } catch (error) { return jobHttpError(error); }
}

export async function GET(request: Request) {
  try {
    const userId = await apiUser();
    if (!userId) return apiError(401, API_AUTH_MESSAGES.userRequired);
    const params = new URL(request.url).searchParams;
    const projectId = params.get("projectId") ?? undefined;
    if (projectId !== undefined && (!projectId || projectId.length > 128)) return apiError(422, "Некорректный projectId");
    return apiJson({ jobs: await listOwnedJobs(prisma, userId, { projectId, limit: 30 }) });
  } catch (error) { return jobHttpError(error); }
}
