"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/client";
import { applyDefaults } from "@/lib/tz/params/schema";
import { hasErrors, validateParamValues } from "@/lib/tz/params/validate";
import { isFacilitySlug, processesForFacility } from "@/lib/tz/processes";
import type { ParamIssue, ParamValues, PendingChange, ScenarioSpec } from "@/lib/tz/types";
import {
  asProjectResults,
  getProject,
  insertProject,
  scenarioFromRow,
  scenarioSpecJson,
  storeProjectCalculation,
  type ParamsSource,
} from "./queries";
import { loadLiveInputs, type LiveInputs } from "./recalc";
import { sanitizeProjectName, validatePendingChanges, validateScenarioSpecs } from "./validate";

/*
 * Серверные действия проектов (ТЗ §3.1.3: создание, редактирование, копирование, сохранение,
 * удаление; §3.1.5: повторный расчёт с версиями; §3.5.4: журнал корректировок; §4.4.2:
 * изоляция проектов). Файл с «use server» экспортирует только асинхронные функции (типы
 * стираются при сборке).
 *
 * Каждое действие: auth() → проверка ввода (отклонить, а не подчистить) → владелец по
 * where { id, userId } → запись в try/catch → результат { ok | reason }. redirect вызывается
 * вне try: он бросает исключение, которое catch проглотил бы. Результаты расчёта от браузера
 * не принимаются никогда: сервер пересчитывает модель и имитацию сам (lib/projects/queries —
 * insertProject и storeProjectCalculation).
 *
 * copyProjectAction и deleteProjectAction при успехе перенаправляют, а при ошибке возвращают
 * причину. Для <form action> их удобно вызывать из клиентской функции-обёртки, которая
 * покажет сообщение.
 *
 * Засеянный демо-проект (isDemo) принадлежит общему демо-аккаунту, которым входят все члены
 * жюри: сохранение, пересчёт и удаление для него запрещены (reason 'invalid' с подсказкой),
 * иначе правки одного человека меняли бы запасной проект и эталонные числа §5.6 для всех
 * следующих. Копирование разрешено — копия уже не демо (isDemo: false).
 */

/** Состояние формы «Новый проект» (useActionState). */
export type CreateProjectState = { error: string | null; issues?: ParamIssue[] };

/** Причина отказа действия с проектом. */
export type ProjectActionReason = "unauthenticated" | "not_found" | "invalid" | "error";

/** Отказ действия: причина и сообщение по-русски — что не так и как исправить. */
export type ProjectActionFailure = { ok: false; reason: ProjectActionReason; message: string };

/** Результат сохранения или пересчёта проекта. */
export type SaveProjectResult = { ok: true; calculatedAt: string; dataVersion: string } | ProjectActionFailure;

/** Что присылает рабочая область при сохранении. */
export type SaveProjectInput = {
  name?: string;
  params: ParamValues;
  scenarios: ScenarioSpec[];
  changes: PendingChange[];
};

const SOURCES = new Set<ParamsSource["kind"]>(["demo", "manual", "upload"]);
/** Наибольший размер параметров из файла в поле формы, символов JSON. */
const PARAMS_JSON_MAX = 200_000;
/** Наибольшая длина названия объекта. */
const OBJECT_NAME_MAX = 200;
/** Наибольшая длина названия проекта (как в sanitizeProjectName). */
const PROJECT_NAME_MAX = 120;

const MESSAGES = {
  unauthenticated: "Войдите, чтобы работать с проектами",
  notFound: "Проект не найден — возможно, он удалён",
  error: "Не удалось сохранить проект, попробуйте ещё раз",
  stale: "Сессия устарела — войдите заново",
  demo: "Демо-проект общий для всех, кто входит демо-аккаунтом, — его нельзя изменить, пересчитать или удалить. Скопируйте проект и работайте с копией",
} as const;

function fail(reason: ProjectActionReason, message: string): ProjectActionFailure {
  return { ok: false, reason, message };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}

/** Код ошибки Prisma (P2002, P2003 …) или null. */
function prismaCode(e: unknown): string | null {
  return typeof e === "object" && e !== null && "code" in e && typeof (e as { code: unknown }).code === "string"
    ? (e as { code: string }).code
    : null;
}

/** Сообщение об ошибке записи: пользователя из токена нет в БД (P2003) — войти заново. */
function writeErrorMessage(e: unknown, fallback: string = MESSAGES.error): string {
  return prismaCode(e) === "P2003" ? MESSAGES.stale : fallback;
}

/** Подписи параметров с ошибками — для сообщения «исправьте: …». */
function issueLabels(issues: readonly ParamIssue[]): string {
  const labels: string[] = [];
  for (const i of issues) {
    const label = `«${i.label}»`;
    if (i.severity === "error" && !labels.includes(label)) labels.push(label);
  }
  return labels.join(", ");
}

/** Id проекта из аргумента действия: строка разумной длины. */
function projectIdOf(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 && v.length <= 64 ? v : null;
}

/** Обновить список проектов и страницу проекта после записи. */
function revalidateProjects(): void {
  revalidatePath("/projects");
  revalidatePath("/projects/[projectId]", "page");
}

/**
 * Параметры из формы создания: демо-данные и ручной ввод начинаются с базовых значений
 * организатора, файл (paramsJson) проверяется заново — как при загрузке.
 */
function paramsFromForm(
  source: ParamsSource["kind"],
  formData: FormData,
  live: LiveInputs,
): { ok: true; params: ParamValues; paramsSource: ParamsSource } | { ok: false; state: CreateProjectState } {
  if (source !== "upload") return { ok: true, params: applyDefaults(live.paramDefs, {}), paramsSource: { kind: source } };
  const raw = formData.get("paramsJson");
  const unreadable = { ok: false as const, state: { error: "Не удалось прочитать параметры из файла — загрузите файл заново" } };
  if (typeof raw !== "string" || raw.trim() === "") {
    return { ok: false, state: { error: "Загрузите файл параметров и примените его, затем создайте проект" } };
  }
  if (raw.length > PARAMS_JSON_MAX) {
    return { ok: false, state: { error: "Слишком много данных в файле параметров — заполните шаблон платформы" } };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return unreadable;
  }
  if (!isPlainObject(parsed)) return unreadable;
  const checked = validateParamValues(live.paramDefs, parsed, { origin: "upload" });
  if (hasErrors(checked.issues)) {
    return {
      ok: false,
      state: { error: `Файл параметров не прошёл проверку — исправьте: ${issueLabels(checked.issues)}`, issues: checked.issues },
    };
  }
  const fileName = formData.get("fileName");
  const paramsSource: ParamsSource =
    typeof fileName === "string" && fileName.trim() !== ""
      ? { kind: "upload", fileName: fileName.trim().slice(0, 200) }
      : { kind: "upload" };
  return { ok: true, params: applyDefaults(live.paramDefs, checked.values), paramsSource };
}

/**
 * Создание проекта (форма «Новый проект», useActionState). Поля формы: name, facility
 * (warehouse | airport | medical), source (demo | manual | upload), paramsJson — значения из
 * загруженного файла (для source = upload), необязательные objectName и fileName. Сценарии —
 * по умолчанию из подбора, результаты считаются на сервере. При успехе — переход в рабочую
 * область проекта.
 */
export async function createProjectAction(_prev: CreateProjectState, formData: FormData): Promise<CreateProjectState> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { error: MESSAGES.unauthenticated };

  const name = sanitizeProjectName(formData.get("name"));
  if (!name) return { error: "Укажите название проекта — от 1 до 120 символов, например «РЦ Подольск»" };
  const facility = formData.get("facility");
  if (typeof facility !== "string" || !isFacilitySlug(facility)) {
    return { error: "Выберите тип объекта: склад, аэропорт или медучреждение" };
  }
  const source = formData.get("source");
  if (typeof source !== "string" || !SOURCES.has(source as ParamsSource["kind"])) {
    return { error: "Выберите источник параметров: демо-данные, файл или ручной ввод" };
  }
  const rawObject = formData.get("objectName");
  const objectName = typeof rawObject === "string" && rawObject.trim() !== "" ? rawObject.trim() : null;
  if (objectName !== null && objectName.length > OBJECT_NAME_MAX) {
    return { error: `Название объекта — не длиннее ${OBJECT_NAME_MAX} символов` };
  }

  let id: string;
  try {
    const live = await loadLiveInputs(prisma, facility);
    const p = paramsFromForm(source as ParamsSource["kind"], formData, live);
    if (!p.ok) return p.state;
    ({ id } = await insertProject(prisma, live, {
      userId,
      name,
      objectName,
      facility,
      params: p.params,
      paramsSource: p.paramsSource,
    }));
  } catch (e) {
    console.error("createProjectAction: не удалось создать проект", e);
    return { error: writeErrorMessage(e, "Не удалось создать проект, попробуйте ещё раз") };
  }
  revalidatePath("/projects");
  redirect(`/projects/${id}`);
}

/**
 * Сохранение проекта из рабочей области: название (необязательно), параметры, сценарии и
 * изменения для журнала. Результаты браузера не принимаются — сервер пересчитывает модель и
 * имитацию на снимке сохранённого расчёта (продукты сценариев и нормативы те же, что видел
 * пользователь), а автоматические значения журнала берёт из своего расчёта.
 */
export async function saveProjectAction(projectId: string, input: SaveProjectInput): Promise<SaveProjectResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return fail("unauthenticated", MESSAGES.unauthenticated);
  const id = projectIdOf(projectId);
  if (!id) return fail("not_found", MESSAGES.notFound);
  if (!isPlainObject(input)) return fail("invalid", "Нет данных для сохранения");

  let name: string | undefined;
  if (input.name !== undefined) {
    const n = sanitizeProjectName(input.name);
    if (!n) return fail("invalid", `Название проекта — от 1 до ${PROJECT_NAME_MAX} символов`);
    name = n;
  }
  if (!isPlainObject(input.params)) return fail("invalid", "Параметры объекта не переданы");

  let result: SaveProjectResult;
  try {
    const project = await prisma.project.findFirst({
      where: { id, userId },
      select: { id: true, facilityTypeSlug: true, results: true, isDemo: true },
    });
    if (!project) return fail("not_found", MESSAGES.notFound);
    if (project.isDemo) return fail("invalid", MESSAGES.demo);
    const facility = project.facilityTypeSlug;
    const live = await loadLiveInputs(prisma, facility);

    const checked = validateParamValues(live.paramDefs, input.params, { origin: "manual" });
    if (hasErrors(checked.issues)) {
      return fail("invalid", `В параметрах объекта есть ошибки — исправьте: ${issueLabels(checked.issues)}`);
    }
    const stored = asProjectResults(project.results);
    // Продукт сценария может уже уйти из каталога, но остаться в снимке проекта.
    const productSlugs = new Set(live.products.map((p) => p.slug));
    for (const slug of Object.keys(stored?.productSnapshots ?? {})) productSlugs.add(slug);
    const specs = validateScenarioSpecs(
      input.scenarios,
      facility,
      productSlugs,
      processesForFacility(facility).map((p) => p.slug),
    );
    if (!specs.ok) return fail("invalid", `Сценарии не сохранены: ${specs.errors.join("; ")}`);
    const changes = validatePendingChanges(input.changes);
    if (!changes.ok) return fail("invalid", `Журнал изменений не принят: ${changes.errors.join("; ")}`);

    const saved = await storeProjectCalculation(prisma, {
      projectId: id,
      userId,
      facility,
      name,
      params: applyDefaults(live.paramDefs, checked.values),
      scenarios: specs.value,
      changes: changes.value,
      live,
      snapshot: stored,
    });
    result = { ok: true, calculatedAt: saved.calculatedAt, dataVersion: saved.dataVersion };
  } catch (e) {
    console.error("saveProjectAction: не удалось сохранить проект", e);
    return fail("error", writeErrorMessage(e));
  }
  revalidateProjects();
  return result;
}

/**
 * Пересчёт сохранённого проекта на актуальных данных каталога и нормативов (кнопка баннера
 * «Пересчитать на актуальных данных», §3.1.5): те же параметры и сценарии, живые продукты и
 * нормативы, новые версия данных и момент расчёта.
 */
export async function recalcProjectAction(projectId: string): Promise<SaveProjectResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return fail("unauthenticated", MESSAGES.unauthenticated);
  const id = projectIdOf(projectId);
  if (!id) return fail("not_found", MESSAGES.notFound);

  let result: SaveProjectResult;
  try {
    const project = await getProject(prisma, id, userId);
    if (!project) return fail("not_found", MESSAGES.notFound);
    if (project.isDemo) return fail("invalid", MESSAGES.demo);
    const live = await loadLiveInputs(prisma, project.facility);
    const checked = validateParamValues(live.paramDefs, project.params, { origin: "manual" });
    if (hasErrors(checked.issues)) {
      return fail("invalid", `Сохранённые параметры не проходят текущую проверку — исправьте: ${issueLabels(checked.issues)}`);
    }
    const saved = await storeProjectCalculation(prisma, {
      projectId: id,
      userId,
      facility: project.facility,
      params: applyDefaults(live.paramDefs, checked.values),
      scenarios: project.scenarios,
      changes: [],
      live,
      snapshot: null,
    });
    result = { ok: true, calculatedAt: saved.calculatedAt, dataVersion: saved.dataVersion };
  } catch (e) {
    console.error("recalcProjectAction: не удалось пересчитать проект", e);
    return fail("error", writeErrorMessage(e, "Не удалось пересчитать проект, попробуйте ещё раз"));
  }
  revalidateProjects();
  return result;
}

/**
 * Копия проекта: «{название} (копия)» с теми же параметрами, сценариями и результатами;
 * журнал не копируется, copiedFromId указывает на исходный проект. При успехе — переход в
 * копию.
 */
export async function copyProjectAction(projectId: string): Promise<ProjectActionFailure> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return fail("unauthenticated", MESSAGES.unauthenticated);
  const id = projectIdOf(projectId);
  if (!id) return fail("not_found", MESSAGES.notFound);

  let copyId: string;
  try {
    const src = await prisma.project.findFirst({ where: { id, userId }, include: { scenarios: true } });
    if (!src) return fail("not_found", MESSAGES.notFound);
    const suffix = " (копия)";
    const room = PROJECT_NAME_MAX - suffix.length;
    const base = src.name.length > room ? `${src.name.slice(0, room - 1).trimEnd()}…` : src.name;
    const copy = await prisma.project.create({
      data: {
        userId,
        name: `${base}${suffix}`,
        objectName: src.objectName,
        facilityTypeSlug: src.facilityTypeSlug,
        params: (src.params ?? {}) as Prisma.InputJsonValue,
        paramsSource: (src.paramsSource ?? {}) as Prisma.InputJsonValue,
        ...(src.results !== null ? { results: src.results as Prisma.InputJsonValue } : {}),
        modelVersion: src.modelVersion,
        dataVersion: src.dataVersion,
        calculatedAt: src.calculatedAt,
        copiedFromId: src.id,
        isDemo: false,
        scenarios: {
          create: src.scenarios.map((s) => ({
            key: s.key,
            name: s.name,
            kind: s.kind,
            order: s.order,
            spec: scenarioSpecJson(scenarioFromRow(s)),
          })),
        },
      },
      select: { id: true },
    });
    copyId = copy.id;
  } catch (e) {
    console.error("copyProjectAction: не удалось скопировать проект", e);
    return fail("error", writeErrorMessage(e, "Не удалось скопировать проект, попробуйте ещё раз"));
  }
  revalidatePath("/projects");
  redirect(`/projects/${copyId}`);
}

/**
 * Удаление проекта вместе со сценариями и журналом (каскад в БД; загруженные файлы не
 * хранятся — ТЗ §4.4.6). При успехе — переход к списку проектов.
 */
export async function deleteProjectAction(projectId: string): Promise<ProjectActionFailure> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return fail("unauthenticated", MESSAGES.unauthenticated);
  const id = projectIdOf(projectId);
  if (!id) return fail("not_found", MESSAGES.notFound);

  try {
    const project = await prisma.project.findFirst({ where: { id, userId }, select: { isDemo: true } });
    if (!project) return fail("not_found", MESSAGES.notFound);
    if (project.isDemo) return fail("invalid", MESSAGES.demo);
    // isDemo: false и в самом удалении — на случай, если проект пересоздали между запросами.
    const { count } = await prisma.project.deleteMany({ where: { id, userId, isDemo: false } });
    if (count === 0) return fail("not_found", MESSAGES.notFound);
  } catch (e) {
    console.error("deleteProjectAction: не удалось удалить проект", e);
    return fail("error", "Не удалось удалить проект, попробуйте ещё раз");
  }
  revalidatePath("/projects");
  redirect("/projects");
}
