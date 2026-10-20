import type { ProductSeed } from "../../tz/types";
import data from "./catalog.generated.json";

/**
 * Каталог продуктов из данных организатора (T1.1): все 187 id каталога организатора на уровне
 * идентификации, 57 обогащённых кураторских продуктов с источником у каждой характеристики и
 * продукты из «Примеров решений». Файл catalog.generated.json пишет генератор
 * scripts/gen-organizer-seed.ts; руками его не правят. Порядок — по slug.
 *
 * Приведение через unknown: TypeScript выводит из JSON широкие типы (строки вместо литералов
 * origin/level/flags), а форма проверяется тестом organizer.test.ts на каждой записи.
 */
/** Floor cleaning can be considered in all three facilities; clinical disinfection is separate.
 * Generic warehouse carriers are not a proven hospital delivery workflow. No numbers change.
 */
export function withApplicableScopes(product: ProductSeed): ProductSeed {
  if (product.solutionType === "cleaner") return { ...product,
    processes: ["cleaning", "terminal-cleaning", "hospital-cleaning"], facilityTypes: ["warehouse", "airport", "medical"] };
  if (["dikom-dmr-300-carrier-b", "moros-amr-100", "ronavi-m", "ronavi-sd"].includes(product.slug)) {
    return { ...product, processes: product.processes.filter(process => process !== "hospital-delivery"), facilityTypes: ["warehouse"] };
  }
  return product;
}

export const CATALOG: readonly ProductSeed[] = (data as unknown as ProductSeed[]).map(withApplicableScopes);

const BY_SLUG: ReadonlyMap<string, ProductSeed> = new Map(CATALOG.map((p) => [p.slug, p]));

/** Продукт по slug; undefined — такого продукта в данных организатора нет. */
export function catalogProduct(slug: string): ProductSeed | undefined {
  return BY_SLUG.get(slug);
}
