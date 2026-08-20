"use server";

import { auth } from "@/auth";
import { createSavedAnalysis, type SavedAnalysisInput } from "@/lib/db/queries";

export type SaveResult =
  | { ok: true; id: string }
  | { ok: false; reason: "unauthenticated" | "error" };

export async function saveAnalysisAction(input: SavedAnalysisInput): Promise<SaveResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, reason: "unauthenticated" };
  try {
    const saved = await createSavedAnalysis(session.user.id, input);
    return { ok: true, id: saved.id };
  } catch {
    return { ok: false, reason: "error" };
  }
}
