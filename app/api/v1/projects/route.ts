import { API_AUTH_MESSAGES, apiUser } from "@/lib/api/auth";
import { calcVersions, checkCalcInput, FACILITY_HINT, facilityOf, summarizeResults } from "@/lib/api/calc";
import {
  apiError,
  apiJson,
  dbUnavailable,
  isPlainObject,
  prismaCode,
  readJsonBody,
  tooManyRequests,
  unknownFields,
} from "@/lib/api/http";
import { rateLimit } from "@/lib/auth/rate-limit";
import { prisma } from "@/lib/db/client";
import { insertProject } from "@/lib/projects/queries";
import { loadLiveInputs, type LiveInputs } from "@/lib/projects/recalc";
import { sanitizeProjectName } from "@/lib/projects/validate";

/**
 * POST /api/v1/projects — создать проект пользователя с расчётом (ТЗ §3.1.3, §3.8.1: объект из
 * внешней системы — WMS, ERP, 1С — попадает в платформу без ручного ввода). Нужна сессия
 * (cookie после входа на сайте).
 *
 * Тело: `{ name, facility, params?, objectName?, scenarios? }`. Проверка та же, что у формы
 * «Новый проект» и загрузки файла: неизвестный ключ параметра, неверный тип или единица — 422
 * со списком ParamIssue; значения вне диапазона организатора принимаются с предупреждением.
 * Недостающие параметры получают базовые значения организатора. Сервер сам считает модель и
 * имитацию и сохраняет проект с версиями модели и данных (§3.1.5). Ответ 201:
 * `{ id, url, versions, summary, warnings, results }` и заголовок Location.
 */

const MAX_BODY_BYTES = 200_000;
/** Проектов за 15 минут на пользователя: каждый — расчёт с имитацией и запись в БД. */
const RATE = { limit: 30, windowMs: 15 * 60 * 1000 } as const;
const FIELDS: ReadonlySet<string> = new Set(["name", "facility", "params", "objectName", "scenarios"]);
const OBJECT_NAME_MAX = 200;

export async function POST(request: Request) {
  let userId: string | null;
  try {
    userId = await apiUser();
  } catch (e) {
    return dbUnavailable("POST /api/v1/projects", e);
  }
  if (!userId) return apiError(401, API_AUTH_MESSAGES.userRequired);
  const limited = await rateLimit(`api:projects:user:${userId}`, RATE);
  if (!limited.ok) return tooManyRequests(limited.retryAfterSec);

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (!body.ok) return body.response;
  const raw = body.value;
  if (!isPlainObject(raw)) return apiError(422, "Тело запроса — объект { name, facility, params?, objectName?, scenarios? }");
  const extra = unknownFields(raw, FIELDS);
  if (extra.length > 0) {
    return apiError(422, `Неизвестные поля ${extra.join(", ")} — допустимы name, facility, params, objectName, scenarios`);
  }
  const name = sanitizeProjectName(raw.name);
  if (!name) return apiError(422, "name — название проекта от 1 до 120 символов, например «РЦ Подольск»");
  const facility = facilityOf(raw.facility);
  if (!facility) return apiError(422, `facility — тип объекта: ${FACILITY_HINT}`);
  let objectName: string | null = null;
  if (raw.objectName !== undefined && raw.objectName !== null) {
    if (typeof raw.objectName !== "string" || raw.objectName.trim().length > OBJECT_NAME_MAX) {
      return apiError(422, `objectName — строка не длиннее ${OBJECT_NAME_MAX} символов`);
    }
    objectName = raw.objectName.trim() === "" ? null : raw.objectName.trim();
  }

  let live: LiveInputs;
  try {
    live = await loadLiveInputs(prisma, facility);
  } catch (e) {
    return dbUnavailable("POST /api/v1/projects", e);
  }
  const input = checkCalcInput(live, facility, raw.params, raw.scenarios);
  if (!input.ok) return apiError(422, input.error, input.details);

  try {
    const { id, results } = await insertProject(prisma, live, {
      userId,
      name,
      objectName,
      facility,
      params: input.params,
      paramsSource: { kind: "api" },
      scenarios: input.scenarios,
    });
    return apiJson(
      {
        id,
        url: `/projects/${id}`,
        versions: calcVersions(results, live),
        summary: summarizeResults(results),
        conclusion: results.conclusion,
        warnings: input.warnings,
        results,
      },
      { status: 201, headers: { Location: `/api/v1/projects/${id}` } },
    );
  } catch (e) {
    // Пользователя из сессии нет в БД (база пересоздана) — внешний ключ не сходится.
    if (prismaCode(e) === "P2003") return apiError(401, "Сессия устарела — войдите на сайте заново");
    return dbUnavailable("POST /api/v1/projects", e);
  }
}
