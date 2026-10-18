import type { ParamValues } from "../tz/types";

export type DemandMix = { inbound: number; outbound: number; internal: number };
export const LEGACY_DEMAND_MIX: Readonly<DemandMix> = Object.freeze({ inbound: 0.5, outbound: 0.5, internal: 0 });

export function validDemandMix(value: unknown): value is DemandMix {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const mix = value as Record<string, unknown>;
  return Object.keys(mix).length === 3 && ["inbound", "outbound", "internal"].every(key =>
    typeof mix[key] === "number" && Number.isFinite(mix[key]) && mix[key] >= 0 && mix[key] <= 1) &&
    Math.abs(Number(mix.inbound) + Number(mix.outbound) + Number(mix.internal) - 1) < 1e-9;
}

/** Missing only in historical inputs, whose generator used the fixed 50/50 mix. */
export function demandMixOf(demand: { mix?: DemandMix }): Readonly<DemandMix> {
  return demand.mix ?? LEGACY_DEMAND_MIX;
}

export function demandMixFromParams(params: ParamValues): DemandMix {
  const read = (key: string) => {
    const value = params[key];
    const n = typeof value === "number" ? value : Number(String(value ?? 0).replace(",", "."));
    if (!Number.isFinite(n) || n < 0) throw new Error("Объёмы приёмки, отгрузки и внутренних перемещений должны быть неотрицательными числами");
    return n;
  };
  const inbound = read("inboundPalletsPerDay"), outbound = read("outboundPalletsPerDay"), internal = read("internalPalletMovesPerDay");
  const total = inbound + outbound + internal;
  if (!(total > 0) || !Number.isFinite(total)) throw new Error("Для состава потока нужен положительный объём перемещений");
  return { inbound: inbound / total, outbound: outbound / total, internal: internal / total };
}

/** Internal transfers need a real vacant location; no stock is removed for balanced legacy work. */
export function initialVacantStorageCount(slots: number, demand: { mix?: DemandMix; storageVacancyShare?: number }): number {
  return demandMixOf(demand).internal > 0 ? Math.floor(slots * (demand.storageVacancyShare ?? 0)) : 0;
}
