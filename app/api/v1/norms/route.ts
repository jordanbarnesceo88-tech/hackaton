import { checkApiAdmin } from "@/lib/api/auth";
import { apiError, apiJson, dbUnavailable, readJsonBody } from "@/lib/api/http";
import { applyNormValues, normApiRows, validateNormUpdate } from "@/lib/api/norms";
import { getNormRows } from "@/lib/catalog/queries";
import { prisma } from "@/lib/db/client";

/**
 * Нормативы модели (ТЗ §3.5.1 — без недокументированных коэффициентов, §3.8.2 — API
 * нормативов).
 *
 * GET /api/v1/norms — все нормативы с метаданными: значение, значение по умолчанию, итоговое
 * значение расчёта, границы, происхождение, обоснование, источник. Вход не нужен.
 *
 * PUT /api/v1/norms — изменить значения. Доступ: администратор по сессии или
 * `Authorization: Bearer <ADMIN_API_TOKEN>`. Тело `{ values: { <ключ>: <число> }, reason? }`.
 * Значение прижимается к [min, max] норматива (в ответе clamped), строка помечается правкой
 * администратора, каждое изменение пишется в журнал ChangeLog. Все значения — одной транзакцией.
 */

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 20_000;

export async function GET() {
  try {
    return apiJson(normApiRows(await getNormRows(prisma)));
  } catch (e) {
    return dbUnavailable("GET /api/v1/norms", e);
  }
}

export async function PUT(request: Request) {
  let access;
  try {
    access = await checkApiAdmin(request);
  } catch (e) {
    return dbUnavailable("PUT /api/v1/norms", e);
  }
  if (!access.ok) return apiError(access.status, access.error);

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (!body.ok) return body.response;
  const checked = validateNormUpdate(body.value);
  if (!checked.ok) return apiError(422, "Нормативы не изменены — исправьте запрос", { errors: checked.errors });

  const actor = { userId: access.admin.userId, via: access.admin.via };
  try {
    const changes = await prisma.$transaction((tx) => applyNormValues(tx, checked.value, actor), {
      maxWait: 10_000,
      timeout: 30_000,
    });
    const after = normApiRows(await getNormRows(prisma));
    const byKey = new Map(after.norms.map((n) => [n.key, n.effectiveValue]));
    return apiJson({
      changes: changes.map((c) => ({ ...c, effectiveValue: byKey.get(c.key) ?? null })),
      updated: changes.filter((c) => c.status === "updated").length,
      unchanged: changes.filter((c) => c.status === "unchanged").length,
    });
  } catch (e) {
    return dbUnavailable("PUT /api/v1/norms", e);
  }
}
