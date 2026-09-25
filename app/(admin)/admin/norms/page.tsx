import { connection } from "next/server";
import { NormRow } from "@/components/admin/norm-row";
import type { NormRowValues } from "@/components/admin/norm-row";
import { requireAdmin } from "@/lib/auth/guards";
import { getNormRows } from "@/lib/catalog/queries";
import { prisma } from "@/lib/db/client";
import { isNormKey, normDef } from "@/lib/tz/norms";

export const metadata = { title: "Нормативы — администрирование — Платформа оценки роботизации" };

/**
 * Нормативы расчёта (ТЗ §3.1.4 — администратор управляет значениями по умолчанию; §3.5.1 — без
 * недокументированных коэффициентов; §3.5.8 — источники и допущения видны). Таблица Norm по
 * группам: значение с допустимым диапазоном, происхождение, источник и обоснование, правка и
 * сброс к умолчанию.
 */
export default async function AdminNormsPage() {
  await connection();
  await requireAdmin();
  const rows = await getNormRows(prisma);

  const groups: { name: string; rows: NormRowValues[] }[] = [];
  for (const r of rows) {
    const def = isNormKey(r.key) ? normDef(r.key) : null;
    const values: NormRowValues = {
      key: r.key,
      label: r.label,
      unit: r.unit,
      value: r.value,
      defaultValue: def ? def.value : null,
      // Границы — из кода: по ним прижимает значение и действие, и расчёт (resolveNorms).
      min: def ? def.min : r.min,
      max: def ? def.max : r.max,
      origin: r.origin,
      basis: r.basis,
      sourceUrl: r.sourceUrl,
      sourceRef: r.sourceRef,
      editedByAdmin: r.editedByAdmin,
      updatedAt: r.updatedAt.toISOString(),
    };
    const name = def ? r.group : "Не используются расчётом";
    const last = groups.find((g) => g.name === name);
    if (last) last.rows.push(values);
    else groups.push({ name, rows: [values] });
  }
  const edited = rows.filter((r) => r.editedByAdmin).length;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1>Нормативы расчёта</h1>
        <p className="max-w-3xl text-muted-foreground">
          Все коэффициенты, которые участвуют в расчёте, но не являются параметрами объекта. У каждого — происхождение
          (организатор, ТЗ, открытый источник, оценка или наш выбор) и обоснование. Правка администратора действует на
          новые расчёты; сохранённые проекты воспроизводятся по своему снимку и предложат пересчитать на актуальных
          данных.
        </p>
        <ul className="max-w-3xl list-disc pl-5 text-sm text-muted-foreground">
          <li>Значение вне допустимого диапазона прижимается к ближайшей границе — сообщение назовёт сохранённое число.</li>
          <li>
            Взаимные ограничения восстанавливает расчёт: веса балла подбора нормируются к сумме 1, граница «долгой»
            окупаемости не ниже «быстрой», порог возврата с зарядки выше порога ухода на неё.
          </li>
          <li>Изменено администратором сейчас: {edited}.</li>
        </ul>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-caution">
          В базе нет нормативов — загрузите данные кнопкой «Обновить каталог» в разделе «Данные и журнал».
        </p>
      ) : (
        groups.map((g, i) => (
          <section key={g.name} className="flex flex-col gap-2" aria-labelledby={`norm-grp-${i}`}>
            <h2 id={`norm-grp-${i}`} className="text-lg">
              {g.name}
            </h2>
            <ul className="rounded-lg border px-4">
              {g.rows.map((n) => (
                <NormRow key={n.key} norm={n} />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
