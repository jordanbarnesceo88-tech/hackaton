import { parseCatalogQuery } from "@/lib/api/catalog";
import { apiError, apiJson, dbUnavailable } from "@/lib/api/http";
import { getCatalogList, latestDataRelease } from "@/lib/catalog/queries";
import { prisma } from "@/lib/db/client";

/**
 * GET /api/v1/catalog — каталог решений с фильтрами, поиском, сортировкой и страницами по 50
 * (ТЗ §3.3.7; §3.8 — выгрузка каталога во внешние системы и аналитику ФЦ БАС). Вход не нужен:
 * каталог открыт гостю (§3.1.2).
 *
 * Параметры: facility, process, solutionType, status, level, q, sort, page, confirmedOnly, raas.
 * Ответ: `{ items, total, page, pageSize, pageCount, dataRelease }`; строки — вынесенные
 * колонки продукта, полная карточка с провенансом — GET /api/v1/catalog/{slug}.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const parsed = parseCatalogQuery(new URL(request.url).searchParams);
  if (!parsed.ok) return apiError(422, "Неверные параметры запроса каталога — исправьте и повторите", { errors: parsed.errors });
  try {
    const list = await getCatalogList(prisma, parsed.filters);
    const release = await latestDataRelease(prisma);
    return apiJson({
      ...list,
      dataRelease: release ? { version: release.version, seededAt: release.seededAt.toISOString() } : null,
    });
  } catch (e) {
    return dbUnavailable("GET /api/v1/catalog", e);
  }
}
