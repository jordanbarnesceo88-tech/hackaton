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
    // A key the recompute produces and the stored blob doesn't have means the blob predates
    // the field — which is precisely what the banner says («модель расчёта изменилась»), so
    // report it, once, for every field type. The numeric branch below has always done this
    // (`typeof then !== "number"` on an absent key returns true); the null branch used to
    // forgive it, so a legacy blob was "unchanged" when the recompute said null and "changed"
    // when it said 0.64. Nothing real hinged on the difference — `npvUsd` and
    // `discountedPaybackYears` were added by the same commit (2d3b6c1), so any blob missing
    // one is missing the other and was already flagged by the numeric branch — but one rule
    // beats two.
    if (!(k in s)) return true;
    const then = s[k];
    // `discountedPaybackYears` is `number | null`, and null is a conclusion, not a missing
    // value: it means the investment never recovers inside the ROI horizon. A flip in either
    // direction is exactly the drift this function exists to report, so compare null-ness
    // before the numeric branch — skipping it on `typeof v !== "number"` silently treated
    // "used to pay back, now never does" as unchanged.
    if (v === null || then === null) {
      if (v !== then) return true;
      continue;
    }
    if (typeof v !== "number") continue;
    if (typeof then !== "number") return true;
    if (Math.abs(v - then) / Math.max(1, Math.abs(v)) > 1e-6) return true;
  }
  return false;
}
