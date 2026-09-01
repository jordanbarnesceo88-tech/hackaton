// Regional labor-cost + energy-factor presets for RF regions (#8a). Opt-in convenience: picking a
// region sets `laborCostPerHourUsd` and `energyCostFactor` (both remain editable). Sourced, not
// invented — see docs/data-provenance.md for the per-region citations + the "verify before a live
// demo" caveat.
//
// laborCostPerHourUsd derivation: cited 2025 average MONTHLY wage (₽, Rosstat-based) ÷ ~168 work
// hours/month ÷ ~90 ₽/$ (the app's USD_TO_RUB), rounded. energyCostFactor is an APPROXIMATE
// regional index relative to Москва = 1.0 (RF industrial-tariff variation is ~±30%), not a
// per-kWh figure.

export type RegionPreset = {
  id: string;
  name: string;
  laborCostPerHourUsd: number;
  energyCostFactor: number; // multiplier on energyUsdYear; Москва = 1.0 reference
};

export const REGION_PRESETS: RegionPreset[] = [
  // Москва ~180 860 ₽/мес → 180860/168/90 ≈ $12.0/ч
  { id: "moscow", name: "Москва", laborCostPerHourUsd: 12.0, energyCostFactor: 1.0 },
  // Санкт-Петербург ~121 475 ₽/мес → ≈ $8.0/ч
  { id: "spb", name: "Санкт-Петербург", laborCostPerHourUsd: 8.0, energyCostFactor: 0.95 },
  // РФ-среднее ~100 360 ₽/мес (2025) → ≈ $6.6/ч
  { id: "rf-avg", name: "РФ — среднее", laborCostPerHourUsd: 6.6, energyCostFactor: 0.9 },
  // Низкозатратный регион (Сев. Кавказ, напр. Ингушетия/Чечня ~46 281 ₽/мес) → ≈ $3.1/ч
  { id: "low-cost", name: "Низкозатратный регион (СКФО)", laborCostPerHourUsd: 3.1, energyCostFactor: 0.8 },
];
