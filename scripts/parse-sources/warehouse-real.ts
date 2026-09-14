// Curated REAL warehouse robotics products for the "retail → warehouse" facility type.
//
// Sourcing method (per docs/superpowers/specs/2026-08-30-real-sourced-data-design.md): specs are
// taken only from live public pages (see each `sourceUrl` + `lastVerified`); PRICES are shown as
// clearly-labelled ESTIMATE ranges — industrial-robot list prices are not published, so every
// price is a third-party estimate, never an official quote (`priceEstimated: true`, `priceBasis`
// explains). `priceUsd` = rounded midpoint of [priceLowUsd, priceHighUsd] and is what the engine
// computes with. Full per-figure provenance + the "verify before a live demo" caveat live in
// docs/data-provenance.md.
//
// RELATIVE import (not the "@/" alias): this module is imported by scripts/seed.ts, which runs
// under tsx, and tsx does not resolve tsconfig path aliases.
import type { CapacityBasis } from "../../lib/economics/types";

export type CuratedSolution = {
  /**
   * Идентичность строки в базе (М-2). Ключ upsert'а — он, а не имя: переименование в этом
   * файле обновит существующую строку, а не заведёт вторую, которую держит живой сохранённый
   * расчёт и которой после этого некому обновлять цену.
   *
   * Значение обязано совпадать с бэкфиллом в
   * prisma/migrations/20260913120000_solution_slug/migration.sql — иначе забэкфилленная строка
   * останется сиротой, а сев заведёт рядом вторую.
   */
  slug: string;
  categorySlug: "amr" | "asrs";
  name: string;
  vendor: string;
  capacityPerUnit: number;
  capacityUnit: string;
  capacityBasis: CapacityBasis;
  priceUsd: number; // MUST equal round((priceLowUsd + priceHighUsd) / 2)
  priceLowUsd: number;
  priceHighUsd: number;
  priceEstimated: true;
  priceBasis: string;
  maintenanceUsdYear: number;
  energyUsdYear: number;
  licensingUsdYear: number;
  specs: Record<string, number | string>;
  sourceUrl: string;
  lastVerified: string; // ISO date the citation was checked
};

export const WAREHOUSE_REAL: CuratedSolution[] = [
  {
    // Autonomous case-handling robot (ACR). Clean per-robot throughput.
    slug: "haipick-a42t",
    categorySlug: "amr",
    name: "HaiPick A42T",
    vendor: "Hai Robotics",
    capacityPerUnit: 63, // totes/hr per robot (A42T-E2) — hairobotics.com
    capacityUnit: "тотов/час",
    capacityBasis: "PER_HOUR_FLOW",
    priceLowUsd: 40000,
    priceHighUsd: 80000,
    priceUsd: 60000, // midpoint
    priceEstimated: true,
    priceBasis:
      "Цена — оценка GoASRS ($40–80k/робот, 3rd-party); официальная цена по запросу. " +
      "OPEX оценочно: обслуживание ~8% CAPEX/год, энергия по потреблению класса ACR.",
    maintenanceUsdYear: 4800, // ~8% of midpoint price/yr (rule of thumb, Robotomated)
    energyUsdYear: 350, // ~1 kW × ~4000 ч × ~$0.08/кВтч (оценка)
    licensingUsdYear: 3000, // HAIQ software, оценка
    specs: { payloadKg: 50, storageHeightM: 6, totesPerHour: 63, casesSimultaneous: 9 },
    sourceUrl: "https://www.hairobotics.com/robots/haipick-a42t",
    lastVerified: "2026-08-30",
  },
  {
    // Goods-to-person AS/RS, modelled per pick station (same grain as AutoStore below).
    slug: "exotec-skypod-station",
    categorySlug: "asrs",
    name: "Exotec Skypod (станция)",
    vendor: "Exotec",
    capacityPerUnit: 500, // picks/hr per station (cited range 400–600) — exotec.com
    capacityUnit: "отборов/час (станция)",
    capacityBasis: "PER_HOUR_FLOW",
    priceLowUsd: 100000,
    priceHighUsd: 500000,
    priceUsd: 300000, // midpoint
    priceEstimated: true,
    priceBasis:
      "Цена — оценка Robotomated ($100–500k за станцию GTP; полная система $2–10M); " +
      "не официальный прайс. OPEX оценочно (обслуживание ~8% CAPEX/год).",
    maintenanceUsdYear: 24000, // ~8% of midpoint/yr
    energyUsdYear: 2000, // станция + пул роботов (оценка)
    licensingUsdYear: 6000, // ПО/поддержка (оценка)
    specs: { picksPerHourPerStation: 500, robotHeightM: 12, robotsPerStation: "30-100+" },
    sourceUrl: "https://www.exotec.com/skypod-automated-storage-retrieval-system/",
    lastVerified: "2026-08-30",
  },
  {
    // Cube-storage AS/RS, modelled per port/workstation.
    slug: "autostore-port",
    categorySlug: "asrs",
    name: "AutoStore (порт)",
    vendor: "AutoStore",
    capacityPerUnit: 650, // bin presentations/hr per port (RelayPort) — autostoresystem.com
    capacityUnit: "презентаций/час (порт)",
    capacityBasis: "PER_HOUR_FLOW",
    priceLowUsd: 100000,
    priceHighUsd: 500000,
    priceUsd: 300000, // midpoint (per-station GTP class)
    priceEstimated: true,
    priceBasis:
      "Цена — оценка per-station GTP $100–500k (Robotomated); полная система $3–6M [Kardex]; " +
      "не официальный прайс. Робот ~0.1 кВт [AutoStore]. OPEX оценочно (~8% CAPEX/год).",
    maintenanceUsdYear: 24000, // ~8% of midpoint/yr
    energyUsdYear: 1500, // ~0.1 кВт/робот × пул (оценка)
    licensingUsdYear: 6000,
    specs: {
      binsPerHourPerPort: 650,
      binsPerRobotHour: 30,
      robotPowerKw: 0.1,
      fullSystemUsd: "3M-6M",
    },
    sourceUrl: "https://www.autostoresystem.com/benefits/high-throughput",
    lastVerified: "2026-08-30",
  },
];
