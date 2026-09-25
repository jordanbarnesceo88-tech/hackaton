import { calcVersions, checkCalcInput, FACILITY_HINT, facilityOf, summarizeResults } from "@/lib/api/calc";
import { apiError, apiJson, dbUnavailable, isPlainObject, readJsonBody, tooManyRequests, unknownFields } from "@/lib/api/http";
import { clientIp, rateLimit } from "@/lib/auth/rate-limit";
import { prisma } from "@/lib/db/client";
import { loadLiveInputs, resultsFromInputs } from "@/lib/projects/recalc";

/**
 * POST /api/v1/calculate — расчёт без сохранения (ТЗ §3.1.2 — гостевой демо-расчёт, §3.8.1 —
 * API для внешних систем). Вход не нужен.
 *
 * Тело: `{ facility, params?, scenarios? }`. Без params — базовые значения организатора, без
 * scenarios — сценарии по умолчанию из подбора. Считает то же, что «Новый проект»: живые
 * данные каталога и нормативов, модель, прогоны имитации — одна функция resultsFromInputs, так
 * что числа совпадают с проектом, созданным на тех же параметрах (§5.6). В БД ничего не
 * пишется. Ответ: `{ versions, summary, warnings, results }`.
 *
 * Ограничение частоты: 60 запросов за 15 минут с одного IP (429 с Retry-After) — расчёт с
 * имитацией занимает процессор, а вход не нужен.
 */

/** Наибольший размер тела, байт. */
const MAX_BODY_BYTES = 200_000;
const RATE = { limit: 60, windowMs: 15 * 60 * 1000 } as const;
const FIELDS: ReadonlySet<string> = new Set(["facility", "params", "scenarios"]);

export async function POST(request: Request) {
  const limited = await rateLimit(`api:calc:ip:${clientIp(request.headers)}`, RATE);
  if (!limited.ok) return tooManyRequests(limited.retryAfterSec);

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (!body.ok) return body.response;
  if (!isPlainObject(body.value)) {
    return apiError(422, "Тело запроса — объект { facility, params?, scenarios? }");
  }
  const extra = unknownFields(body.value, FIELDS);
  if (extra.length > 0) return apiError(422, `Неизвестные поля ${extra.join(", ")} — допустимы facility, params, scenarios`);
  const facility = facilityOf(body.value.facility);
  if (!facility) return apiError(422, `facility — тип объекта: ${FACILITY_HINT}`);

  let live;
  try {
    live = await loadLiveInputs(prisma, facility);
  } catch (e) {
    return dbUnavailable("POST /api/v1/calculate", e);
  }
  const input = checkCalcInput(live, facility, body.value.params, body.value.scenarios);
  if (!input.ok) return apiError(422, input.error, input.details);

  try {
    const { results } = resultsFromInputs(live, { facility, params: input.params, scenarios: input.scenarios });
    return apiJson({
      versions: calcVersions(results, live),
      summary: summarizeResults(results),
      conclusion: results.conclusion,
      warnings: input.warnings,
      results,
    });
  } catch (e) {
    console.error("POST /api/v1/calculate: расчёт не выполнен", e);
    return apiError(500, "Расчёт не выполнен из-за внутренней ошибки — повторите запрос; если ошибка повторяется, сообщите администратору");
  }
}
