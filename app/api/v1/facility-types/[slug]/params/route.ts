import { apiError, apiJson, dbUnavailable } from "@/lib/api/http";
import { getParamDefinitions } from "@/lib/catalog/queries";
import { paramSpecsFor } from "@/lib/data/organizer/params";
import { prisma } from "@/lib/db/client";
import { isFacilitySlug } from "@/lib/tz/processes";

/**
 * GET /api/v1/facility-types/{slug}/params — описания параметров объекта (ТЗ §3.2): ключ,
 * раздел, подпись, единица, вид поля, базовое значение и диапазон организатора, пример,
 * подсказка и источник каждого значения. По этим ключам внешняя система (WMS, ERP, 1С)
 * заполняет `params` в POST /api/v1/calculate и POST /api/v1/projects. Вход не нужен.
 *
 * Описания — из администрируемой таблицы ParamDefinition; пока данные не засеяны — из кода
 * (те же данные организатора, `source: "code"`), как и у расчёта.
 */

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isFacilitySlug(slug)) {
    return apiError(404, "Тип объекта не найден — доступны warehouse (склад), airport (аэропорт) и medical (медучреждение)");
  }
  try {
    const defs = await getParamDefinitions(prisma, slug);
    if (defs.length > 0) return apiJson({ facility: slug, source: "db", params: defs });
    return apiJson({ facility: slug, source: "code", params: paramSpecsFor(slug) });
  } catch (e) {
    return dbUnavailable(`GET /api/v1/facility-types/${slug}/params`, e);
  }
}
