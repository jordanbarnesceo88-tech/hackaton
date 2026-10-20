import { API_AUTH_MESSAGES, apiUser } from "@/lib/api/auth";
import { apiError, apiJson, isPlainObject, readJsonBody, tooManyRequests, unknownFields } from "@/lib/api/http";
import { rateLimit } from "@/lib/auth/rate-limit";
import { prisma } from "@/lib/db/client";
import { enqueueCalculation } from "@/lib/calculation-jobs/service";
import { foreignOrigin, jobHttpError } from "@/lib/calculation-jobs/http";
import { PROJECT_INPUT_MAX_BYTES } from "@/lib/projects/payload-limit";
import { scheduleOwnedCalculations } from "@/lib/calculation-jobs/schedule";

export const runtime = "nodejs";
export const maxDuration = 300;

const RATE = { limit: 30, windowMs: 15 * 60 * 1000 } as const;
const FIELDS: ReadonlySet<string> = new Set(["name", "facility", "params", "objectName", "scenarios"]);

/** External project creation uses the same durable CREATE command as the UI. */
export async function POST(request: Request) {
  try {
    const userId = await apiUser();
    if (!userId) return apiError(401, API_AUTH_MESSAGES.userRequired);
    if (foreignOrigin(request)) return apiError(403, "Отправьте запрос из этой платформы");
    const limited = await rateLimit(`api:projects:user:${userId}`, RATE);
    if (!limited.ok) return tooManyRequests(limited.retryAfterSec);
    const body = await readJsonBody(request, PROJECT_INPUT_MAX_BYTES);
    if (!body.ok) return body.response;
    if (!isPlainObject(body.value)) return apiError(422, "Тело запроса — объект { name, facility, params?, objectName?, scenarios? }");
    const extra = unknownFields(body.value, FIELDS);
    if (extra.length) return apiError(422, `Неизвестные поля: ${extra.join(", ")}`);
    const job = await enqueueCalculation(prisma, userId, { ...body.value, operation: "CREATE", paramsSource: { kind: "api" } }, request.headers.get("idempotency-key") ?? "");
    scheduleOwnedCalculations(prisma, userId, [job]);
    return apiJson({ job }, { status: 202, headers: { Location: `/api/v1/calculation-jobs/${job.id}`, "Retry-After": "1" } });
  } catch (error) { return jobHttpError(error); }
}
