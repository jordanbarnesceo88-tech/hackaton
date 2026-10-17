import type { SpatialEvidence } from "../tz/types";
import { simInputIdentity } from "./identity";
import { SPATIAL_MODEL_VERSION } from "./spatial-bridge";
import type { SimInput } from "./types";

/** A saved observation is current only for the same source input and supported engine. */
export function spatialEvidenceMatchesInput(
  evidence: SpatialEvidence | null | undefined,
  expected: SimInput | null | undefined,
): evidence is SpatialEvidence {
  if (!evidence || !expected) return false;
  try {
    return evidence.simModelVersion === SPATIAL_MODEL_VERSION && evidence.assessment.terminal === true &&
      ["OK", "PARTIAL", "FAIL", "NOT_EVALUATED"].includes(evidence.assessment.status) &&
      evidence.sourceInputKey === simInputIdentity(expected) &&
      evidence.sourceInputKey === simInputIdentity(evidence.input) &&
      evidence.summary.fleet === expected.robots.count &&
      evidence.summary.requiredPerH === expected.demand.peakPerH;
  } catch {
    return false;
  }
}
