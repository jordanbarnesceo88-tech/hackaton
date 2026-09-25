"use client";

import { startTransition, useActionState, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { pluralRu } from "@/lib/format/plural";
import {
  parseParamsFileAction,
  type ImportReportRow,
  type ImportRowStatus,
  type ImportState,
} from "@/lib/projects/import-action";
import type { ParamValues } from "@/lib/tz/types";
import { cn } from "@/lib/utils";

/**
 * Загрузка параметров объекта из Excel/CSV по шаблону (ТЗ §2.2 шаг 2, §3.2.3–§3.2.5).
 *
 * Пользователь выбирает файл и нажимает «Проверить файл»: сервер разбирает его в памяти и
 * возвращает отчёт по каждому параметру (lib/projects/import-action.ts). Файл не сохраняется
 * (§4.4.6). «Применить значения» передаёт проверенный набор вызывающему коду через `onApply`;
 * при ошибках в файле кнопка недоступна.
 *
 * Компонент не рисует собственный `<form>`: его встраивают в форму создания проекта, а
 * вложенная форма в HTML недопустима. Поэтому файл отправляется программно, а у поля выбора
 * файла нет `name` — иначе файл уехал бы на сервер ещё раз вместе с внешней формой. Обе кнопки
 * имеют `type="button"` и внешнюю форму не отправляют.
 */

/**
 * Предел размера файла — тот же, что в действии (MAX_FILE_BYTES в import-action.ts): держите
 * числа равными. Проверка до отправки нужна, потому что тело больше 1 МБ Next отклоняет раньше,
 * чем действие успеет вернуть понятное сообщение.
 */
const MAX_FILE_BYTES = 950_000;

const INITIAL: ImportState = { status: "idle" };

const STATUS_LABEL: Readonly<Record<ImportRowStatus, string>> = {
  ok: "ок",
  defaulted: "по умолчанию",
  warning: "предупреждение",
  error: "ошибка",
};

const STATUS_CLASS: Readonly<Record<ImportRowStatus, string>> = {
  ok: "bg-positive/10 text-positive",
  defaulted: "bg-muted text-muted-foreground",
  warning: "bg-caution/10 text-caution",
  error: "bg-destructive/10 text-destructive",
};

const NETWORK_ERROR = "Не удалось связаться с сервером. Обновите страницу и проверьте файл ещё раз";

const isProblem = (r: ImportReportRow) => r.status === "error" || r.status === "warning";

export type ImportFormProps = {
  /** Тип объекта: warehouse, airport или medical. */
  facility: string;
  /** Проверенный полный набор значений и имя файла — для журнала изменений и источника данных. */
  onApply: (values: ParamValues, meta: { fileName: string }) => void;
  /** Плотная вёрстка для встраивания в другую форму: заголовок только для скринридера, ниже таблица. */
  compact?: boolean;
};

/** Итог проверки: сколько параметров найдено, ошибок и предупреждений, что за таблица. */
function Summary({ state }: { state: ImportState }) {
  const s = state.summary;
  if (!s) return null;
  const source =
    state.layout === "organizer"
      ? `Распознан лист датасета организатора${state.sheetName ? ` «${state.sheetName}»` : ""}`
      : `Распознан шаблон платформы${state.sheetName ? ` (лист «${state.sheetName}»)` : ""}`;
  return (
    <>
      <span className="block text-sm font-medium text-foreground">
        Найдено {s.found} {pluralRu(s.found, ["параметр", "параметра", "параметров"])}, ошибок {s.errors},
        предупреждений {s.warnings}
      </span>
      <span className="block">
        Файл «{state.fileName}». {source}.
      </span>
    </>
  );
}

function ReportTable({ rows, compact }: { rows: readonly ImportReportRow[]; compact: boolean }) {
  return (
    <div className={cn("overflow-auto rounded-lg border", compact ? "max-h-72" : "max-h-[28rem]")}>
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">Отчёт о проверке файла параметров</caption>
        <thead className="sticky top-0 bg-muted text-left text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-2 py-1.5 font-medium">
              Параметр
            </th>
            <th scope="col" className="px-2 py-1.5 font-medium">
              Значение
            </th>
            <th scope="col" className="px-2 py-1.5 font-medium">
              Статус
            </th>
            <th scope="col" className="px-2 py-1.5 font-medium">
              Что сделать
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={`${r.key}:${r.row ?? ""}:${i}`}
              className={cn("border-t align-top", r.status === "error" && "bg-destructive/5")}
            >
              <th scope="row" className="px-2 py-1.5 text-left font-normal">
                {r.label}
                {r.row !== undefined && <span className="block text-xs text-muted-foreground">строка {r.row}</span>}
              </th>
              <td className="px-2 py-1.5 whitespace-nowrap tabular-nums">{r.value}</td>
              <td className="px-2 py-1.5">
                <span
                  className={cn("inline-block rounded px-1.5 py-0.5 text-xs whitespace-nowrap", STATUS_CLASS[r.status])}
                >
                  {STATUS_LABEL[r.status]}
                </span>
              </td>
              <td
                className={cn(
                  "px-2 py-1.5",
                  r.status === "error" && "text-destructive",
                  r.status === "ok" && "text-muted-foreground",
                )}
              >
                {r.status === "ok" ? "—" : r.message}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Форма загрузки параметров из файла: ссылки на шаблоны, выбор файла, проверка на сервере,
 * отчёт по каждому параметру и применение значений.
 */
export function ImportForm({ facility, onApply, compact = false }: ImportFormProps) {
  const inputId = useId();
  const titleId = useId();
  const hintId = useId();
  const [state, dispatch, pending] = useActionState(
    async (_prev: ImportState, formData: FormData): Promise<ImportState> => {
      try {
        // Прошлое состояние действию не нужно, а с отчётом оно весит десятки килобайт и ушло
        // бы на сервер вместе с файлом в пределах того же 1 МБ — поэтому передаётся начальное.
        return await parseParamsFileAction(facility, INITIAL, formData);
      } catch (e) {
        // Сеть или новая версия приложения («Failed to find Server Action»): без перехвата
        // ошибка ушла бы в границу ошибок страницы и стёрла бы введённые данные.
        console.error("ImportForm", e);
        return { status: "error", facility, message: NETWORK_ERROR };
      }
    },
    INITIAL,
  );
  const [file, setFile] = useState<File | null>(null);
  const [checkedFile, setCheckedFile] = useState<File | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  // Какой результат применён: сравнение вместо сброса в эффекте (правила react-hooks v7).
  const [appliedState, setAppliedState] = useState<ImportState | null>(null);
  // null — выбор по умолчанию: при проблемах в файле сначала показываются только они.
  const [onlyProblemsPref, setOnlyProblemsPref] = useState<boolean | null>(null);

  // Результат относится к другому типу объекта (тип сменили после проверки) — применять нельзя.
  const otherFacility = state.status !== "idle" && state.facility !== undefined && state.facility !== facility;
  // Выбран новый файл, но ещё не проверен.
  const selectionChanged = file !== null && file !== checkedFile;

  const serverError = state.status === "error" && !otherFacility && !selectionChanged ? state.message : null;
  const errorText = localError ?? serverError ?? "";

  const result = state.status === "ok" && !otherFacility ? state : null;
  const rows = result?.report ?? [];
  const problems = rows.filter(isProblem).length;
  const onlyProblems = problems > 0 && (onlyProblemsPref ?? true);
  const shownRows = onlyProblems ? rows.filter(isProblem) : rows;
  const errors = result?.summary?.errors ?? 0;
  const canApply = result?.values !== undefined && errors === 0 && !selectionChanged && !pending;
  const applied = result !== null && appliedState === result;

  const note = otherFacility
    ? "Тип объекта изменён после проверки — проверьте файл заново"
    : selectionChanged && state.status !== "idle"
      ? "Выбран другой файл — нажмите «Проверить файл», чтобы проверить его"
      : null;

  function check() {
    if (!file) {
      setLocalError("Выберите файл .xlsx или .csv по шаблону");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setLocalError("Файл больше 950 КБ — удалите лишние листы и повторите");
      return;
    }
    setLocalError(null);
    setCheckedFile(file);
    const formData = new FormData();
    formData.set("file", file);
    startTransition(() => dispatch(formData));
  }

  function apply() {
    if (!result?.values || !canApply) return;
    onApply(result.values, { fileName: result.fileName ?? "" });
    setAppliedState(result);
  }

  const templateBase = `/api/templates/${encodeURIComponent(facility)}`;

  return (
    <div role="group" aria-labelledby={titleId} className="flex flex-col">
      <p id={titleId} className={compact ? "sr-only" : "text-sm font-medium"}>
        Загрузка параметров из Excel или CSV
      </p>
      <p id={hintId} className={cn("text-xs text-muted-foreground", !compact && "mt-1")}>
        Скачайте шаблон, заполните столбец «Значение» и загрузите файл (.xlsx или .csv, до 950 КБ). Файл только
        проверяется и не сохраняется. Можно загрузить и исходный лист организатора (Датасеты_хакатон.xlsx) — строки
        сопоставляются по названию параметра.
      </p>
      <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {/* Обычные ссылки на скачивание, не next/link: переход на клиенте и предзагрузка здесь не нужны. */}
        <a href={`${templateBase}?format=xlsx`} download className="tap-target text-primary underline underline-offset-4">
          Скачать шаблон Excel
        </a>
        <a href={`${templateBase}?format=csv`} download className="tap-target text-primary underline underline-offset-4">
          Скачать шаблон CSV
        </a>
      </p>

      <div className={cn("flex flex-wrap items-center gap-2", compact ? "mt-2" : "mt-3")}>
        <label htmlFor={inputId} className="sr-only">
          Файл параметров (.xlsx или .csv)
        </label>
        <input
          id={inputId}
          type="file"
          accept=".xlsx,.csv"
          aria-describedby={hintId}
          onChange={(e) => {
            setFile(e.currentTarget.files?.[0] ?? null);
            setLocalError(null);
          }}
          className="max-w-full text-sm file:mr-2 file:rounded-md file:border file:border-border file:bg-background file:px-2.5 file:py-1 file:text-sm file:font-medium hover:file:bg-muted"
        />
        <Button type="button" variant="outline" onClick={check} disabled={pending}>
          {pending ? "Проверяем файл…" : "Проверить файл"}
        </Button>
      </div>

      {/* Области объявлений стоят в разметке всегда: текст, появившийся вместе с самой областью,
          скринридер может не прочитать. Пустые области не занимают места и не дают отступа. */}
      <p role="alert" aria-live="assertive" className="text-sm text-destructive [&:not(:empty)]:mt-2">
        {errorText}
      </p>
      <div role="status" aria-live="polite" className="text-xs text-muted-foreground [&:not(:empty)]:mt-2">
        {note && <span className="block text-foreground">{note}</span>}
        {result && <Summary state={result} />}
      </div>

      {result && (
        <div className={cn("flex flex-col gap-2", compact ? "mt-2" : "mt-3")}>
          {problems > 0 && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={onlyProblems}
                onChange={(e) => setOnlyProblemsPref(e.currentTarget.checked)}
              />
              Показать только ошибки и предупреждения ({problems})
            </label>
          )}
          <ReportTable rows={shownRows} compact={compact} />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={apply} disabled={!canApply}>
              Применить значения
            </Button>
            <p role="status" aria-live="polite" className={cn("text-sm", errors > 0 && "text-destructive")}>
              {errors > 0
                ? `Исправьте ${errors} ${pluralRu(errors, ["ошибку", "ошибки", "ошибок"])} в файле и проверьте его снова`
                : applied
                  ? `Значения из файла «${result.fileName ?? ""}» применены`
                  : ""}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
