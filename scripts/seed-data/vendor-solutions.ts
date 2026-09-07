import { CapacityBasis } from "@prisma/client";

/** Демонстрационные решения по не-складским вертикалям. Складские приходят из
 *  parse-sources/warehouse-real.ts с реальными источниками; здешние помечены как демо и
 *  ценами наружу не выдаются за проверенные. */
export type VendorSolutionSeed = {
  categorySlug: string;
  name: string;
  vendor: string;
  priceUsd: number;
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
    categorySlug: "baggage-robots",
    name: "BagHandler B1",
    vendor: "SkyBots Demo Inc.",
    priceUsd: 85000,
    capacityPerUnit: 400,
    capacityUnit: "мест багажа/час",
    capacityBasis: CapacityBasis.PER_HOUR_FLOW,
    maintenanceUsdYear: 11000,
    energyUsdYear: 2500,
    licensingUsdYear: 6000,
    specs: {"beltLengthM":20,"sortAccuracyPct":99.2},
  },
  {
    categorySlug: "baggage-robots",
    name: "CargoMate C2",
    vendor: "Placeholder Automation LLC",
    priceUsd: 72000,
    capacityPerUnit: 320,
    capacityUnit: "мест багажа/час",
    capacityBasis: CapacityBasis.PER_HOUR_FLOW,
    maintenanceUsdYear: 9500,
    energyUsdYear: 2100,
    licensingUsdYear: 5000,
    specs: {"beltLengthM":15,"sortAccuracyPct":98.5},
  },
  {
    categorySlug: "autonomous-tugs",
    name: "TugBot T500",
    vendor: "SkyBots Demo Inc.",
    priceUsd: 65000,
    capacityPerUnit: 12,
    capacityUnit: "тележек одновременно",
    capacityBasis: CapacityBasis.CONCURRENT_STOCK,
    maintenanceUsdYear: 8000,
    energyUsdYear: 1800,
    licensingUsdYear: 3500,
    specs: {"towCapacityKg":5000,"speedMps":3},
  },
  {
    categorySlug: "autonomous-tugs",
    name: "RampRunner R1",
    vendor: "Demo Robotics Co.",
    priceUsd: 58000,
    capacityPerUnit: 10,
    capacityUnit: "тележек одновременно",
    capacityBasis: CapacityBasis.CONCURRENT_STOCK,
    maintenanceUsdYear: 7200,
    energyUsdYear: 1600,
    licensingUsdYear: 3000,
    specs: {"towCapacityKg":4000,"speedMps":2.5},
  },
  {
    categorySlug: "med-delivery",
    name: "MediCarry M1",
    vendor: "CareBots Demo Ltd.",
    priceUsd: 32000,
    capacityPerUnit: 60,
    capacityUnit: "доставок/день",
    capacityBasis: CapacityBasis.PER_DAY_FLOW,
    maintenanceUsdYear: 4500,
    energyUsdYear: 800,
    licensingUsdYear: 2200,
    specs: {"payloadKg":20,"batteryHours":12},
  },
  {
    categorySlug: "med-delivery",
    name: "PharmRunner P2",
    vendor: "Placeholder Automation LLC",
    priceUsd: 27000,
    capacityPerUnit: 45,
    capacityUnit: "доставок/день",
    capacityBasis: CapacityBasis.PER_DAY_FLOW,
    maintenanceUsdYear: 3800,
    energyUsdYear: 700,
    licensingUsdYear: 1800,
    specs: {"payloadKg":15,"batteryHours":10},
  },
  {
    categorySlug: "disinfection",
    name: "SaniBot UV-1",
    vendor: "CareBots Demo Ltd.",
    priceUsd: 41000,
    capacityPerUnit: 8,
    capacityUnit: "помещений/день",
    capacityBasis: CapacityBasis.PER_DAY_FLOW,
    maintenanceUsdYear: 5200,
    energyUsdYear: 1500,
    licensingUsdYear: 2500,
    specs: {"roomsM2Coverage":40,"cycleMinutes":15},
  },
  {
    categorySlug: "disinfection",
    name: "CleanWave C3",
    vendor: "Demo Robotics Co.",
    priceUsd: 36000,
    capacityPerUnit: 6,
    capacityUnit: "помещений/день",
    capacityBasis: CapacityBasis.PER_DAY_FLOW,
    maintenanceUsdYear: 4600,
    energyUsdYear: 1300,
    licensingUsdYear: 2100,
    specs: {"roomsM2Coverage":35,"cycleMinutes":18},
  },
  {
    categorySlug: "generic-mobile",
    name: "GenericAMR-Base",
    vendor: "Demo Robotics Co.",
    priceUsd: 40000,
    capacityPerUnit: 100,
    capacityUnit: "операций/час",
    capacityBasis: CapacityBasis.PER_HOUR_FLOW,
    maintenanceUsdYear: 5500,
    energyUsdYear: 1100,
    licensingUsdYear: 2800,
    specs: {"payloadKg":100,"speedMps":1},
  },
  {
    categorySlug: "generic-fixed",
    name: "GenericFixed-Base",
    vendor: "Demo Robotics Co.",
    priceUsd: 90000,
    capacityPerUnit: 300,
    capacityUnit: "операций/день",
    capacityBasis: CapacityBasis.PER_DAY_FLOW,
    maintenanceUsdYear: 11000,
    energyUsdYear: 3000,
    licensingUsdYear: 4200,
    specs: {"footprintM2":25},
  },
];
