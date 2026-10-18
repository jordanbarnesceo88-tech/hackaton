"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/db/client";
import { createSavedAnalysis, getSolutionApplicability, getSolutionForCalc, getTaskCategories } from "@/lib/db/queries";
import { sanitizeName, validateParams, validateAssumptions, isPlainObject, validAnalysisInputSize } from "@/lib/analyses/validate";
import { computeEconomics } from "@/lib/economics/calculate";
import { toSolutionCapacity } from "@/lib/economics/normalize";

export type SaveResult =
  | { ok: true; id: string }
  | { ok: false; reason: "unauthenticated" | "invalid" | "error" };

/** Save inputs only; the compact legacy economics result is always computed by the server. */
export async function saveAnalysisAction(input: unknown): Promise<SaveResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, reason: "unauthenticated" };
  if (!isPlainObject(input) || !validAnalysisInputSize(input)) return { ok: false, reason: "invalid" };

  const name = sanitizeName(input.name);
  const params = validateParams(input.params);
  const assumptions = validateAssumptions(input.assumptions);
  const solutionId = input.solutionId;
  const facilityTypeSlug = input.facilityTypeSlug;
  if (!name || !params || !assumptions || typeof solutionId !== "string" || !solutionId || solutionId.length > 200 ||
    typeof facilityTypeSlug !== "string" || !facilityTypeSlug || facilityTypeSlug.length > 200) {
    return { ok: false, reason: "invalid" };
  }

  try {
    // Applicability, solution/category inputs and the saved result share one DB snapshot.
    // This is a small scalar calculation, with no simulation or fleet search.
    return await prisma.$transaction(async tx => {
      const applicable = await getSolutionApplicability(solutionId, tx);
      if (!applicable.includes(facilityTypeSlug)) return { ok: false, reason: "invalid" } as const;
      const declaredTasks = Object.keys(params.taskStaffing ?? {});
      if (declaredTasks.length) {
        const allowed = new Set((await getTaskCategories(facilityTypeSlug, tx)).map(task => task.slug));
        if (declaredTasks.some(slug => !allowed.has(slug))) return { ok: false, reason: "invalid" } as const;
      }
      const solution = await getSolutionForCalc(solutionId, tx);
      if (!solution) return { ok: false, reason: "invalid" } as const;
      const capacity = toSolutionCapacity({ ...solution,
        workloadStream: solution.solutionCategory.workloadStream,
        categorySlug: solution.solutionCategory.slug,
        workerOutputPerYear: solution.solutionCategory.workerOutputPerYear });
      const results = computeEconomics(capacity, params, assumptions);
      if (Object.values(results).some(value => typeof value === "number" && !Number.isFinite(value))) {
        return { ok: false, reason: "invalid" } as const;
      }
      // Ignore any client-supplied results entirely, including forged financial fields.
      const saved = await createSavedAnalysis(userId, { name, facilityTypeSlug, solutionId, params, assumptions, results }, tx);
      return { ok: true, id: saved.id } as const;
    }, { isolationLevel: "RepeatableRead" });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    console.error("saveAnalysisAction: failed to persist canonical analysis", { code: typeof code === "string" ? code : undefined });
    return { ok: false, reason: "error" };
  }
}
