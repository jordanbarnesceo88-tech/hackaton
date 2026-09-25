import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { ProjectsList, type ProjectsListItem } from "@/components/project/projects-list";
import { buttonVariants } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/db/client";
import { listProjects, type ProjectListItem } from "@/lib/projects/queries";
import { FACILITY_LABELS } from "@/lib/tz/params/template";

export const metadata: Metadata = { title: "Мои проекты — Платформа оценки роботизации" };

/** Строка списка для клиентского компонента: даты — ISO, подпись типа объекта — по-русски. */
function toListItem(p: ProjectListItem): ProjectsListItem {
  return {
    id: p.id,
    name: p.name,
    objectName: p.objectName,
    facility: p.facility,
    facilityLabel: FACILITY_LABELS[p.facility] ?? p.facility,
    scenarioCount: p.scenarioCount,
    updatedAt: p.updatedAt.toISOString(),
    bestPaybackYears: p.bestPaybackYears,
    isDemo: p.isDemo,
  };
}

/**
 * «Мои проекты» (ТЗ §3.1.3): проекты пользователя — открыть, скопировать, удалить — и кнопка
 * «Новый проект», с которой начинается путь жюри §5.4. Чужие проекты сюда не попадают:
 * listProjects фильтрует по владельцу (§4.4.2).
 */
export default async function ProjectsPage() {
  await connection();
  const user = await requireUser();
  const items = (await listProjects(prisma, user.userId)).map(toListItem);

  return (
    <div className="surface-data flex flex-col gap-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1>Мои проекты</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Проект хранит параметры объекта, сценарии и расчёт с версиями модели и данных: повторное открытие
            воспроизводит те же числа. Для каждого проекта — подбор решений, сравнение сценариев, экономика, имитация и
            отчёт.
          </p>
        </div>
        <Link href="/projects/new" className={buttonVariants({ size: "lg" })}>
          Новый проект
        </Link>
      </div>

      <ProjectsList items={items} />

      <footer className="flex flex-wrap gap-x-6 gap-y-2 border-t pt-4 text-sm text-muted-foreground">
        <Link href="/demo" className="tap-target underline underline-offset-2 hover:text-foreground">
          Демо-расчёт на данных организатора без сохранения
        </Link>
        <Link href="/analyses" className="tap-target underline underline-offset-2 hover:text-foreground">
          Расчёты в упрощённой модели v1
        </Link>
      </footer>
    </div>
  );
}
