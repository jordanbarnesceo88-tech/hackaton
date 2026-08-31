import type { EconomicsResult } from "@/lib/economics/types";

/**
 * True when a stored saved-analysis `results` blob differs from a fresh recompute — a changed
 * discriminant (economical / reason) or any numeric output field drifting beyond a tiny
 * tolerance. Used to flag stale saved analyses on revisit and in the report.
 */
export function resultsDiverged(stored: unknown, recomputed: EconomicsResult): boolean {
  if (!stored || typeof stored !== "object") return true;
  const s = stored as Record<string, unknown>;
  const now = recomputed as Record<string, unknown>;
  if (s.economical !== now.economical) return true;
  if (now.reason !== undefined && s.reason !== now.reason) return true;
  for (const [k, v] of Object.entries(now)) {
    if (typeof v !== "number") continue;
    const then = s[k];
    if (typeof then !== "number") return true;
    if (Math.abs(v - then) / Math.max(1, Math.abs(v)) > 1e-6) return true;
  }
  return false;
}
