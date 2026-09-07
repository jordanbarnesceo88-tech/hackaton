import { CapacityBasis } from "@prisma/client";

/**
 * Классы решений — обобщённые виды техники, а не конкретные модели.
 *
 * Существуют затем, чтобы расширение таксономии не вело в пустые экраны: вендорских решений
 * с проверенными ценами мало, и заводить их пачками «из интернета» запрещено — это ровно та
 * выдумка, которую docs/data-provenance.md обещает не допускать. Класс решает это иначе: он
 * не притворяется продуктом. У него диапазон вместо цены, прочерк вместо вендора и ссылка на
 * источник, где диапазон опубликован.
 *
 * ПРАВИЛО, КОТОРОЕ НЕЛЬЗЯ ОСЛАБЛЯТЬ: класс заводится только если ОБА конца обоих диапазонов
 * — цены и производительности — взяты из источника. Изначально классов планировалось
 * двенадцать; осталось семь. По AGV-тягачам, роботам дезинфекции, AS/RS и ряду других
 * открытые источники дают цену, но не дают производительность на единицу — а движку нужна
 * именно она. Недостающий конец диапазона не достраивается «по смыслу»: класс просто не
 * заводится, и ветка закрывается другим классом или остаётся непокрытой честно.
 *
 * lastVerified — дата, когда источник открывали. npm run check:sources следит за возрастом.
 */
export type SolutionClassSeed = {
  slug: string;
  name: string;
  categorySlug: string;
  priceLowUsd: number;
  priceHighUsd: number;
  capacityLow: number;
  capacityHigh: number;
  capacityUnit: string;
  capacityBasis: CapacityBasis;
  maintenanceUsdYear: number;
  energyUsdYear: number;
  licensingUsdYear: number;
  sourceUrl: string;
  capacitySourceUrl: string;
  lastVerified: string;
};

export const SOLUTION_CLASSES: SolutionClassSeed[] = [
  {
    slug: "class-amr-transport",
    name: "AMR: транспортировка и подбор (класс)",
    categorySlug: "class-amr-transport",
    priceLowUsd: 25000,
    priceHighUsd: 150000,
    // 120 отборов/час — теоретический предел на машину при цикле 30 с; 70–90 — фактически,
    // с учётом очередей и задержек системы. Взят весь опубликованный интервал.
    capacityLow: 70,
    capacityHigh: 120,
    capacityUnit: "отборов/час",
    capacityBasis: CapacityBasis.PER_HOUR_FLOW,
    maintenanceUsdYear: 9000,
    energyUsdYear: 1500,
    licensingUsdYear: 4000,
    sourceUrl: "https://meshautomationinc.com/amr-cost-2026/",
    capacitySourceUrl:
      "https://www.smartloadinghub.com/insights/agv-amr/measuring-agv-performance-performance-metrics-resilient/",
    lastVerified: "2026-09-07",
  },
  {
    slug: "class-palletizer",
    name: "Робот-паллетайзер (класс)",
    categorySlug: "class-palletizer",
    priceLowUsd: 50000,
    priceHighUsd: 250000,
    // 15–130 единиц в минуту по опубликованному диапазону — переведено в час без изменения
    // границ (15×60 и 130×60).
    capacityLow: 900,
    capacityHigh: 7800,
    capacityUnit: "коробок/час",
    capacityBasis: CapacityBasis.PER_HOUR_FLOW,
    maintenanceUsdYear: 14000,
    energyUsdYear: 3000,
    licensingUsdYear: 5000,
    sourceUrl: "https://standardbots.com/blog/robotic-palletizing-cost",
    capacitySourceUrl:
      "https://www.blueskyrobotics.ai/post/robotic-depalletization-and-robotic-palletizing-equipment-what-manufacturers-need-to-know-in-2026",
    lastVerified: "2026-09-07",
  },
  {
    slug: "class-sorter",
    name: "Сортировочный робот (класс)",
    categorySlug: "class-sorter",
    priceLowUsd: 25000,
    priceHighUsd: 100000,
    capacityLow: 1200,
    capacityHigh: 6000,
    capacityUnit: "посылок/час",
    capacityBasis: CapacityBasis.PER_HOUR_FLOW,
    maintenanceUsdYear: 8000,
    energyUsdYear: 2000,
    licensingUsdYear: 4500,
    sourceUrl: "https://standardbots.com/blog/what-are-sorting-robots",
    capacitySourceUrl: "https://english.news.cn/20260816/ad2f0242af8648c2ab4c9260135a6daf/c.html",
    lastVerified: "2026-09-07",
  },
  {
    slug: "class-cleaning",
    name: "Робот-уборщик промышленный (класс)",
    categorySlug: "class-cleaning",
    priceLowUsd: 15000,
    priceHighUsd: 80000,
    capacityLow: 700,
    capacityHigh: 4860,
    capacityUnit: "м²/час",
    capacityBasis: CapacityBasis.PER_HOUR_FLOW,
    maintenanceUsdYear: 3500,
    energyUsdYear: 900,
    licensingUsdYear: 1800,
    sourceUrl: "https://www.grabarobot.com/robots/cleaning-robot/",
    capacitySourceUrl: "https://en.orionstar.com/ai-robots/254.html",
    lastVerified: "2026-09-07",
  },
  {
    slug: "class-cobot-pickplace",
    name: "Кобот: pick-and-place (класс)",
    categorySlug: "class-cobot-pickplace",
    priceLowUsd: 40000,
    priceHighUsd: 150000,
    capacityLow: 400,
    capacityHigh: 800,
    capacityUnit: "циклов/час",
    capacityBasis: CapacityBasis.PER_HOUR_FLOW,
    maintenanceUsdYear: 6000,
    energyUsdYear: 1200,
    licensingUsdYear: 3500,
    sourceUrl: "https://standardbots.com/blog/collaborative-robot-prices-the-ultimate-guide",
    capacitySourceUrl:
      "https://industrialmonitordirect.com/blogs/knowledgebase/selecting-industrial-robot-by-speed-application-requirements-guide",
    lastVerified: "2026-09-07",
  },
  {
    slug: "class-service-delivery",
    name: "Сервисный робот доставки (класс)",
    categorySlug: "class-service-delivery",
    priceLowUsd: 15000,
    priceHighUsd: 40000,
    // 25–30 доставок в сутки — измеренная выработка Moxi в детской больнице Лос-Анджелеса,
    // причём источник отмечает, что это примерно половина возможностей машины. Верхнюю
    // границу НЕ поднимали: «примерно половина» — это не число.
    capacityLow: 25,
    capacityHigh: 30,
    capacityUnit: "доставок/сутки",
    capacityBasis: CapacityBasis.PER_DAY_FLOW,
    maintenanceUsdYear: 3000,
    energyUsdYear: 600,
    licensingUsdYear: 2400,
    sourceUrl: "https://relayrobotics.com/blog/cost-savings-of-autonomous-delivery-robots-for-hospitals-and-hotels",
    capacitySourceUrl: "https://www.chla.org/blog/hospital-news/moxi-robot-delivering-meds-and-stealing-hearts",
    lastVerified: "2026-09-07",
  },
  {
    slug: "class-ai-inspection",
    name: "ИИ-инспекция качества (класс)",
    categorySlug: "class-ai-inspection",
    priceLowUsd: 30000,
    priceHighUsd: 200000,
    capacityLow: 10000,
    capacityHigh: 72000,
    capacityUnit: "деталей/час",
    capacityBasis: CapacityBasis.PER_HOUR_FLOW,
    maintenanceUsdYear: 12000,
    energyUsdYear: 1500,
    licensingUsdYear: 18000,
    sourceUrl: "https://averroes.ai/blog/automated-optical-inspection-price",
    capacitySourceUrl: "https://ifactoryapp.com/article/ai-vision-inspection-manufacturing-defect-detection",
    lastVerified: "2026-09-07",
  },
];
