import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getSavedAnalyses } from "@/lib/db/queries";

export default async function AnalysesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const analyses = await getSavedAnalyses(session.user.id);
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 py-12">
      <h1 className="text-2xl font-semibold">Мои расчёты</h1>
      {analyses.length === 0 ? (
        <p className="text-sm text-muted-foreground">Пока нет сохранённых расчётов.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {analyses.map((a) => (
            <li key={a.id} className="flex items-center justify-between rounded-md border px-4 py-3 text-sm">
              <span>
                <b>{a.name}</b> · {a.facilityTypeSlug} ·{" "}
                {new Date(a.createdAt).toLocaleDateString("ru-RU")}
              </span>
              <span className="flex gap-3">
                <Link href={`/calculate/${a.solutionId}?analysis=${a.id}`} className="underline">
                  Открыть
                </Link>
                <Link href={`/report/${a.id}`} className="underline">
                  Отчёт
                </Link>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
