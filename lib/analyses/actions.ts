"use server";

import { auth } from "@/auth";
import { createSavedAnalysis, getSolutionForCalc, type SavedAnalysisInput } from "@/lib/db/queries";
import {
  sanitizeName,
  validateParams,
  validateAssumptions,
  isPlainObject,
} from "@/lib/analyses/validate";

export type SaveResult =
  | { ok: true; id: string }
  | { ok: false; reason: "unauthenticated" | "invalid" | "error" };

export async function saveAnalysisAction(input: SavedAnalysisInput): Promise<SaveResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, reason: "unauthenticated" };

  // Validate + bound the client-supplied payload before it's persisted as jsonb (audit S1).
  const name = sanitizeName(input.name);
  const params = validateParams(input.params);
  const assumptions = validateAssumptions(input.assumptions);
  if (
    !name ||
    !params ||
    !assumptions ||
    !isPlainObject(input.results) ||
    typeof input.solutionId !== "string"
  ) {
    return { ok: false, reason: "invalid" };
  }

  // Verify the solution exists and derive the facility slug from it — don't trust the
  // client-sent slug (prevents storing a mismatched or dangling reference).
  const solution = await getSolutionForCalc(input.solutionId);
  if (!solution) return { ok: false, reason: "invalid" };
  const facilityTypeSlug = solution.solutionCategory.facilityType.slug;

  try {
    const saved = await createSavedAnalysis(session.user.id, {
      name,
      facilityTypeSlug,
      solutionId: input.solutionId,
      params,
      assumptions,
      results: input.results,
    });
    return { ok: true, id: saved.id };
  } catch (e) {
    console.error("saveAnalysisAction: failed to persist analysis", e); // REFACTORING #5
    return { ok: false, reason: "error" };
  }
}
