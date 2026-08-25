import type { FacilityParams, AssumptionValues } from "@/lib/economics/types";

// Saved-analysis payloads arrive from the client and are persisted as-is (jsonb), so validate
// shape and bound sizes here before they touch the DB. Pure + framework-free so it's unit
// testable; the solution-existence check lives in the server action (needs DB access).

export const NAME_MAX_LEN = 120;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Trim and length-cap a user-supplied name; null if not a non-empty string. */
export function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (t.length === 0) return null;
  return t.slice(0, NAME_MAX_LEN);
}

/** Validate facility params: three required finite numbers + optional finite peakConcurrent. */
export function validateParams(raw: unknown): FacilityParams | null {
  if (!isPlainObject(raw)) return null;
  const { areaM2, opsPerDay, staffCount, peakConcurrent } = raw;
  if (!isFiniteNumber(areaM2) || !isFiniteNumber(opsPerDay) || !isFiniteNumber(staffCount)) {
    return null;
  }
  if (peakConcurrent !== undefined && !isFiniteNumber(peakConcurrent)) return null;
  const out: FacilityParams = { areaM2, opsPerDay, staffCount };
  if (peakConcurrent !== undefined) out.peakConcurrent = peakConcurrent;
  return out;
}

const ASSUMPTION_KEYS: (keyof AssumptionValues)[] = [
  "laborCostPerHourUsd",
  "hoursPerYear",
  "workingDaysPerYear",
  "operatingHoursPerDay",
  "installPctOfCapex",
  "laborReplacementPct",
  "turnoverPerDay",
  "roiHorizonYears",
];

/** Validate the assumptions bag: every known key present and a finite number. */
export function validateAssumptions(raw: unknown): AssumptionValues | null {
  if (!isPlainObject(raw)) return null;
  const out = {} as AssumptionValues;
  for (const k of ASSUMPTION_KEYS) {
    const v = raw[k];
    if (!isFiniteNumber(v)) return null;
    out[k] = v;
  }
  return out;
}
