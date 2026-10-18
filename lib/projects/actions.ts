"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/client";
import { ProjectRevisionConflict } from "./queries";
import { validProjectRevision } from "./validate";
import type { ProjectActionFailure, ProjectActionReason } from "./action-types";

// Copy/delete need no computation. CREATE/SAVE/RECALCULATE enter the durable queue.
const PROJECT_NAME_MAX = 120;
const MESSAGES = {
  unauthenticated: "Войдите, чтобы работать с проектами",
  notFound: "Проект не найден — возможно, он удалён",
  demo: "Демо-проект общий для всех, кто входит демо-аккаунтом, — его нельзя изменить, пересчитать или удалить. Скопируйте проект и работайте с копией",
  precondition: "Для записи требуется ревизия проекта (expectedRevision). Откройте актуальную версию",
};
function fail(reason: ProjectActionReason, message: string): ProjectActionFailure { return { ok: false, reason, message }; }
function projectIdOf(value: unknown): string | null { return typeof value === "string" && value.length > 0 && value.length <= 64 ? value : null; }
function writeErrorMessage(error: unknown, fallback: string): string {
  return error && typeof error === "object" && "code" in error && error.code === "P2003" ? "Сессия устарела — войдите заново" : fallback;
}


/**
 * Копия проекта: «{название} (копия)» с теми же параметрами, сценариями и результатами;
 * журнал не копируется, copiedFromId указывает на исходный проект. При успехе — переход в
 * копию.
 */
export async function copyProjectAction(projectId: string): Promise<ProjectActionFailure> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return fail("unauthenticated", MESSAGES.unauthenticated);
  const id = projectIdOf(projectId);
  if (!id) return fail("not_found", MESSAGES.notFound);

  let copyId: string | null;
  try {
    copyId = await prisma.$transaction(async tx => {
      // Prisma may load relations in separate queries; keep the whole source at one revision.
      const src = await tx.project.findFirst({ where: { id, userId }, include: { scenarios: true } });
      if (!src) return null;
      const suffix = " (копия)";
      const room = PROJECT_NAME_MAX - suffix.length;
      const base = src.name.length > room ? `${src.name.slice(0, room - 1).trimEnd()}…` : src.name;
      const copy = await tx.project.create({
        data: {
          userId,
          name: `${base}${suffix}`,
          objectName: src.objectName,
          facilityTypeSlug: src.facilityTypeSlug,
          params: (src.params ?? {}) as Prisma.InputJsonValue,
          paramsSource: (src.paramsSource ?? {}) as Prisma.InputJsonValue,
          ...(src.results !== null ? { results: src.results as Prisma.InputJsonValue } : {}),
          modelVersion: src.modelVersion,
          dataVersion: src.dataVersion,
          calculatedAt: src.calculatedAt,
          copiedFromId: src.id,
          isDemo: false,
          scenarios: {
            create: src.scenarios.map((s) => ({
              key: s.key,
              name: s.name,
              kind: s.kind,
              order: s.order,
              spec: s.spec as Prisma.InputJsonValue,
            })),
          },
        },
        select: { id: true },
      });
      return copy.id;
      }, { isolationLevel: "RepeatableRead" });
  } catch (e) {
    console.error("copyProjectAction: не удалось скопировать проект", e);
    return fail("error", writeErrorMessage(e, "Не удалось скопировать проект, попробуйте ещё раз"));
  }
  if (!copyId) return fail("not_found", MESSAGES.notFound);
  revalidatePath("/projects");
  redirect(`/projects/${copyId}`);
}

/**
 * Удаление проекта вместе со сценариями и журналом (каскад в БД; загруженные файлы не
 * хранятся — ТЗ §4.4.6). При успехе — переход к списку проектов.
 */
export async function deleteProjectAction(projectId: string, expectedRevision?: number): Promise<ProjectActionFailure> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return fail("unauthenticated", MESSAGES.unauthenticated);
  const id = projectIdOf(projectId);
  if (!id) return fail("not_found", MESSAGES.notFound);
  if (!validProjectRevision(expectedRevision)) return fail("precondition_required", MESSAGES.precondition);

  try {
    const project = await prisma.project.findFirst({ where: { id, userId }, select: { isDemo: true } });
    if (!project) return fail("not_found", MESSAGES.notFound);
    if (project.isDemo) return fail("invalid", MESSAGES.demo);
    // isDemo: false и в самом удалении — на случай, если проект пересоздали между запросами.
    const { count } = await prisma.project.deleteMany({ where: { id, userId, isDemo: false, revision: expectedRevision } });
    if (count === 0) return fail("conflict", new ProjectRevisionConflict().message);
  } catch (e) {
    console.error("deleteProjectAction: не удалось удалить проект", e);
    return fail("error", "Не удалось удалить проект, попробуйте ещё раз");
  }
  revalidatePath("/projects");
  redirect("/projects");
}
