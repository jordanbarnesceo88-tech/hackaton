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
    const then = s[k];
    // `discountedPaybackYears` is `number | null`, and null is a conclusion, not a missing
    // value: it means the investment never recovers inside the ROI horizon. A flip in either
    // direction is exactly the drift this function exists to report, so compare null-ness
    // before the numeric branch — skipping it on `typeof v !== "number"` silently treated
    // "used to pay back, now never does" as unchanged.
    if (v === null || then === null) {
      // `== null` on purpose: a stored blob written before this field existed has `undefined`
      // here, which is absent, not a different conclusion. Comparing with `!==` reported every
      // such analysis as diverged the moment it recomputed to "never pays back" — a banner
      // saying the model changed when nothing had.
      if ((v ?? null) !== (then ?? null)) return true;
      continue;
    }
    if (typeof v !== "number") continue;
    if (typeof then !== "number") return true;
    if (Math.abs(v - then) / Math.max(1, Math.abs(v)) > 1e-6) return true;
  }
  return false;
}
