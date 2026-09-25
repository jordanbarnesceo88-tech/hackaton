import { apiJson } from "@/lib/api/http";
import { OPENAPI } from "@/lib/api/openapi";

/**
 * GET /api/v1/openapi.json — описание API в формате OpenAPI 3.1 (ТЗ §4.2.5). Документ
 * статический (собирается из кода и данных организатора этой сборки), вход не нужен.
 * Человекочитаемая версия — страница /api-docs.
 */

export async function GET() {
  return apiJson(OPENAPI);
}
