import { connection } from "next/server";
import { ChangeTable } from "@/components/admin/change-table";
import { formatAdminTime } from "@/components/admin/format";
import { RefreshCatalog } from "@/components/admin/refresh-catalog";
import { TABLE_WRAP_CLASS, TD_CLASS, TH_CLASS } from "@/components/admin/styles";
import { requireAdmin } from "@/lib/auth/guards";
import { STALE_SOURCE_DAYS, organizerReleaseVersion } from "@/lib/catalog/sync";
import { prisma } from "@/lib/db/client";
import { loadChangeEntries } from "../_lib/changes";

export const metadata = { title: "Данные и журнал — администрирование — Платформа оценки роботизации" };

/** Сколько записей журнала показывать (ТЗ §3.3.5: действия администратора видны). */
const JOURNAL_SIZE = 100;

/** Состав выпуска из DataRelease.organizerVersion: версии выгрузок и число записей. */
function manifestText(v: unknown): string {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return "—";
  const m = v as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof m.products === "number") parts.push(`продуктов ${m.products}`);
  if (typeof m.params === "number") parts.push(`параметров ${m.params}`);
  if (typeof m.norms === "number") parts.push(`нормативов ${m.norms}`);
  if (typeof m.processes === "number") parts.push(`процессов ${m.processes}`);
  if (typeof m.solutionTypes === "number") parts.push(`типов решений ${m.solutionTypes}`);
  return parts.length > 0 ? parts.join(", ") : "—";
}

/**
 * Данные организатора и журнал (ТЗ §3.3.6 — обновление каталога по запросу; §3.1.5 — версия
 * данных; §3.3.5 — действия администратора фиксируются): выпуски данных, кнопка «Обновить
 * каталог» с отчётом синхронизации и последние записи журнала вне проектов.
 */
export default async function AdminDataPage() {
  await connection();
  await requireAdmin();
  const [releases, journal] = await Promise.all([
    prisma.dataRelease.findMany({ orderBy: [{ seededAt: "desc" }, { version: "desc" }] }),
    loadChangeEntries({ projectId: null }, JOURNAL_SIZE),
  ]);
  const codeVersion = organizerReleaseVersion();
  const current = releases.some((r) => r.version === codeVersion);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1>Данные и журнал</h1>
        <p className="max-w-3xl text-muted-foreground">
          Каталог и справочники загружаются из данных организатора (датасеты, каталог, «Примеры решений») и открытых
          источников с датой проверки каждого значения. Обновление по запросу; плановое автообновление — в плане
          развития.
        </p>
      </div>

      <section className="flex flex-col gap-3 rounded-lg border p-4" aria-labelledby="data-refresh">
        <h2 id="data-refresh" className="text-lg">
          Обновить каталог
        </h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Сверяет базу с данными организатора: новые продукты создаются, изменённые обновляются, пропавшие уходят в
          архив (не удаляются — на них могут ссылаться проекты). Правки администратора сохраняются. В отчёте — сколько
          характеристик проверено больше {STALE_SOURCE_DAYS} дней назад.
        </p>
        <p className="text-sm">
          Версия данных в приложении: <code>{codeVersion}</code>{" "}
          {current ? (
            <span className="text-positive">— загружена в базу</span>
          ) : (
            <span className="text-caution">— ещё не загружена: нажмите «Обновить каталог»</span>
          )}
        </p>
        <RefreshCatalog />
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="data-releases">
        <h2 id="data-releases" className="text-lg">
          Выпуски данных
        </h2>
        {releases.length === 0 ? (
          <p className="text-sm text-muted-foreground">Выпусков ещё нет.</p>
        ) : (
          <div className={TABLE_WRAP_CLASS}>
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">Выпуски данных организатора</caption>
              <thead className="bg-muted/40">
                <tr>
                  <th scope="col" className={TH_CLASS}>
                    Версия
                  </th>
                  <th scope="col" className={TH_CLASS}>
                    Загружен
                  </th>
                  <th scope="col" className={TH_CLASS}>
                    Состав
                  </th>
                  <th scope="col" className={TH_CLASS}>
                    Источники
                  </th>
                </tr>
              </thead>
              <tbody>
                {releases.map((r) => (
                  <tr key={r.version}>
                    <td className={TD_CLASS}>
                      <code>{r.version}</code>
                      {r.version === codeVersion && (
                        <span className="block text-xs text-positive">текущая версия приложения</span>
                      )}
                    </td>
                    <td className={`${TD_CLASS} whitespace-nowrap tabular-nums`}>{formatAdminTime(r.seededAt)}</td>
                    <td className={TD_CLASS}>{manifestText(r.organizerVersion)}</td>
                    <td className={`${TD_CLASS} max-w-md break-words text-xs text-muted-foreground`}>{r.note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="data-journal">
        <h2 id="data-journal" className="text-lg">
          Журнал администратора
        </h2>
        <p className="text-sm text-muted-foreground">
          Последние {JOURNAL_SIZE} записей вне проектов: правки каталога, характеристик, нормативов и параметров,
          обновления каталога. Корректировки внутри проектов видны в самих проектах.
        </p>
        <ChangeTable entries={journal} caption="Журнал действий администратора" />
      </section>
    </div>
  );
}
