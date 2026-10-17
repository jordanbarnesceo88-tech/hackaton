import { stableJson } from "../tz/version";
import { SIM_MODEL_VERSION, type SimInput, type SimSummaryStored } from "./types";

/** Полный канонический вход без потери NaN/Infinity у отклонённых прогонов. */
export function simInputIdentity(input: SimInput): string {
  const normalized = JSON.parse(JSON.stringify(input, (_key, value: unknown) =>
    typeof value === "number" && !Number.isFinite(value) ? { simNumber: String(value) } : value,
  ));
  return stableJson({ version: SIM_MODEL_VERSION, input: normalized });
}

/** Старые сводки без полного входа нельзя использовать как актуальное подтверждение. */
export function simSummaryMatchesInput(
  summary: SimSummaryStored | null | undefined,
  input: SimInput | null | undefined,
): summary is SimSummaryStored {
  return !!summary && !!input &&
    summary.simModelVersion === SIM_MODEL_VERSION &&
    summary.inputKey === simInputIdentity(input) &&
    summary.seed === input.seed &&
    summary.fleet === Math.floor(input.robots.count) &&
    summary.requiredPerH === input.demand.peakPerH;
}
