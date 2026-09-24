// СГЕНЕРИРОВАНО scripts/gen-organizer-seed.ts — не править руками

/**
 * Версии исходных данных организатора (дата выгрузки # первые 8 символов md5 оригинала) и
 * момент заморозки исследования открытых источников. Входят в dataVersion проекта (§3.1.5).
 */
export const ORGANIZER_DATA_VERSION = {
  datasets: "2026-09-22#4be0fac8",
  catalog: "2026-09-22#da43c64c",
  examples: "2026-09-22#6e738822",
  research: "svod 2026-09-23 + found_batch1-6@2026-09-23T21:13:10Z",
} as const;

/** Число продуктов каталога по глубине описания. */
export const CATALOG_COUNTS = {
  identification: 130,
  enriched: 57,
  examples: 1,
} as const;
