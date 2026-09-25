import { connection } from "next/server";
import { FACILITY_NAMES } from "@/components/admin/format";
import { ParamRow } from "@/components/admin/param-row";
import type { ParamRowValues } from "@/components/admin/param-row";
import { LABEL_CLASS, LABEL_TEXT_CLASS, SELECT_CLASS } from "@/components/admin/styles";
import { buttonVariants } from "@/components/ui/button";
import { requireAdmin } from "@/lib/auth/guards";
import { asOrigin } from "@/lib/catalog/product-for-calc";
import { prisma } from "@/lib/db/client";
import { cn } from "@/lib/utils";

export const metadata = { title: "Параметры объектов — администрирование — Платформа оценки роботизации" };

const FACILITIES = ["warehouse", "airport", "medical"] as const;
type Facility = (typeof FACILITIES)[number];

function isFacility(v: unknown): v is Facility {
  return typeof v === "string" && (FACILITIES as readonly string[]).includes(v);
}

/**
 * Параметры объектов (ТЗ §3.2 — минимальный набор параметров; §3.2.5 — значения по умолчанию
 * и источник норматива; §3.2.6 и §3.1.4 — администратор управляет значениями по умолчанию и
 * диапазонами). Выбор типа объекта, затем описания параметров по разделам датасета
 * организатора: базовое значение, диапазон проверки ввода, обязательность, подсказка, пример.
 */
export default async function AdminParamsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  await requireAdmin();
  const sp = await searchParams;
  const facility: Facility = isFacility(sp.facility) ? sp.facility : "warehouse";

  const rows = await prisma.paramDefinition.findMany({
    where: { facilityType: { slug: facility } },
    orderBy: [{ order: "asc" }, { key: "asc" }],
  });

  const sections: { name: string; rows: ParamRowValues[] }[] = [];
  for (const r of rows) {
    const values: ParamRowValues = {
      id: r.id,
      key: r.key,
      label: r.label,
      unit: r.unit,
      kind: r.kind,
      options: [...r.options],
      base: r.baseNum ?? r.baseText ?? null,
      min: r.min,
      max: r.max,
      locked: r.locked,
      required: r.required,
      hint: r.hint,
      example: r.example,
      origin: asOrigin(r.origin),
      sourceRef: r.sourceRef,
      sourceUrl: r.sourceUrl,
      basis: r.basis,
      organizerNote: r.organizerNote,
      editedByAdmin: r.editedByAdmin,
    };
    const section = sections.find((s) => s.name === r.section);
    if (section) section.rows.push(values);
    else sections.push({ name: r.section, rows: [values] });
  }
  const edited = rows.filter((r) => r.editedByAdmin).length;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1>Параметры объектов</h1>
        <p className="max-w-3xl text-muted-foreground">
          Поля формы «Параметры» и шаблона загрузки Excel/CSV. Базовое значение — демо-данные организатора, которые
          подставляются в новый проект; минимум и максимум проверяют ввод и подсвечивают значения вне диапазона.
          Правка администратора сохраняется при «Обновить каталог».
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3" aria-label="Выбор типа объекта">
        <label className={cn(LABEL_CLASS, "w-64 max-w-full")}>
          <span className={LABEL_TEXT_CLASS}>Тип объекта</span>
          <select name="facility" defaultValue={facility} className={SELECT_CLASS}>
            {FACILITIES.map((f) => (
              <option key={f} value={f}>
                {FACILITY_NAMES[f]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={buttonVariants({ variant: "outline" })}>
          Показать
        </button>
        <p className="text-sm text-muted-foreground">
          {FACILITY_NAMES[facility]}: параметров {rows.length}, изменено администратором {edited}.
        </p>
      </form>

      {rows.length === 0 ? (
        <p className="text-sm text-caution">
          Для этого типа объекта параметров в базе нет — загрузите данные кнопкой «Обновить каталог» в разделе «Данные
          и журнал».
        </p>
      ) : (
        sections.map((s, i) => (
          <section key={s.name} className="flex flex-col gap-2" aria-labelledby={`param-sec-${i}`}>
            <h2 id={`param-sec-${i}`} className="text-lg">
              {s.name}
            </h2>
            <ul className="rounded-lg border px-4">
              {s.rows.map((p) => (
                <ParamRow
                  key={p.id}
                  param={p}
                  version={JSON.stringify([p.base, p.min, p.max, p.required, p.hint, p.example, p.editedByAdmin])}
                />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
