import { checkApiAdmin } from "@/lib/api/auth";
import { apiError, apiJson, dbUnavailable, readJsonBody } from "@/lib/api/http";
import { IMPORT_MAX_PRODUCTS, importProducts, validateProductSeeds } from "@/lib/api/import";
import { prisma } from "@/lib/db/client";

/**
 * POST /api/v1/catalog/import[?dryRun=1] — импорт продуктов каталога (ТЗ §3.3.2, §3.3.6, §3.8.2).
 * Доступ: администратор по сессии или `Authorization: Bearer <ADMIN_API_TOKEN>`.
 *
 * Тело — список ProductSeed (не больше IMPORT_MAX_PRODUCTS). Проверка всё-или-ничего: при
 * ошибке в любой позиции ничего не пишется, ответ 422 с ошибками по позициям. Продукты
 * записываются по правилам синхронизации (провенанс каждой характеристики, вынесенные колонки,
 * правки администратора не перезаписываются) с origin ADMIN; slug из данных организатора не
 * принимается. `dryRun=1` — только проверки, без записи. Ответ — отчёт по каждой позиции.
 */

/** Наибольший размер тела, байт: 200 карточек с источниками — около 1 МБ, с запасом. */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

export async function POST(request: Request) {
  let access;
  try {
    access = await checkApiAdmin(request);
  } catch (e) {
    return dbUnavailable("POST /api/v1/catalog/import", e);
  }
  if (!access.ok) return apiError(access.status, access.error);

  const dry = new URL(request.url).searchParams.get("dryRun");
  if (dry !== null && !["0", "1", "true", "false"].includes(dry)) {
    return apiError(422, "dryRun — 1 (только проверить) или 0 (записать)");
  }
  const dryRun = dry === "1" || dry === "true";

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (!body.ok) return body.response;
  const checked = validateProductSeeds(body.value);
  if (!checked.ok) {
    return apiError(422, checked.error, { issues: checked.issues, maxProducts: IMPORT_MAX_PRODUCTS });
  }
  try {
    const report = await importProducts(prisma, checked.seeds, { dryRun });
    return apiJson({ ...report, via: access.admin.via });
  } catch (e) {
    return dbUnavailable("POST /api/v1/catalog/import", e);
  }
}
