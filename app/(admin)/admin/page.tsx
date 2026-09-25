import Link from "next/link";
import { connection } from "next/server";
import { ChangeTable } from "@/components/admin/change-table";
import { LEVEL_HINTS, LEVEL_LABELS, formatAdminTime } from "@/components/admin/format";
import { requireAdmin } from "@/lib/auth/guards";
import { latestDataRelease } from "@/lib/catalog/queries";
import { prisma } from "@/lib/db/client";
import { formatNum } from "@/lib/format/rub";
import { loadChangeEntries } from "./_lib/changes";

export const metadata = { title: "Администрирование — Платформа оценки роботизации" };

const CARD = "flex flex-col gap-2 rounded-lg border p-4";
const LEVELS = ["enriched", "examples", "identification"] as const;

/**
 * Обзор админки: состав каталога (по глубине описания, архив, «требует проверки», продукты
 * и правки администратора), последний выпуск данных организатора, правленые нормативы и
 * параметры, последние действия. Отсюда — в разделы.
 */
export default async function AdminPage() {
  await connection();
  await requireAdmin();

  const active = { archived: false };
  const [byLevel, archived, needsVerification, adminProducts, editedProducts, normsEdited, paramsEdited, release, recent] =
    await Promise.all([
      prisma.catalogProduct.groupBy({ by: ["level"], where: active, _count: { _all: true } }),
      prisma.catalogProduct.count({ where: { archived: true } }),
      prisma.catalogProduct.count({ where: { ...active, needsVerification: true } }),
      prisma.catalogProduct.count({ where: { origin: "ADMIN" } }),
      prisma.catalogProduct.count({ where: { origin: "ORGANIZER", editedByAdmin: true } }),
      prisma.norm.count({ where: { editedByAdmin: true } }),
      prisma.paramDefinition.count({ where: { editedByAdmin: true } }),
      latestDataRelease(prisma),
      loadChangeEntries({ projectId: null }, 10),
    ]);
  const levelCount = new Map(byLevel.map((r) => [r.level, r._count._all]));
  const activeTotal = byLevel.reduce((sum, r) => sum + r._count._all, 0);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1>Администрирование</h1>
        <p className="max-w-3xl text-muted-foreground">
          Каталог решений, характеристики с источниками, нормативы расчёта, параметры объектов и обновление данных
          организатора. Каждое изменение пишется в журнал: кто, когда, что было и что стало.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <section className={CARD} aria-labelledby="adm-catalog">
          <h2 id="adm-catalog" className="text-lg">
            Каталог
          </h2>
          <p className="text-3xl font-semibold tabular-nums">{formatNum(activeTotal)}</p>
          <p className="text-xs text-muted-foreground">продуктов в каталоге (без архива)</p>
          <ul className="text-sm">
            {LEVELS.map((level) => (
              <li key={level}>
                {LEVEL_LABELS[level]}: <b>{formatNum(levelCount.get(level) ?? 0)}</b>{" "}
                <span className="text-xs text-muted-foreground">— {LEVEL_HINTS[level]}</span>
              </li>
            ))}
            <li>
              Требуют проверки: <b>{formatNum(needsVerification)}</b>
            </li>
            <li>
              В архиве: <b>{formatNum(archived)}</b>
            </li>
            <li>
              Заведены администратором: <b>{formatNum(adminProducts)}</b>; правки в данных организатора:{" "}
              <b>{formatNum(editedProducts)}</b>
            </li>
          </ul>
          <Link href="/admin/catalog" className="mt-auto text-sm text-primary underline underline-offset-2">
            Открыть каталог
          </Link>
        </section>

        <section className={CARD} aria-labelledby="adm-norms">
          <h2 id="adm-norms" className="text-lg">
            Нормативы
          </h2>
          <p className="text-3xl font-semibold tabular-nums">{formatNum(normsEdited)}</p>
          <p className="text-xs text-muted-foreground">изменено администратором</p>
          <p className="text-sm">
            Коэффициенты расчёта с источником и обоснованием: загрузка, резерв парка, ставки CAPEX и OPEX, горизонт,
            пороги интерпретации.
          </p>
          <Link href="/admin/norms" className="mt-auto text-sm text-primary underline underline-offset-2">
            Открыть нормативы
          </Link>
        </section>

        <section className={CARD} aria-labelledby="adm-params">
          <h2 id="adm-params" className="text-lg">
            Параметры объектов
          </h2>
          <p className="text-3xl font-semibold tabular-nums">{formatNum(paramsEdited)}</p>
          <p className="text-xs text-muted-foreground">изменено администратором</p>
          <p className="text-sm">
            Значения по умолчанию, диапазоны проверки, подсказки и примеры полей для склада, аэропорта и
            медучреждения.
          </p>
          <Link href="/admin/params" className="mt-auto text-sm text-primary underline underline-offset-2">
            Открыть параметры
          </Link>
        </section>

        <section className={CARD} aria-labelledby="adm-data">
          <h2 id="adm-data" className="text-lg">
            Данные организатора
          </h2>
          {release ? (
            <>
              <p className="text-3xl font-semibold tabular-nums">
                <code>{release.version}</code>
              </p>
              <p className="text-xs text-muted-foreground">
                последний выпуск данных, загружен {formatAdminTime(release.seededAt)}
              </p>
            </>
          ) : (
            <p className="text-sm text-caution">Данные организатора ещё не загружены — нажмите «Обновить каталог».</p>
          )}
          <p className="text-sm">Обновление каталога по запросу и журнал действий администратора.</p>
          <Link href="/admin/data" className="mt-auto text-sm text-primary underline underline-offset-2">
            Открыть данные и журнал
          </Link>
        </section>
      </div>

      <section className="flex flex-col gap-3" aria-labelledby="adm-recent">
        <h2 id="adm-recent">Последние действия</h2>
        <ChangeTable entries={recent} caption="Последние действия администратора" />
      </section>
    </div>
  );
}
