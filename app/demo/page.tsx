import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import type { NormPanelRow } from "@/components/project/norms-panel";
import { Workspace } from "@/components/project/workspace";
import { getNormRows, getProcessesFor, type NormRow } from "@/lib/catalog/queries";
import { prisma } from "@/lib/db/client";
import { initialProject, loadLiveInputs, type InitialProject, type LiveInputs } from "@/lib/projects/recalc";
import { NORM_DEFS, type NormDef } from "@/lib/tz/norms";
import { FACILITY_LABELS } from "@/lib/tz/params/template";
import { isFacilitySlug, processesForFacility, type FacilitySlug } from "@/lib/tz/processes";
import type { ParamValues } from "@/lib/tz/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Демо-расчёт — Платформа оценки роботизации" };

/**
 * Гостевой демо-расчёт на данных организатора (ТЗ §3.1.2: гость видит каталог и демонстрационный
 * расчёт без сохранения; §5.5: три базовых типа объекта на уровне выбора, параметров и доступных
 * решений). Параметры — базовые значения датасета организатора, сценарии — те же сценарии по
 * умолчанию, что у «Нового проекта» (initialScenarios), поэтому числа демо совпадают с проектом,
 * созданным на демо-данных (§5.6). Первая модель собирается на сервере, дальше «Пересчитать»
 * считает её в браузере той же функцией; имитация запускается в браузере.
 *
 * Тип объекта — в адресе: /demo (склад), /demo?facility=airport, /demo?facility=medical.
 */

const FACILITIES: readonly FacilitySlug[] = ["warehouse", "airport", "medical"];

/** Метаданные нормативов для таблицы «Нормативы и допущения»: строка БД, иначе описание из кода. */
function normPanelRows(dbRows: readonly NormRow[], values: Readonly<Record<string, number>>): NormPanelRow[] {
  const byKey = new Map(dbRows.map((r) => [r.key, r]));
  const defs: readonly NormDef[] = NORM_DEFS;
  return defs.map((d) => {
    const r = byKey.get(d.key);
    return {
      key: d.key,
      value: values[d.key] ?? r?.value ?? d.value,
      label: r?.label ?? d.label,
      unit: r?.unit ?? d.unit,
      origin: r?.origin ?? d.origin,
      basis: r?.basis ?? d.basis,
      sourceUrl: r?.sourceUrl ?? d.sourceUrl ?? null,
      sourceRef: r?.sourceRef ?? d.sourceRef ?? null,
      min: r ? r.min : d.min,
      max: r ? r.max : d.max,
      group: r?.group ?? d.group,
    };
  });
}

/**
 * Демо-проект на базовых значениях организатора: параметры, сценарии по умолчанию и модель со
 * временем сборки. Часы (performance.now) читаются внутри initialProject — в обычной функции, а
 * не в теле компонента.
 */
function demoProject(live: LiveInputs, facility: string): InitialProject {
  return initialProject(live, facility, () => performance.now());
}

export default async function DemoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const sp = await searchParams;
  const facility: FacilitySlug = typeof sp.facility === "string" && isFacilitySlug(sp.facility) ? sp.facility : "warehouse";
  const facilityLabel = FACILITY_LABELS[facility] ?? facility;

  const [live, normRows, dbProcesses] = await Promise.all([
    loadLiveInputs(prisma, facility),
    getNormRows(prisma),
    getProcessesFor(prisma, facility),
  ]);
  const defs = live.paramDefs.filter((d) => d.facility === facility);
  const baseValues: ParamValues = Object.fromEntries(defs.map((d) => [d.key, d.base]));
  const processes = dbProcesses.length > 0 ? dbProcesses : processesForFacility(facility);
  const demo = demoProject(live, facility);

  return (
    <div className="surface-data flex flex-col gap-6 py-8">
      <div className="flex flex-col gap-3">
        <h1>Демо-расчёт на данных организатора: {facilityLabel}</h1>
        <p className="max-w-4xl text-sm text-muted-foreground">
          Гостевой режим: параметры — базовые значения датасета организатора, сценарии — те же, что получит новый
          проект на демо-данных. Всё можно менять и пересчитывать в браузере; ничего не сохраняется.{" "}
          <Link href="/login" className="tap-target text-primary underline underline-offset-2">
            Войдите
          </Link>
          , чтобы сохранить проект, получить отчёт (PDF) и Excel.
        </p>
        <nav aria-label="Тип объекта демо-расчёта" className="flex flex-wrap gap-2 text-sm">
          {FACILITIES.map((f) => {
            const current = f === facility;
            return (
              <Link
                key={f}
                href={f === "warehouse" ? "/demo" : `/demo?facility=${f}`}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "tap-target rounded-full border px-3 py-1 transition-colors",
                  current ? "border-primary bg-primary/10 font-medium text-primary" : "hover:bg-muted",
                )}
              >
                {FACILITY_LABELS[f] ?? f}
                {f !== "warehouse" && <span className="text-xs text-muted-foreground"> · прототип</span>}
              </Link>
            );
          })}
        </nav>
      </div>
      <Workspace
        key={facility}
        mode="guest"
        project={{
          name: `Демо-расчёт — ${facilityLabel}`,
          facility,
          facilityLabel,
          objectName: null,
          paramsSource: { kind: "demo" },
        }}
        defs={defs}
        baseValues={baseValues}
        initialParams={demo.params}
        initialScenarios={demo.model.scenarios}
        products={live.products}
        normRows={normPanelRows(normRows, demo.model.normsUsed)}
        processes={processes}
        initialModel={demo.model}
        initialMs={demo.ms}
      />
    </div>
  );
}
