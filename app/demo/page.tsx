import { notFound } from "next/navigation";
import { BusinessExamples } from "@/components/project/business-examples";
import { DemoSceneLinks } from "@/components/project/demo-scene-links";
import { businessExample } from "@/lib/projects/business-examples";
import { buildBusinessExamplePreview } from "@/lib/projects/business-example-model";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import type { NormPanelRow } from "@/components/project/norms-panel";
import { Workspace } from "@/components/project/workspace";
import { readAiConfig } from "@/lib/ai/config";
import { getCatalogProduct, getNormRows, getProcessesFor, type NormRow } from "@/lib/catalog/queries";
import { buildProductDemoPreview } from "@/lib/projects/product-demo";
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
 * созданным на демо-данных (§5.6). Первая финансовая модель служит загрузочным состоянием;
 * рабочая область запрашивает полный серверный расчёт и повторяет его по «Пересчитать».
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
  const example = businessExample(sp.example);
  if (sp.example !== undefined && (!example || facility !== "warehouse")) notFound();
  if (sp.product !== undefined && (typeof sp.product !== "string" || !sp.product || sp.product.length > 200 || sp.example !== undefined || (sp.facility !== undefined && sp.facility !== facility))) notFound();
  const facilityLabel = FACILITY_LABELS[facility] ?? facility;

  const [live, normRows, dbProcesses] = await Promise.all([
    loadLiveInputs(prisma, facility),
    getNormRows(prisma),
    getProcessesFor(prisma, facility),
  ]);
  const defs = live.paramDefs.filter((d) => d.facility === facility);
  const baseValues: ParamValues = Object.fromEntries(defs.map((d) => [d.key, d.base]));
  const processes = dbProcesses.length > 0 ? dbProcesses : processesForFacility(facility);
  const prepared = example ? buildBusinessExamplePreview(live, example.id) : null;
  const chosenProduct = typeof sp.product === "string" ? await getCatalogProduct(prisma, sp.product) : null;
  if (sp.product !== undefined && !chosenProduct) notFound();
  const productPreview = chosenProduct ? buildProductDemoPreview(live, facility, chosenProduct.slug) : null;
  if (chosenProduct && productPreview && !productPreview.ok) return <div className="surface-data grid gap-5 py-8">
    <h1>Не удалось рассчитать выбранное решение</h1><p className="font-semibold">{chosenProduct.name}</p><p role="status">{productPreview.reason}</p>
    <p>Другой робот не подставлен. Вернитесь в карточку или откройте общий демо-расчёт и настройте условия отдельно.</p>
    <div className="flex flex-wrap gap-4"><Link href={`/catalog/${encodeURIComponent(chosenProduct.slug)}`} className="tap-target text-primary underline">Карточка выбранного продукта</Link><Link href={`/demo?facility=${facility}`} className="tap-target text-primary underline">Общий демо-расчёт</Link></div>
  </div>;
  // Initial finances only bootstrap the forms. Every visit starts a real, unsaved server calculation.
  const demo = productPreview?.ok ? productPreview : prepared ? { params: prepared.params, model: prepared.model, ms: prepared.ms } : demoProject(live, facility);

  return (
    <div className="surface-data flex min-w-0 flex-col gap-3 py-4 sm:py-5">
      {sp.legacy === "1" && <p className="rounded border border-border p-3 text-sm" role="status">Ссылка из прежней модели v1 открыла текущий гостевой расчёт. Старые операции, занятость и денежные параметры не перенесены: у моделей разные входы. Проверьте тип объекта и задайте текущие условия в шаге 2.</p>}
      <div className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-1">
        <h1 className="text-2xl sm:text-3xl">{chosenProduct ? `Расчёт: ${chosenProduct.name}` : example ? example.title : `Демо-расчёт: ${facilityLabel}`}</h1>
        <details className="max-w-4xl text-sm text-muted-foreground"><summary className="tap-target cursor-pointer">{prepared ? "Учебный пример" : "Гостевой расчёт"} · без сохранения</summary><p className="mt-2">
          Сервер рассчитывает текущие условия: экономику, нагрузку и движение роботов. Статус и результат появятся в рабочей области; проект гостевого расчёта не сохраняется.{" "}
          {prepared ? "В бизнес-примере уже заданы объект, парк и денежные допущения. " : "Гостевой расчёт на базовых данных организатора. "}
          Меняйте параметры и запускайте серверную проверку. Для записи проекта и PDF/Excel{" "}
          <Link href="/login" className="tap-target text-primary underline underline-offset-2">
            войдите
          </Link>
          .
        </p></details>
        <details className="min-w-0"><summary className="tap-target cursor-pointer text-sm">Тип объекта: {facilityLabel}</summary>
        <nav aria-label="Тип объекта демо-расчёта" className="mt-2 flex flex-wrap gap-2 text-sm">
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
        </nav></details>
      </div>
      {prepared && <details className="max-w-5xl text-sm"><summary className="tap-target cursor-pointer text-primary">На каких данных получен результат</summary><p className="mt-2 leading-relaxed text-muted-foreground">{prepared.example.lesson} {prepared.assumption}</p></details>}
      {facility === "warehouse" && <BusinessExamples active={example?.id} />}
      <DemoSceneLinks />
      <Workspace
        key={`${facility}:${chosenProduct?.slug ?? example?.id ?? "baseline"}`}
        initialStep={prepared || chosenProduct ? 8 : 1}
        initialFocusKey={chosenProduct ? "p1" : prepared ? "purchase" : undefined}
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
        ai={readAiConfig() ? { enabled: true, advice: null } : undefined}
      />
    </div>
  );
}
