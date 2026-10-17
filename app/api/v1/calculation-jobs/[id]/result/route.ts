import { apiUser, API_AUTH_MESSAGES } from "@/lib/api/auth";
import { apiError, apiJson } from "@/lib/api/http";
import { prisma } from "@/lib/db/client";
import { getOwnedJobResult } from "@/lib/calculation-jobs/store";
import { jobHttpError } from "@/lib/calculation-jobs/http";
import type { FrozenCalculationInput } from "@/lib/calculation-jobs/service";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await apiUser();
    if (!userId) return apiError(401, API_AUTH_MESSAGES.userRequired);
    const { id } = await params;
    const record = await getOwnedJobResult(prisma, userId, id);
    if (!record) return apiError(404, "Расчёт не найден");
    const frozen = record.run.input as unknown as FrozenCalculationInput;
    // Return only the owner's submitted fields, never the internal catalogue/worker envelope.
    const submitted = frozen.operation === "SAVE" ? {
      expectedRevision: frozen.publication?.expectedRevision,
      ...(frozen.publication?.name !== undefined ? { name: frozen.publication.name } : {}),
      params: frozen.input.params, scenarios: frozen.input.scenarios,
      changes: frozen.publication?.changes ?? [],
    } : null;
    const pending = record.job.status === "QUEUED" || record.job.status === "RUNNING";
    return apiJson({ job: record.job, results: record.run.results, submitted }, { status: pending ? 202 : 200 });
  } catch (error) { return jobHttpError(error); }
}
