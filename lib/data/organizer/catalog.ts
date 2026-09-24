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
export const CATALOG: readonly ProductSeed[] = data as unknown as ProductSeed[];

const BY_SLUG: ReadonlyMap<string, ProductSeed> = new Map(CATALOG.map((p) => [p.slug, p]));

/** Продукт по slug; undefined — такого продукта в данных организатора нет. */
export function catalogProduct(slug: string): ProductSeed | undefined {
  return BY_SLUG.get(slug);
}
