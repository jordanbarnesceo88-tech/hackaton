import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import type { ChangeLogEntry } from "@/components/project/change-log";
import type { NormPanelRow } from "@/components/project/norms-panel";
import { Workspace } from "@/components/project/workspace";
import { requireUser } from "@/lib/auth/guards";
import { getNormRows, getProcessesFor, type NormRow } from "@/lib/catalog/queries";
import { prisma } from "@/lib/db/client";
import { getProject, getProjectChanges, type ProjectChangeEntry, type ProjectRecord } from "@/lib/projects/queries";
import { liveDataVersionFrom, loadLiveInputs, reproduceModel, type LiveInputs } from "@/lib/projects/recalc";
import { formatCalcDate } from "@/lib/report/tz/rows";
import { buildProjectModel, withSnapshotProducts, type ProjectModel } from "@/lib/tz/model";
import { NORM_DEFS, type NormDef } from "@/lib/tz/norms";
import { FACILITY_LABELS } from "@/lib/tz/params/template";
import { processesForFacility } from "@/lib/tz/processes";
import { timed } from "@/lib/tz/timing";
import type { ParamValues, ProductForCalc } from "@/lib/tz/types";

export const metadata: Metadata = { title: "Проект — Платформа оценки роботизации" };

/**
 * Рабочая область сохранённого проекта (ТЗ §3.1.3, §3.1.5). Первый показ воспроизводит расчёт
 * из снимка проекта: сохранённые параметры и сценарии, снимки продуктов поверх живого каталога,
 * нормативы и сводки имитации из снимка — числа совпадают с отчётом и выгрузками бит-в-бит.
 * Версия данных на живых данных считается здесь же: если каталог, нормативы или модель
 * изменились, рабочая область покажет баннер «Пересчитать на актуальных данных».
 *
 * Проект чужого пользователя неотличим от несуществующего (getProject фильтрует по владельцу,
 * §4.4.2) — 404.
 */

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

/** Первая модель проекта и время её сборки (часы читаются здесь, а не в теле компонента). */
function initialModelOf(
  live: LiveInputs,
  project: ProjectRecord,
): { model: ProjectModel; ms: number; products: ProductForCalc[]; params: ParamValues } {
  const stored = project.results;
  if (stored) {
    const { value, ms } = timed(() => reproduceModel(live, stored), () => performance.now());
    return {
      model: value,
      ms,
      products: withSnapshotProducts(live.products, stored.productSnapshots),
      params: stored.paramsUsed,
    };
  }
  // Результатов нет (записаны старой версией или не сохранились) — модель на живых данных.
  const { value, ms } = timed(
    () =>
      buildProjectModel({
        facility: project.facility,
        params: project.params,
        paramDefs: live.paramDefs,
        scenarios: project.scenarios,
        products: live.products,
        norms: live.norms,
      }),
    () => performance.now(),
  );
  return { model: value, ms, products: live.products, params: project.params };
}

/** Запись журнала из БД → строка таблицы «Журнал корректировок». */
function toChangeLogEntry(e: ProjectChangeEntry): ChangeLogEntry {
  return {
    at: e.at.toISOString(),
    user: e.userEmail,
    scenario: e.scenarioName ?? e.scenarioKey,
    fieldLabel: e.fieldLabel,
    auto: e.auto,
    old: e.old,
    new: e.new,
    unit: e.unit,
    reason: e.reason,
  };
}

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  await connection();
  const user = await requireUser();
  const { projectId } = await params;
  const project = await getProject(prisma, projectId, user.userId);
  if (!project) notFound();

  const [live, normRows, dbProcesses, changes] = await Promise.all([
    loadLiveInputs(prisma, project.facility),
    getNormRows(prisma),
    getProcessesFor(prisma, project.facility),
    getProjectChanges(prisma, project.id, user.userId),
  ]);
  const facilityLabel = FACILITY_LABELS[project.facility] ?? project.facility;
  const defs = live.paramDefs.filter((d) => d.facility === project.facility);
  const baseValues: ParamValues = Object.fromEntries(defs.map((d) => [d.key, d.base]));
  const processes = dbProcesses.length > 0 ? dbProcesses : processesForFacility(project.facility);
  const first = initialModelOf(live, project);
  const saved = project.results;
  const stored = saved
    ? {
        results: {
          modelVersion: saved.modelVersion,
          dataVersion: saved.dataVersion,
          calculatedAt: saved.calculatedAt,
          sim: saved.sim,
        },
        liveDataVersion: liveDataVersionFrom(live, saved),
      }
    : undefined;
  // Ключ — только id проекта: после «Сохранить проект» сервер обновляет страницу, и версия
  // данных может смениться (в снимок попал новый продукт). Пересоздание рабочей области сбросило
  // бы её состояние вместе с сообщением «Проект сохранён». Расчёт на экране и так совпадает с
  // сохранённым (та же функция на том же снимке), а после пересчёта на актуальных данных
  // (кнопка баннера) страница перезагружается целиком.
  const workspaceKey = project.id;

  return (
    <div className="surface-data flex flex-col gap-6 py-8">
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">
          <Link href="/projects" className="tap-target underline underline-offset-2 hover:text-foreground">
            Мои проекты
          </Link>{" "}
          / {facilityLabel}
          {project.isDemo ? " · демо-проект" : ""}
        </p>
        <h1>{project.name}</h1>
        <p className="text-sm text-muted-foreground">
          {project.objectName ? `${project.objectName} · ` : ""}
          {project.results
            ? `расчёт сохранён ${formatCalcDate(project.results.calculatedAt)}`
            : "сохранённого расчёта нет — показан расчёт на текущих данных"}
        </p>
      </div>
      <Workspace
        key={workspaceKey}
        mode="owner"
        project={{
          id: project.id,
          name: project.name,
          facility: project.facility,
          facilityLabel,
          objectName: project.objectName,
          paramsSource: project.paramsSource,
          isDemo: project.isDemo,
        }}
        defs={defs}
        baseValues={baseValues}
        initialParams={first.params}
        initialScenarios={first.model.scenarios}
        products={first.products}
        normRows={normPanelRows(normRows, first.model.normsUsed)}
        processes={processes}
        initialModel={first.model}
        initialMs={first.ms}
        stored={stored}
        changes={(changes ?? []).map(toChangeLogEntry)}
      />
    </div>
  );
}
