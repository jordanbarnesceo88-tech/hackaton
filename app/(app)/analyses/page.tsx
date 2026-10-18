import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getSavedAnalyses } from "@/lib/db/queries";

export default async function AnalysesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const analyses = await getSavedAnalyses(session.user.id);
  return (
    <div className="surface-prose flex flex-col gap-4 py-12">
      <h1>Архив расчётов v1</h1>
      <p className="text-sm text-muted-foreground">Исторические входы прежней модели доступны для просмотра без изменения и сохранения. Отчёт повторно считает их по текущим данным v1 и явно показывает расхождение с сохранённым результатом. Для новой проверки используйте <Link href="/projects/new" className="underline">текущий проект</Link>.</p>
      {analyses.length === 0 ? (
        <p className="text-sm text-muted-foreground">В архиве v1 нет сохранённых расчётов.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {analyses.map((a) => (
            <li key={a.id} className="flex items-center justify-between rounded-md border px-4 py-3 text-sm">
              <span>
                <b>{a.name}</b> · {a.facilityTypeSlug} ·{" "}
                {new Date(a.createdAt).toLocaleDateString("ru-RU")}
              </span>
              <span className="flex gap-3">
                <Link href={`/report/${a.id}`} className="underline">
                  Просмотреть архивный отчёт
                </Link>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
