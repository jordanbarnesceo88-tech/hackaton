import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { NewProjectForm } from "@/components/project/new-project-form";
import { stepHeading } from "@/components/project/step-nav";
import { requireUser } from "@/lib/auth/guards";
import { isFacilitySlug } from "@/lib/tz/processes";

export const metadata: Metadata = { title: "Новый проект — Платформа оценки роботизации" };

/**
 * «Новый проект» (ТЗ §2.2 шаг 1 — объект; §3.1.3 — создание проекта; §5.4 — «создать проект»
 * на данных организатора). Тип объекта можно передать в адресе: /projects/new?facility=airport.
 */
export default async function NewProjectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  await requireUser();
  const sp = await searchParams;
  const facility = typeof sp.facility === "string" && isFacilitySlug(sp.facility) ? sp.facility : "warehouse";

  return (
    <div className="surface-data flex max-w-5xl flex-col gap-6 py-10">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-muted-foreground">{stepHeading(1)}</p>
        <h1>Новый проект</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Выберите тип объекта и источник параметров. Платформа подберёт решения, соберёт сценарии «Как есть»,
          «Покупка» и «Услуга (RaaS)», посчитает экономику и проверит расчётный парк имитацией. Всё можно изменить в
          рабочей области проекта.
        </p>
      </div>
      <NewProjectForm defaultFacility={facility} />
      <p className="border-t pt-4 text-sm text-muted-foreground">
        <Link href="/projects" className="tap-target underline underline-offset-2 hover:text-foreground">
          К списку проектов
        </Link>
      </p>
    </div>
  );
}
