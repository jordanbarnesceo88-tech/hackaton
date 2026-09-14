import { CapacityBasis } from "@prisma/client";

/**
 * Вендорские решения по не-складским вертикалям.
 *
 * Раньше здесь лежали десять демонстрационных строк с выдуманными вендорами («SkyBots Demo
 * Inc.», «Placeholder Automation LLC»), выдуманными ценами и без единой ссылки. Половина
 * каталога читалась как макет, а не как продукт — и это хуже пустой ветки, потому что пустая
 * ветка честна. Удалены: проверено, что после этого НИ ОДИН из 47 типов объектов не остаётся
 * без решений — классы покрывают все ветки — и что ни один сохранённый расчёт на них не
 * ссылался.
 *
 * ПРАВИЛО, которое теперь стережёт тест: у вендорской строки обязаны быть ОБА источника —
 * `sourceUrl` на характеристики от производителя и `priceSourceUrl` на цену от дистрибьютора.
 * Производители прайс не публикуют, дистрибьюторы публикуют; до этого правило соблюдалось
 * наполовину, и цена оставалась оценкой без ссылки.
 *
 * Приоритет при пополнении — китайские поставщики: это то, что реально доступно, и публичная
 * документация у них не хуже западной. Западные строки остаются ориентиром верхней границы.
 */
export type VendorSolutionSeed = {
  /**
   * Идентичность строки в базе. Ключ upsert'а — он, а не имя: `name` и `categorySlug` ниже
   * можно менять свободно, сев обновит существующую строку вместо того, чтобы завести вторую
   * (М-2). Менять сам slug — значит завести НОВОЕ решение и удалить старое; уникален он
   * глобально, поэтому пересекаться с классами и складскими строками тоже нельзя (тест
   * `slug'и решений уникальны СКВОЗЬ все три источника`).
   */
  slug: string;
  categorySlug: string;
  name: string;
  vendor: string;
  priceUsd: number;
  /** Страница дистрибьютора с ценой. Производители прайс на такую технику не публикуют. */
  priceSourceUrl: string;
  /** Страница производителя с характеристиками. */
  sourceUrl: string;
  /** Дата, когда обе страницы открывали, YYYY-MM-DD. */
  lastVerified: string;
  capacityPerUnit: number;
  capacityUnit: string;
  capacityBasis: CapacityBasis;
  maintenanceUsdYear: number;
  energyUsdYear: number;
  licensingUsdYear: number;
  specs: Record<string, number>;
};

export const VENDOR_SOLUTIONS: VendorSolutionSeed[] = [
  {
    slug: "gausium-scrubber-75",
    categorySlug: "class-cleaning",
    name: "Gausium Scrubber 75",
    vendor: "Gausium",
    priceUsd: 95880,
    priceSourceUrl: "https://www.robotlab.com/cleaning-robots/store/scrubber-75-cleaning-robot",
    capacityPerUnit: 3000,
    capacityUnit: "м²/час",
    capacityBasis: CapacityBasis.PER_HOUR_FLOW,
    sourceUrl: "https://gausium.com/specs/scrubber-75/",
    lastVerified: "2026-09-09",
    // Обслуживание ≈8% CAPEX/год — то же правило, что у складских строк; энергия и лицензии
    // оценены по порядку величины и не выдаются за опубликованные цифры.
    maintenanceUsdYear: 7670,
    energyUsdYear: 1400,
    licensingUsdYear: 3200,
    specs: { scrubbingWidthMm: 750, cleanWaterTankL: 75 },
  },
];
