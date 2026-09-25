/**
 * Общие ответы и разбор запроса для API v1 (ТЗ §3.8, §4.2.5). Всё, что отвечает обработчик,
 * — JSON; ошибка всегда имеет вид `{ error: string, details?: unknown }`, где `error` — по-русски:
 * что не так и как исправить (требование ТЗ к сообщениям об ошибках).
 *
 * Модуль без Next и без Prisma: работает с Web Request/Response, поэтому его функции
 * проверяются unit-тестами на обычных `new Request(...)`.
 */

/** Тело ответа с ошибкой. */
export type ApiErrorBody = { error: string; details?: unknown };

/** Заголовки всех ответов API: ответы зависят от данных и входа, кешировать их нельзя. */
export const API_HEADERS: Readonly<Record<string, string>> = { "Cache-Control": "no-store" };

/** JSON-ответ API со статусом и заголовками no-store. */
export function apiJson(data: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return Response.json(data, { status: init.status ?? 200, headers: { ...API_HEADERS, ...init.headers } });
}

/** Ответ с ошибкой `{ error, details? }`. */
export function apiError(status: number, error: string, details?: unknown, headers?: Record<string, string>): Response {
  const body: ApiErrorBody = details === undefined ? { error } : { error, details };
  return apiJson(body, { status, headers });
}

/** 429 с заголовком Retry-After (ТЗ §4.4: защита публичного расчёта от перегрузки). */
export function tooManyRequests(retryAfterSec: number): Response {
  const sec = Math.max(1, Math.ceil(retryAfterSec));
  return apiError(429, `Слишком много запросов, повторите через ${sec} с`, { retryAfterSec: sec }, {
    "Retry-After": String(sec),
  });
}

/** 503: база не ответила. Причина пишется только в лог сервера. */
export function dbUnavailable(where: string, e: unknown): Response {
  console.error(`${where}: ошибка базы данных`, e);
  return apiError(503, "База данных временно недоступна — повторите запрос через минуту");
}

/** Код ошибки Prisma (P2002, P2003 …) или null. */
export function prismaCode(e: unknown): string | null {
  return typeof e === "object" && e !== null && "code" in e && typeof (e as { code: unknown }).code === "string"
    ? (e as { code: string }).code
    : null;
}

/** Объект-словарь (не массив, не null, не экземпляр класса). */
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v) as unknown;
  return proto === Object.prototype || proto === null;
}

/** Результат чтения тела: значение JSON или готовый ответ с ошибкой. */
export type ReadJsonResult = { ok: true; value: unknown } | { ok: false; response: Response };

/** Размер в человекочитаемом виде для сообщений: «200 КБ», «4 МБ». */
function sizeText(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} МБ`.replace(".", ",");
  return `${Math.round(bytes / 1024)} КБ`;
}

/** Тип содержимого — JSON (application/json или application/*+json, с параметрами или без). */
export function isJsonContentType(value: string | null): boolean {
  if (!value) return false;
  const type = value.split(";")[0]?.trim().toLowerCase() ?? "";
  return type === "application/json" || (type.startsWith("application/") && type.endsWith("+json"));
}

/**
 * Читает и разбирает JSON-тело запроса с ограничением размера.
 *
 * - Content-Type должен быть JSON (415 иначе). Это не формальность: простая HTML-форма с
 *   другого сайта не может отправить application/json без предварительного CORS-запроса,
 *   поэтому требование закрывает подделку запроса от имени вошедшего пользователя (CSRF) для
 *   записей по сессии.
 * - Размер ограничен `maxBytes` (413): по Content-Length до чтения и по фактическим байтам при
 *   чтении — тело без Content-Length (chunked) не может обойти предел.
 * - Пустое тело и не-JSON — 400 с подсказкой.
 */
export async function readJsonBody(req: Request, maxBytes: number): Promise<ReadJsonResult> {
  if (!isJsonContentType(req.headers.get("content-type"))) {
    return {
      ok: false,
      response: apiError(415, "Передайте тело запроса в формате JSON с заголовком Content-Type: application/json"),
    };
  }
  const tooLarge = () => ({
    ok: false as const,
    response: apiError(413, `Тело запроса больше ${sizeText(maxBytes)} — сократите данные или разбейте их на части`),
  });
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return tooLarge();

  const chunks: Uint8Array[] = [];
  let total = 0;
  if (req.body) {
    const reader = req.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return tooLarge();
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  const text = new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, "");
  if (text.trim() === "") {
    return { ok: false, response: apiError(400, "Тело запроса пустое — передайте JSON") };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return { ok: false, response: apiError(400, "Тело запроса не разобрано как JSON — проверьте кавычки и запятые", { reason }) };
  }
}

/** Лишние поля объекта — для отказа «неизвестные поля …» (ввод отклоняется, а не подчищается). */
export function unknownFields(obj: Record<string, unknown>, allowed: ReadonlySet<string>): string[] {
  return Object.keys(obj).filter((k) => !allowed.has(k) && obj[k] !== undefined);
}
