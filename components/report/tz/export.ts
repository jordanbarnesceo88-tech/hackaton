import { projectCsv } from "@/lib/report/tz/csv";
import { buildProjectXlsx } from "@/lib/report/tz/xlsx";
import { attachmentDisposition, type ReportData } from "./data";

/**
 * Выгрузки проекта в Excel и CSV (ТЗ §2.2 шаг 8, §3.7.3). Общая логика обработчиков
 * `/projects/[projectId]/export.xlsx` и `/export.csv`: проверка входа и владельца, сборка файла
 * из сохранённого расчёта и ответ для скачивания. Только сервер: книга XLSX собирается exceljs.
 *
 * Выгружается только сохранённый расчёт: файл обязан совпадать с отчётом и воспроизводиться
 * при повторном открытии (§3.1.5), поэтому несохранённые правки рабочей области в него не
 * попадают, а проект без расчёта получает 409 с подсказкой.
 */

export type ExportFormat = "xlsx" | "csv";

/** Тип содержимого ответа по формату. */
export const EXPORT_CONTENT_TYPES: Readonly<Record<ExportFormat, string>> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv; charset=utf-8",
};

/** Зависимости обработчика: пользователь из сессии и загрузчик проекта (подменяются в тестах). */
export type ExportDeps = {
  /** id вошедшего пользователя; null — гость. */
  userId: string | null;
  load: (projectId: string, userId: string) => Promise<ReportData | null>;
};

/** Текстовый ответ об ошибке: по-русски, без кеширования. */
function textResponse(status: number, text: string): Response {
  return new Response(text, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store" },
  });
}

/** Тело файла выгрузки. CSV уже содержит BOM (projectCsv), TextEncoder пишет его как EF BB BF. */
async function fileBytes(format: ExportFormat, data: ReportData): Promise<Uint8Array> {
  const { project } = data;
  const results = project.results;
  if (!results) throw new Error("нет сохранённого расчёта");
  if (format === "csv") return new TextEncoder().encode(projectCsv(results, { projectName: project.name }));
  return buildProjectXlsx({ projectName: project.name, results, defs: data.defs, changes: data.changes });
}

/**
 * Ответ обработчика выгрузки:
 * - гость — 401 «Требуется вход»;
 * - проекта нет или он чужой — 404 «Проект не найден»;
 * - у проекта нет сохранённого расчёта — 409 «Сначала сохраните проект»;
 * - иначе — файл с `Content-Disposition: attachment` (русское имя через `filename*`) и
 *   `Cache-Control: private, no-store`: в файле данные пользователя, общий кеш их хранить не должен.
 */
export async function projectExportResponse(format: ExportFormat, projectId: string, deps: ExportDeps): Promise<Response> {
  if (!deps.userId) return textResponse(401, "Требуется вход");
  const data = await deps.load(projectId, deps.userId);
  if (!data) return textResponse(404, "Проект не найден");
  if (!data.project.results) return textResponse(409, "Сначала сохраните проект");
  let bytes: Uint8Array;
  try {
    bytes = await fileBytes(format, data);
  } catch (e) {
    console.error(`projectExportResponse(${format})`, e);
    return textResponse(500, "Не удалось сформировать файл — обновите страницу и попробуйте ещё раз");
  }
  // Копия в новый Uint8Array: Response(Buffer) не проходит проверку типов (TS2345 в этой сборке).
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": EXPORT_CONTENT_TYPES[format],
      "Content-Disposition": attachmentDisposition(data.project.name, format),
      "Cache-Control": "private, no-store",
    },
  });
}
