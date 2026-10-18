import { checkCalcInput, facilityOf, FACILITY_HINT } from "@/lib/api/calc";
import { apiError, apiJson, isPlainObject, readJsonBody, tooManyRequests, unknownFields } from "@/lib/api/http";
import { clientIp, rateLimit } from "@/lib/auth/rate-limit";
import { foreignOrigin } from "@/lib/calculation-jobs/http";
import { prisma } from "@/lib/db/client";
import { PROJECT_INPUT_MAX_BYTES } from "@/lib/projects/payload-limit";
import { loadLiveInputs, resultsFromInputsAsync } from "@/lib/projects/recalc";
import { checkExecution } from "@/lib/sim/cooperative";
import { calculationFailure } from "@/lib/sim/server-execution";

export const runtime = "nodejs";
export const maxDuration = 75;

const FIELDS: ReadonlySet<string> = new Set(["facility", "params", "scenarios"]);
const RATE = { limit: 30, windowMs: 5 * 60 * 1000 } as const;

/** Public calculation uses live public inputs; no project or owner is read or written. */
export async function POST(request: Request): Promise<Response> {
  try {
    if (foreignOrigin(request)) return apiError(403, "Отправьте расчёт из этой платформы");
    const limited = await rateLimit(`api:demo-calculation:ip:${clientIp(request.headers)}`, RATE);
    if (!limited.ok) return tooManyRequests(limited.retryAfterSec);
    const body = await readJsonBody(request, PROJECT_INPUT_MAX_BYTES);
    if (!body.ok) return body.response;
    if (!isPlainObject(body.value)) return apiError(422, "Тело запроса — объект { facility, params?, scenarios? }");
    const extra = unknownFields(body.value, FIELDS);
    if (extra.length) return apiError(422, `Неизвестные поля: ${extra.join(", ")}`);
    const facility = facilityOf(body.value.facility);
    if (!facility) return apiError(422, `Выберите тип объекта: ${FACILITY_HINT}`);
    const now = () => performance.now(), startedAt = now();
    const execution = { now, deadline: startedAt + 60_000, signal: request.signal };
    checkExecution(execution);
    const live = await loadLiveInputs(prisma, facility);
    checkExecution(execution);
    const checked = checkCalcInput(live, facility, body.value.params, body.value.scenarios);
    if (!checked.ok) return apiError(422, checked.error, checked.details);
    // resultsFromInputsAsync owns the same process-wide two-calculation admission
    // and absolute deadline used by authenticated calculations.
    const result = await resultsFromInputsAsync(live, { facility, params: checked.params,
      scenarios: checked.scenarios, signal: request.signal }, execution);
    checkExecution(execution);
    return apiJson({ results: result.results, ms: now() - startedAt });
  } catch (error) {
    const failure = calculationFailure(error);
    if (failure) return apiError(failure.status, failure.message, undefined,
      failure.retryAfterSec === undefined ? undefined : { "Retry-After": String(failure.retryAfterSec) });
    return apiError(503, "Не удалось выполнить гостевой расчёт. Повторите попытку позже");
  }
}
