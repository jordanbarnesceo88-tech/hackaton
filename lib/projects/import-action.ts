"use server";

import { headers } from "next/headers";
import { clientIp, rateLimit } from "@/lib/auth/rate-limit";
import { getParamDefinitions } from "@/lib/catalog/queries";
import { prisma } from "@/lib/db/client";
import { parseParamsFile, type ParamReportItem, type ParamsLayout } from "@/lib/tz/params/import";
import { withUnit } from "@/lib/tz/params/messages";
import type { ParamIssueCode, ParamSpec, ParamValues } from "@/lib/tz/types";

/**
 * Загрузка параметров объекта из файла Excel/CSV (ТЗ §2.2 шаг 2, §3.2.3–§3.2.5).
 *
 * Действие только проверяет файл и возвращает значения с отчётом по каждому параметру.
 * НИЧЕГО не сохраняется (ТЗ §4.4.6): файл читается в память, разбирается и отбрасывается, в БД
 * и на диск он не попадает. Поэтому удалять после проекта нечего, а действие доступно и гостю
 * (демо-расчёт без входа, §3.1.2). Значения попадают в проект, только когда пользователь нажмёт
 * «Применить значения» и сохранит проект обычным путём.
 *
 * Файл с `"use server"`: экспортируются только async-функции (типы стираются при сборке).
 */

/** Статус строки отчёта для таблицы: «ок», «по умолчанию», «предупреждение», «ошибка». */
export type ImportRowStatus = "ok" | "defaulted" | "warning" | "error";

/** Строка отчёта о загрузке, готовая к показу. */
export type ImportReportRow = {
  /** Ключ параметра; у строки листа организатора, не сопоставленной ни с чем, — её название. */
  key: string;
  label: string;
  status: ImportRowStatus;
  code: ParamIssueCode | "ok" | "defaulted";
  /** Значение после проверки с единицей («20 000 м²»); «—» — значение из файла не принято. */
  value: string;
  /** Что произошло и что сделать (текст проверки из lib/tz/params/messages.ts). */
  message: string;
  /** Номер строки файла (с 1), если параметр найден в файле. */
  row?: number;
};

/**
 * Состояние формы загрузки (useActionState).
 * - `idle` — файл ещё не проверялся;
 * - `error` — файл целиком не прочитан или не принят (формат, размер, нет заголовка, лимит
 *   загрузок): `message` говорит, что сделать, отчёта нет;
 * - `ok` — файл прочитан: `values` — полный набор значений (из файла, где их нет — по
 *   умолчанию), `report` — строка на каждый параметр. Ошибки в отдельных значениях считаются
 *   в `summary.errors`; при них применять значения нельзя.
 */
export type ImportState = {
  status: "idle" | "ok" | "error";
  /**
   * Тип объекта, для которого проверен файл. Форма сравнивает его с текущим типом: значения
   * склада нельзя применить к аэропорту, если тип сменили после проверки.
   */
  facility?: string;
  values?: ParamValues;
  report?: ImportReportRow[];
  message?: string;
  fileName?: string;
  /** Вид таблицы: наш шаблон или лист датасета организатора. */
  layout?: ParamsLayout;
  /** Лист книги, из которого взяты значения; у CSV — null. */
  sheetName?: string | null;
  summary?: { found: number; errors: number; warnings: number };
};

/** Типы объектов, для которых есть описания параметров и шаблон. */
const FACILITIES: ReadonlySet<string> = new Set(["warehouse", "airport", "medical"]);

/**
 * Предел размера файла. Тело запроса Server Action по умолчанию ограничено 1 МБ, из них
 * 10–20 КБ уходят на служебные байты multipart. Шаблон и лист организатора весят десятки
 * килобайт. Форма (components/project/import-form.tsx) проверяет тот же предел до отправки —
 * держите числа равными.
 */
const MAX_FILE_BYTES = 950_000;

/** Лимит загрузок с одного адреса: 30 за 15 минут. */
const UPLOAD_LIMIT = 30;
const UPLOAD_WINDOW_MS = 15 * 60 * 1000;

/** Имя файла для показа в отчёте: без пути и не длиннее 200 символов. */
function displayName(name: string): string {
  const base = name.split(/[\\/]/).pop()?.trim() ?? "";
  return base.length > 200 ? `${base.slice(0, 197)}…` : base;
}

function rowStatus(item: ParamReportItem): ImportRowStatus {
  if (item.severity === "error") return "error";
  if (item.severity === "warning") return "warning";
  return item.code === "ok" ? "ok" : "defaulted";
}

/**
 * Строки отчёта для таблицы. Значение показывается после проверки и с единицей параметра;
 * у строки с ошибкой — «—»: значение из файла не принято (в `values` на его месте осталось
 * значение по умолчанию, но выдавать его за загруженное нельзя).
 */
function toRows(report: readonly ParamReportItem[], values: ParamValues, defs: readonly ParamSpec[]): ImportReportRow[] {
  const byKey = new Map(defs.map((d) => [d.key, d]));
  return report.map((item) => {
    const status = rowStatus(item);
    const def = byKey.get(item.key);
    const value = status !== "error" && def ? withUnit(values[def.key] ?? null, def.unit) : "—";
    const row: ImportReportRow = {
      key: item.key,
      label: item.label,
      status,
      code: item.code,
      value,
      message: item.message,
    };
    if (item.row !== undefined) row.row = item.row;
    return row;
  });
}

/**
 * Проверяет файл параметров объекта. Вызывается формой через useActionState с привязанным
 * типом объекта: `parseParamsFileAction.bind(null, facility)`. Поле формы — `file`.
 */
export async function parseParamsFileAction(
  facility: string,
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  // Действие доступно напрямую POST-запросом: аргументы проверяются здесь, а не только в форме.
  if (typeof facility !== "string" || !FACILITIES.has(facility)) {
    return { status: "error", message: "Неизвестный тип объекта. Выберите склад, аэропорт или медучреждение" };
  }

  const fail = (message: string, fileName?: string): ImportState =>
    fileName === undefined ? { status: "error", facility, message } : { status: "error", facility, fileName, message };

  const limit = await rateLimit(`upload:ip:${clientIp(await headers())}`, {
    limit: UPLOAD_LIMIT,
    windowMs: UPLOAD_WINDOW_MS,
  });
  if (!limit.ok) {
    const minutes = Math.max(1, Math.ceil(limit.retryAfterSec / 60));
    return fail(`Слишком много проверок файлов подряд. Повторите через ${minutes} мин.`);
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return fail("Выберите файл .xlsx или .csv по шаблону");
  const fileName = displayName(file.name);
  if (file.size > MAX_FILE_BYTES) return fail("Файл больше 950 КБ — удалите лишние листы и повторите", fileName);

  try {
    const defs = await getParamDefinitions(prisma, facility);
    // Байты живут только в этом вызове: после ответа файл нигде не хранится (ТЗ §4.4.6).
    const bytes = new Uint8Array(await file.arrayBuffer());
    const parsed = await parseParamsFile(bytes, file.name, defs);
    if (!parsed.ok) return fail(parsed.message, fileName);
    return {
      status: "ok",
      facility,
      fileName,
      values: parsed.values,
      report: toRows(parsed.report, parsed.values, defs),
      layout: parsed.layout,
      sheetName: parsed.sheetName,
      summary: { found: parsed.found, errors: parsed.errors, warnings: parsed.warnings },
    };
  } catch (e) {
    console.error("parseParamsFileAction", e);
    return fail("Не удалось проверить файл: сервер временно недоступен. Повторите через минуту", fileName);
  }
}
