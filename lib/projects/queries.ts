import type { Prisma, PrismaClient, ScenarioKind as DbScenarioKind } from "@prisma/client";
import { getParamDefinitions, type Db } from "../catalog/queries";
import { paramSpecsFor } from "../data/organizer/params";
import { processesForFacility } from "../tz/processes";
import type { ParamValues, PendingChange, ProjectResults, ScenarioKind, ScenarioSpec } from "../tz/types";
import { changeFieldLabel, serverAutoFrom, toChangeLogRows } from "./changes";
import { resultsFromInputs, type LiveInputs } from "./recalc";

/**
 * Чтение и запись проектов (ТЗ §3.1.3 — проекты пользователя, §4.4.2 — изоляция данных).
 * Каждый запрос чтения фильтрует по владельцу (`where: { id, userId }`): чужой проект
 * неотличим от несуществующего. Запись (`insertProject`, `storeProjectCalculation`) сама
 * пересчитывает модель и имитацию: результаты от клиента не принимаются. Клиент БД
 * передаётся параметром, импорты относительные — модуль используют страницы, серверные
 * действия, API, сев демо-проекта и скрипты. Проверку ввода и владельца делает вызывающий
 * код (lib/projects/actions.ts, API).
 */

/** Откуда взяты параметры проекта: демо-данные организатора, ручной ввод, файл, API. */
export type ParamsSource = {
  kind: "demo" | "manual" | "upload" | "api";
  /** Имя загруженного файла (сам файл не хранится, ТЗ §4.4.6). */
  fileName?: string;
};

/** Вид сценария в БД ↔ в модели. */
export const DB_SCENARIO_KIND: Readonly<Record<ScenarioKind, DbScenarioKind>> = {
  asis: "ASIS",
  purchase: "PURCHASE",
  raas: "RAAS",
};

/** Вид сценария модели по значению перечисления БД. */
export function scenarioKindOf(kind: DbScenarioKind): ScenarioKind {
  return kind === "PURCHASE" ? "purchase" : kind === "RAAS" ? "raas" : "asis";
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Сохранённые результаты проекта или null, если их нет или они не похожи на ProjectResults
 * (например, записаны старой версией). Форма проверяется поверхностно — по полям, без
 * которых страница не построится.
 */
export function asProjectResults(json: Prisma.JsonValue | null | undefined): ProjectResults | null {
  if (!isPlainObject(json)) return null;
  const ok =
    typeof json.modelVersion === "string" &&
    typeof json.dataVersion === "string" &&
    typeof json.facility === "string" &&
    Array.isArray(json.results) &&
    Array.isArray(json.scenarios) &&
    isPlainObject(json.productSnapshots) &&
    isPlainObject(json.normsUsed) &&
    isPlainObject(json.paramsUsed);
  return ok ? (json as unknown as ProjectResults) : null;
}

/** Параметры проекта из JSON: только числа, строки и null. */
function asParams(json: Prisma.JsonValue): ParamValues {
  const out: ParamValues = {};
  if (!isPlainObject(json)) return out;
  for (const [k, v] of Object.entries(json)) {
    if (v === null || typeof v === "string" || (typeof v === "number" && Number.isFinite(v))) out[k] = v;
  }
  return out;
}

function asParamsSource(json: Prisma.JsonValue): ParamsSource {
  if (isPlainObject(json)) {
    const kind = json.kind;
    if (kind === "demo" || kind === "manual" || kind === "upload" || kind === "api") {
      return typeof json.fileName === "string" ? { kind, fileName: json.fileName } : { kind };
    }
  }
  return { kind: "manual" };
}

/** Строка Scenario → сценарий модели. Ключ, название и вид — из колонок, позиции — из spec. */
export function scenarioFromRow(row: {
  key: string;
  name: string;
  kind: DbScenarioKind;
  spec: Prisma.JsonValue;
}): ScenarioSpec {
  const spec = isPlainObject(row.spec) ? row.spec : {};
  const out: ScenarioSpec = {
    key: row.key,
    name: row.name,
    kind: scenarioKindOf(row.kind),
    items: Array.isArray(spec.items) ? (spec.items as unknown as ScenarioSpec["items"]) : [],
  };
  if (isPlainObject(spec.normOverrides)) out.normOverrides = spec.normOverrides as ScenarioSpec["normOverrides"];
  return out;
}

/** Лучшая (наименьшая) простая окупаемость среди рассчитанных сценариев роботизации, лет. */
export function bestPaybackYears(results: ProjectResults | null): number | null {
  if (!results) return null;
  let best: number | null = null;
  for (const r of results.results) {
    if (r.status !== "ok" || r.kind === "asis" || r.paybackYears === null) continue;
    if (best === null || r.paybackYears < best) best = r.paybackYears;
  }
  return best;
}

/** Строка списка «Мои проекты». */
export type ProjectListItem = {
  id: string;
  name: string;
  objectName: string | null;
  facility: string;
  scenarioCount: number;
  updatedAt: Date;
  calculatedAt: Date | null;
  bestPaybackYears: number | null;
  isDemo: boolean;
};

/**
 * Лучшая простая окупаемость по проектам пользователя — тем же правилом, что
 * `bestPaybackYears`, но на стороне Postgres: из jsonb читаются только вид, статус и
 * окупаемость сценариев, а не весь снимок расчёта (≈150 КБ на проект) ради одного числа.
 */
async function bestPaybackByProject(db: Db, userId: string): Promise<Map<string, number | null>> {
  const rows = await db.$queryRaw<{ id: string; best: number | null }[]>`
    SELECT p."id" AS id,
      (SELECT MIN((r->>'paybackYears')::double precision)
         FROM jsonb_array_elements(
           CASE WHEN jsonb_typeof(p."results"->'results') = 'array' THEN p."results"->'results' ELSE '[]'::jsonb END
         ) AS r
        WHERE r->>'status' = 'ok' AND r->>'kind' <> 'asis' AND jsonb_typeof(r->'paybackYears') = 'number') AS best
    FROM "Project" p
    WHERE p."userId" = ${userId}`;
  return new Map(rows.map((r) => [r.id, r.best === null ? null : Number(r.best)]));
}

/** Проекты пользователя, последние изменённые — первыми. */
export async function listProjects(db: Db, userId: string): Promise<ProjectListItem[]> {
  const [rows, paybacks] = await Promise.all([
    db.project.findMany({
      where: { userId },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      select: {
        id: true,
        name: true,
        objectName: true,
        facilityTypeSlug: true,
        updatedAt: true,
        calculatedAt: true,
        isDemo: true,
        _count: { select: { scenarios: true } },
      },
    }),
    bestPaybackByProject(db, userId),
  ]);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    objectName: r.objectName,
    facility: r.facilityTypeSlug,
    scenarioCount: r._count.scenarios,
    updatedAt: r.updatedAt,
    calculatedAt: r.calculatedAt,
    bestPaybackYears: paybacks.get(r.id) ?? null,
    isDemo: r.isDemo,
  }));
}

/** Строка сценария в БД (для журнала и действий со сценариями). */
export type ScenarioRow = { id: string; key: string; name: string; kind: ScenarioKind; order: number };

/** Проект целиком: параметры, сценарии и сохранённые результаты. */
export type ProjectRecord = {
  id: string;
  userId: string;
  name: string;
  objectName: string | null;
  facility: string;
  params: ParamValues;
  paramsSource: ParamsSource;
  results: ProjectResults | null;
  modelVersion: string | null;
  dataVersion: string | null;
  calculatedAt: Date | null;
  copiedFromId: string | null;
  isDemo: boolean;
  createdAt: Date;
  updatedAt: Date;
  scenarios: ScenarioSpec[];
  scenarioRows: ScenarioRow[];
};

/** Проект пользователя по id; null — нет такого или он чужой. */
export async function getProject(db: Db, id: string, userId: string): Promise<ProjectRecord | null> {
  if (typeof id !== "string" || id === "" || typeof userId !== "string" || userId === "") return null;
  const p = await db.project.findFirst({
    where: { id, userId },
    include: { scenarios: { orderBy: [{ order: "asc" }, { key: "asc" }] } },
  });
  if (!p) return null;
  return {
    id: p.id,
    userId: p.userId,
    name: p.name,
    objectName: p.objectName,
    facility: p.facilityTypeSlug,
    params: asParams(p.params),
    paramsSource: asParamsSource(p.paramsSource),
    results: asProjectResults(p.results),
    modelVersion: p.modelVersion,
    dataVersion: p.dataVersion,
    calculatedAt: p.calculatedAt,
    copiedFromId: p.copiedFromId,
    isDemo: p.isDemo,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    scenarios: p.scenarios.map(scenarioFromRow),
    scenarioRows: p.scenarios.map((s) => ({ id: s.id, key: s.key, name: s.name, kind: scenarioKindOf(s.kind), order: s.order })),
  };
}

/** Запись журнала корректировок для таблицы «Журнал корректировок». */
export type ProjectChangeEntry = {
  id: string;
  at: Date;
  userEmail: string | null;
  scenarioKey: string | null;
  scenarioName: string | null;
  field: string;
  fieldLabel: string;
  auto: Prisma.JsonValue;
  old: Prisma.JsonValue;
  new: Prisma.JsonValue;
  unit: string | null;
  reason: string | null;
};

/**
 * Журнал корректировок проекта в порядке записи; null — проекта нет или он чужой. Подписи
 * полей — по описаниям параметров объекта и названиям процессов.
 */
export async function getProjectChanges(db: Db, projectId: string, userId: string): Promise<ProjectChangeEntry[] | null> {
  if (typeof projectId !== "string" || projectId === "" || typeof userId !== "string" || userId === "") return null;
  const project = await db.project.findFirst({ where: { id: projectId, userId }, select: { id: true, facilityTypeSlug: true } });
  if (!project) return null;
  const [rows, dbDefs] = await Promise.all([
    db.changeLog.findMany({
      where: { projectId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: {
        user: { select: { email: true } },
        scenario: { select: { key: true, name: true } },
      },
    }),
    getParamDefinitions(db, project.facilityTypeSlug),
  ]);
  const defs = dbDefs.length > 0 ? dbDefs : paramSpecsFor(project.facilityTypeSlug);
  const paramLabels = Object.fromEntries(defs.map((d) => [d.key, d.label]));
  const processNames = Object.fromEntries(processesForFacility(project.facilityTypeSlug).map((p) => [p.slug, p.name]));
  return rows.map((r) => ({
    id: r.id,
    at: r.createdAt,
    userEmail: r.user?.email ?? null,
    // Удалённый сценарий: ссылки нет, ключ записан в entityId.
    scenarioKey: r.scenario?.key ?? (r.entity === "scenario" && r.scenarioId === null ? r.entityId : null),
    scenarioName: r.scenario?.name ?? null,
    field: r.field,
    fieldLabel: changeFieldLabel(r.field, paramLabels, processNames),
    auto: r.autoValue,
    old: r.oldValue,
    new: r.newValue,
    unit: r.unit,
    reason: r.reason,
  }));
}

// ——————————————————————————— Запись ———————————————————————————

/** Значение для колонки Json: результаты модели и сценарии — обычные JSON-объекты. */
function json(v: unknown): Prisma.InputJsonValue {
  return v as Prisma.InputJsonValue;
}

/** spec сценария в БД: позиции и переопределения нормативов (ключ, название и вид — колонки). */
export function scenarioSpecJson(s: ScenarioSpec): Prisma.InputJsonValue {
  return json(JSON.parse(JSON.stringify({ items: s.items, normOverrides: s.normOverrides })));
}

/** Колонки проекта с результатом расчёта. */
function resultColumns(results: ProjectResults) {
  return {
    results: json(results),
    modelVersion: results.modelVersion,
    dataVersion: results.dataVersion,
    calculatedAt: new Date(results.calculatedAt),
  };
}

/** Новый проект. */
export type NewProject = {
  userId: string;
  name: string;
  objectName: string | null;
  facility: string;
  /** Параметры объекта (уже проверенные вызывающим кодом). */
  params: ParamValues;
  paramsSource: ParamsSource;
  /** Сценарии; не заданы — сценарии по умолчанию из подбора. */
  scenarios?: readonly ScenarioSpec[];
  /** Фиксированный id (демо-проект сева); по умолчанию — cuid. */
  id?: string;
  isDemo?: boolean;
};

/**
 * Создаёт проект с расчётом на живых данных: модель, имитация, результаты с версиями, строки
 * сценариев. Возвращает id и результаты. Проверку ввода делает вызывающий код.
 */
export async function insertProject(
  db: Db,
  live: LiveInputs,
  input: NewProject,
): Promise<{ id: string; results: ProjectResults }> {
  const { results } = resultsFromInputs(live, {
    facility: input.facility,
    params: input.params,
    scenarios: input.scenarios,
  });
  const created = await db.project.create({
    data: {
      ...(input.id !== undefined ? { id: input.id } : {}),
      userId: input.userId,
      name: input.name,
      objectName: input.objectName,
      facilityTypeSlug: input.facility,
      params: json(results.paramsUsed),
      paramsSource: json(input.paramsSource),
      isDemo: input.isDemo ?? false,
      ...resultColumns(results),
      scenarios: {
        create: results.scenarios.map((s, order) => ({
          key: s.key,
          name: s.name,
          kind: DB_SCENARIO_KIND[s.kind],
          order,
          spec: scenarioSpecJson(s),
        })),
      },
    },
    select: { id: true },
  });
  return { id: created.id, results };
}

/** Пересчёт и запись существующего проекта. */
export type ProjectCalculation = {
  projectId: string;
  /** Автор изменений журнала. */
  userId: string;
  facility: string;
  /** Новое название; не задано — прежнее. */
  name?: string;
  params: ParamValues;
  scenarios: readonly ScenarioSpec[];
  changes: readonly PendingChange[];
  live: LiveInputs;
  /**
   * Сохранённый расчёт, на снимке которого считать (сохранение из рабочей области); null —
   * живые данные каталога и нормативов (пересчёт «на актуальных данных»).
   */
  snapshot: ProjectResults | null;
};

/**
 * Пересчитывает проект и записывает в одной транзакции параметры, результаты с версиями,
 * сценарии и журнал. Сценарии заменяются целиком: отсутствующие ключи удаляются, остальные
 * обновляются или добавляются. Автоматические значения журнала — из расчёта сервера.
 */
export async function storeProjectCalculation(
  db: PrismaClient,
  input: ProjectCalculation,
): Promise<{ calculatedAt: string; dataVersion: string; results: ProjectResults }> {
  const { projectId, userId } = input;
  const { results, model } = resultsFromInputs(input.live, {
    facility: input.facility,
    params: input.params,
    scenarios: input.scenarios,
    snapshot: input.snapshot
      ? { productSnapshots: input.snapshot.productSnapshots, normsUsed: input.snapshot.normsUsed }
      : null,
  });
  const serverAuto = serverAutoFrom(model, input.live.paramDefs);
  await db.$transaction(async (tx) => {
    await tx.project.update({
      where: { id: projectId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        params: json(results.paramsUsed),
        ...resultColumns(results),
      },
    });
    const existing = await tx.scenario.findMany({ where: { projectId }, select: { id: true, key: true, name: true } });
    const byKey = new Map(results.scenarios.map((s) => [s.key, s]));
    const gone = existing.filter((s) => !byKey.has(s.key)).map((s) => s.id);
    if (gone.length > 0) await tx.scenario.deleteMany({ where: { id: { in: gone } } });
    // Названия уникальны в проекте: если сценарии обменялись названиями, прямое обновление
    // столкнулось бы с ещё не обновлённой строкой, поэтому сначала временные имена.
    for (const row of existing) {
      const next = byKey.get(row.key);
      if (next && next.name !== row.name) {
        await tx.scenario.update({ where: { id: row.id }, data: { name: `~переименование~${row.id}` } });
      }
    }
    const idByKey = new Map<string, string>();
    for (const [order, s] of results.scenarios.entries()) {
      const row = await tx.scenario.upsert({
        where: { projectId_key: { projectId, key: s.key } },
        create: { projectId, key: s.key, name: s.name, kind: DB_SCENARIO_KIND[s.kind], order, spec: scenarioSpecJson(s) },
        update: { name: s.name, kind: DB_SCENARIO_KIND[s.kind], order, spec: scenarioSpecJson(s) },
        select: { id: true },
      });
      idByKey.set(s.key, row.id);
    }
    if (input.changes.length > 0) {
      await tx.changeLog.createMany({
        data: toChangeLogRows(input.changes, { projectId, userId, scenarioIdByKey: idByKey, serverAuto }),
      });
    }
  });
  return { calculatedAt: results.calculatedAt, dataVersion: results.dataVersion, results };
}
