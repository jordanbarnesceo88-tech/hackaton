import type { Db } from "@/lib/catalog/queries";
import { getProject, getProjectChanges, type ProjectChangeEntry, type ProjectRecord } from "@/lib/projects/queries";
import { liveDataVersionFrom, loadLiveInputs } from "@/lib/projects/recalc";
import type { ReportChange } from "@/lib/report/tz/rows";
import type { ParamSpec } from "@/lib/tz/types";

/**
 * Данные отчёта по проекту (ТЗ §3.7.2, §3.7.3): проект со снимком расчёта, описания параметров
 * объекта и журнал корректировок. Один загрузчик для страницы отчёта и обеих выгрузок, поэтому
 * печатный отчёт, XLSX и CSV строятся из одних и тех же данных.
 *
 * Изоляция проектов (§4.4.2) — в запросах lib/projects/queries: чужой проект неотличим от
 * несуществующего, загрузчик тогда возвращает null. Клиент БД передаётся параметром.
 */

export type ReportData = {
  project: ProjectRecord;
  /**
   * Описания параметров объекта: администрируемая таблица ParamDefinition, а если она пуста
   * (синхронизация данных ещё не выполнялась) — описания из данных организатора в коде.
   * Это живые описания: подписи, единицы и диапазоны на момент построения отчёта; значения
   * параметров — из снимка расчёта.
   */
  defs: ParamSpec[];
  /** Журнал корректировок в порядке записи — в форме строк отчёта и XLSX. */
  changes: ReportChange[];
  /**
   * Версия данных, которую получил бы проект на живых данных (текущие карточки продуктов
   * снимка, нормативы и описания параметров) — та же проверка, что у баннера рабочей области.
   * Не совпадает с `results.dataVersion` — данные изменились после расчёта (§3.1.5), и отчёт
   * об этом предупреждает. null — у проекта нет сохранённого расчёта.
   */
  liveDataVersion: string | null;
};

/**
 * Запись журнала из БД → строка журнала отчёта. Сценарий — по названию (так его видит
 * пользователь; отчёт и XLSX добавляют ⚠ по таблице названий), у удалённого сценария — ключ.
 * Подпись поля уже собрана по описаниям параметров и названиям процессов (getProjectChanges).
 */
export function toReportChanges(entries: readonly ProjectChangeEntry[]): ReportChange[] {
  return entries.map((e) => ({
    at: e.at,
    user: e.userEmail,
    scenario: e.scenarioName ?? e.scenarioKey,
    field: e.field,
    fieldLabel: e.fieldLabel,
    auto: e.auto,
    old: e.old,
    new: e.new,
    unit: e.unit,
    reason: e.reason,
  }));
}

/**
 * Проект пользователя с описаниями параметров, журналом и версией данных на живых данных;
 * null — проекта нет или он чужой. Живые входы (loadLiveInputs) — те же, что у страницы
 * проекта: описания параметров из БД, а пока таблица пуста — из кода; продукты и нормативы
 * нужны только для сравнения версии данных.
 */
export async function loadReportData(db: Db, projectId: string, userId: string): Promise<ReportData | null> {
  const project = await getProject(db, projectId, userId);
  if (!project) return null;
  const [live, entries] = await Promise.all([
    loadLiveInputs(db, project.facility),
    getProjectChanges(db, project.id, userId),
  ]);
  const defs = live.paramDefs.filter((d) => d.facility === project.facility);
  const liveDataVersion = project.results ? liveDataVersionFrom(live, project.results) : null;
  return { project, defs, changes: toReportChanges(entries ?? []), liveDataVersion };
}

/** Запрещённые в именах файлов Windows и macOS символы и управляющие коды. */
const UNSAFE_FILENAME = /[\\/:*?"<>|\u0000-\u001f\u007f]+/g;

/** Предел длины имени файла без расширения (запас до 255 байт у файловых систем). */
const MAX_FILENAME_CHARS = 100;

/**
 * Имя файла выгрузки по названию проекта: запрещённые символы заменены «_», пробелы по краям
 * и точки в конце убраны (Windows их не допускает), длина ограничена. Пустое имя — «Проект».
 */
export function exportBaseName(projectName: string): string {
  const cleaned = projectName
    .replace(UNSAFE_FILENAME, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "");
  const cut = Array.from(cleaned).slice(0, MAX_FILENAME_CHARS).join("").trim();
  return cut === "" ? "Проект" : cut;
}

/**
 * Кодирование значения `filename*` по RFC 5987: encodeURIComponent оставляет как есть
 * «'», «(», «)» и «*», а в attr-char их нет — «Склад (демо)» иначе дал бы невалидный заголовок.
 */
function rfc5987(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * Заголовок Content-Disposition для скачивания. Значения заголовков — только ASCII (иначе
 * TypeError: Cannot convert argument to a ByteString), поэтому русское имя передаётся в
 * `filename*` по RFC 5987, а `filename` — запасное латинское имя для старых клиентов.
 */
export function attachmentDisposition(projectName: string, ext: "xlsx" | "csv"): string {
  const name = `${exportBaseName(projectName)}.${ext}`;
  return `attachment; filename="project.${ext}"; filename*=UTF-8''${rfc5987(name)}`;
}
