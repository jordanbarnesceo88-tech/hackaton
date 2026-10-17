import { apiError } from "../api/http";
import { CalculationRequestError } from "./service";
import { IdempotencyConflict, JobQueueFull, JobHistoryFull, JobHistoryRemoved, JobStillActive } from "./types";

export function jobHttpError(error: unknown): Response {
  if (error instanceof CalculationRequestError) return apiError(error.status, error.message, error.details);
  if (error instanceof IdempotencyConflict) return apiError(error.status, error.message);
  if (error instanceof JobQueueFull) return apiError(error.status, error.message, undefined, { "Retry-After": String(error.retryAfterSec) });
  if (error instanceof JobHistoryFull || error instanceof JobHistoryRemoved || error instanceof JobStillActive) return apiError(error.status, error.message, { code: error.code });
  const diagnostic = error && typeof error === "object" ? error as { name?: unknown; code?: unknown } : {};
  console.error("calculation-jobs: operation failed", {
    name: typeof diagnostic.name === "string" ? diagnostic.name : "UnknownError",
    code: typeof diagnostic.code === "string" ? diagnostic.code : undefined,
  });
  return apiError(503, "Не удалось выполнить операцию с расчётом. Повторите отправку с тем же ключом: это не создаст дубликат");
}

export function foreignOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) return false;
  try {
    const url = new URL(request.url);
    // Next may construct request.url with its bind address inside a container.
    // Host is the browser's destination; do not trust arbitrary forwarded-host values.
    const host = request.headers.get("host") ?? url.host;
    if (/[\s,/?#@]/.test(host)) return true;
    const destination = new URL(`${url.protocol}//${host}`);
    return new URL(origin).origin !== destination.origin;
  } catch { return true; }
}
