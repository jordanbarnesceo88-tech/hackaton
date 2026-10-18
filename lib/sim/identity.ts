import { stableJson } from "../tz/version";
import { SIM_MODEL_VERSION, type SimInput, type SimSummaryStored } from "./types";
import { SPATIAL_MODEL_VERSION } from "./spatial-version";

/** Полный канонический вход без потери NaN/Infinity у отклонённых прогонов. */
export function simInputIdentity(input: SimInput): string {
  const normalized = JSON.parse(JSON.stringify(input, (_key, value: unknown) =>
    typeof value === "number" && !Number.isFinite(value) ? { simNumber: String(value) } : value,
  ));
  return stableJson({ version: SIM_MODEL_VERSION, input: normalized });
}

/** Recalculation may carry a canonical older receipt; this never makes that receipt current. */
export function legacySimInputIdentityVersion(key: unknown, input: SimInput): string | null {
  if (typeof key !== "string" || key.length === 0 || key.length > 1_900_000) return null;
  try {
    const parsed: unknown = JSON.parse(key);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const value = parsed as Record<string, unknown>;
    if (Object.keys(value).length !== 2 || !Object.hasOwn(value, "input") || !Object.hasOwn(value, "version") ||
        typeof value.version !== "string" || !/^sim-(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})$/.test(value.version)) return null;
    const previous = value.version.slice(4).split(".").map(Number), current = SIM_MODEL_VERSION.slice(4).split(".").map(Number);
    const different = previous.findIndex((number, index) => number !== current[index]);
    if (different < 0 || previous[different]! > current[different]!) return null;
    const normalized = JSON.parse(simInputIdentity(input)) as { input: unknown };
    if (stableJson(value) !== key || stableJson(value.input) !== stableJson(normalized.input)) return null;
    return value.version;
  } catch {
    return null;
  }
}

/** Старые сводки без полного входа нельзя использовать как актуальное подтверждение. */
export function simSummaryMatchesInput(
  summary: SimSummaryStored | null | undefined,
  input: SimInput | null | undefined,
): summary is SimSummaryStored {
  return !!summary && !!input &&
    summary.simModelVersion === (input.transportWorkflow === "closed-pod-1" ? SPATIAL_MODEL_VERSION : SIM_MODEL_VERSION) &&
    summary.inputKey === simInputIdentity(input) &&
    summary.seed === input.seed &&
    summary.fleet === Math.floor(input.robots.count) &&
    summary.requiredPerH === input.demand.peakPerH;
}
