import { apiError, apiJson, dbUnavailable } from "@/lib/api/http";
import { getCatalogProduct } from "@/lib/catalog/queries";
import { prisma } from "@/lib/db/client";

/**
 * GET /api/v1/catalog/{slug} — карточка продукта: вынесенные колонки, характеристики по шести
 * группам ТЗ §3.3.4 с провенансом каждой (значение как в источнике, ссылка, дата проверки,
 * признак подтверждения, альтернативы) и звенья иерархии §3.3.1. Архивный продукт тоже
 * отдаётся (`archived: true`) — на его снимок может ссылаться сохранённый проект. Вход не нужен.
 */

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (slug.length === 0 || slug.length > 120) return apiError(404, "Продукт не найден — проверьте slug");
  try {
    const product = await getCatalogProduct(prisma, slug);
    if (!product) return apiError(404, `Продукт «${slug}» не найден — список продуктов: GET /api/v1/catalog`);
    return apiJson({ ...product, updatedAt: product.updatedAt.toISOString() });
  } catch (e) {
    return dbUnavailable(`GET /api/v1/catalog/${slug}`, e);
  }
}
