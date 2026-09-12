"use server";

import { auth } from "@/auth";
import {
  createSavedAnalysis,
  getSolutionApplicability,
  getTaskCategories,
  type SavedAnalysisInput,
} from "@/lib/db/queries";
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

  // The facility slug used to be DERIVED from the solution precisely so the client-sent one
  // was never trusted. A category now serves many facility types, so there is nothing single
  // to derive — but the guarantee has to survive the schema change, not the mechanism. The
  // claimed slug must belong to the set the solution actually applies to; anything else is
  // rejected rather than stored.
  // Отдельная выборка решения здесь не нужна: getSolutionApplicability возвращает пустой
  // список для несуществующего id, поэтому проверка ниже отсекает и этот случай. Раньше
  // запрос делался только ради существования решения и добавлял лишний последовательный
  // поход в базу на каждое сохранение.
  const applicable = await getSolutionApplicability(input.solutionId);
  const claimed = typeof input.facilityTypeSlug === "string" ? input.facilityTypeSlug : "";
  if (!applicable.includes(claimed)) return { ok: false, reason: "invalid" };
  const facilityTypeSlug = claimed;

  // Р-4 на границе СОХРАНЕНИЯ. Ключи занятости проверяются на применимость к заявленному типу
  // объекта — тем же приёмом, что и сам `facilityTypeSlug` строкой выше.
  //
  // Экран занятости посторонние ключи уже отбрасывает, но экран — не граница: сюда приходит
  // payload, а не нажатие кнопки. Сохранённый расчёт мог нести занятость по задаче, которой на
  // этом объекте нет, и это данные, которые потом кто-то прочитает как истину — в отчёте,
  // отдаваемом клиенту.
  //
  // ОТКЛОНЯЕМ, а не подчищаем: подчистка означала бы, что сохранённое отличается от
  // присланного и никто об этом не сказал. Тем же правилом живёт validateParams.
  const declaredTasks = Object.keys(params.taskStaffing ?? {});
  if (declaredTasks.length > 0) {
    const applicableTasks = new Set(
      (await getTaskCategories(facilityTypeSlug)).map((c) => c.slug)
    );
    if (declaredTasks.some((slug) => !applicableTasks.has(slug))) {
      return { ok: false, reason: "invalid" };
    }
  }

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
