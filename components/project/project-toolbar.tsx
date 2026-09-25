"use client";

import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { useActionState, useId, useState, useTransition, type ReactNode } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  copyProjectAction,
  deleteProjectAction,
  saveProjectAction,
  type ProjectActionFailure,
  type SaveProjectInput,
  type SaveProjectResult,
} from "@/lib/projects/actions";
import { cn } from "@/lib/utils";

/**
 * Панель действий рабочей области (ТЗ §2.2 шаг 8 — сохранение и отчёт; §3.1.3 — копирование и
 * удаление проекта; §3.7.3 — выгрузки PDF, Excel, CSV; §4.3.3 — видимый статус расчёта).
 *
 * Две части:
 * - `RecalcBar` — липкая строка под навигацией по шагам: кнопка «Пересчитать», строка
 *   состояния «Расчёт выполнен за … мс · модель … · данные …», статус имитации и баннер
 *   «Параметры изменены — нажмите «Пересчитать»». Кнопка одна на странице и видна из любого
 *   шага, поэтому в панели шага 8 её нет;
 * - `ProjectToolbar` — действия шага 8. Владелец: «Сохранить проект» (серверное действие
 *   пересчитывает модель и имитацию само, результаты браузера не принимаются), «Отчёт (PDF)»,
 *   «Excel», «CSV», «Копировать проект», «Удалить проект». Excel и CSV строятся сервером по
 *   сохранённому расчёту, поэтому до сохранения правок они недоступны («сначала сохраните
 *   проект»). Гость: «CSV» собирается прямо в браузере (lib/report/tz/csv) и ссылка «Войти,
 *   чтобы сохранить проект».
 *
 * Засеянный демо-проект общий для всех, кто входит демо-аккаунтом: сохранение и удаление для
 * него закрыты (сервер откажет и сам), копирование открыто.
 */

const NETWORK_ERROR = "Не удалось связаться с сервером — обновите страницу и повторите";

/** Сообщение о провале сохранения: «Не удалось сохранить: {причина}. Попробуйте ещё раз». */
export function saveFailureText(message: string): string {
  const m = message.trim().replace(/[.\s]+$/u, "");
  const reason = m === "" ? "неизвестная ошибка" : m.charAt(0).toLowerCase() + m.slice(1);
  return `Не удалось сохранить: ${reason}. Попробуйте ещё раз`;
}

const TIME_FORMAT = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" });

/** «Проект сохранён 14:05» — по моменту расчёта, который вернул сервер. */
export function savedText(calculatedAt: string): string {
  const d = new Date(calculatedAt);
  return Number.isNaN(d.getTime()) ? "Проект сохранён" : `Проект сохранён ${TIME_FORMAT.format(d)}`;
}

/** Текст подтверждения удаления проекта. */
export function deleteConfirmText(name: string): string {
  return `Удалить проект «${name}» со всеми сценариями и журналом? Действие необратимо.`;
}

// ——————————————————————————— Строка пересчёта ———————————————————————————

export type RecalcBarProps = {
  onRecalc: () => void;
  /** Режим чтения: пересчитывать нечего менять. */
  readOnly?: boolean;
  /** Параметры или сценарии изменены после последнего расчёта. */
  stale: boolean;
  /** «Расчёт выполнен за … мс · модель … · данные …». */
  statusText: string;
  /** Статус имитации для таблицы сценариев. */
  simText?: string | null;
  /** Есть несохранённые изменения (владелец) — ссылка на шаг 8. */
  unsaved?: boolean;
};

export function RecalcBar({ onRecalc, readOnly = false, stale, statusText, simText, unsaved = false }: RecalcBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-xs">
      <Button type="button" size="sm" onClick={onRecalc} disabled={readOnly}>
        Пересчитать
      </Button>
      <p role="status" aria-live="polite" className="text-muted-foreground tabular-nums">
        {statusText}
      </p>
      {simText && (
        <p aria-live="polite" className="text-muted-foreground">
          {simText}
        </p>
      )}
      <p
        role="status"
        className="rounded-md border border-caution/50 bg-caution/10 px-2 py-0.5 font-medium text-foreground [&:empty]:hidden"
      >
        {stale ? "Параметры изменены — нажмите «Пересчитать»" : ""}
      </p>
      {unsaved && (
        <a href="#report" className="tap-target text-primary underline underline-offset-2">
          Есть несохранённые изменения — сохраните проект (шаг 8)
        </a>
      )}
    </div>
  );
}

// ——————————————————————————— Формы действий с проектом ———————————————————————————

/**
 * Кнопка серверного действия с проектом внутри `<form action>`: при успехе действие само
 * переводит на другую страницу (redirect), при отказе здесь показывается сообщение. Ошибка
 * перенаправления пробрасывается дальше (`unstable_rethrow`) — её обрабатывает роутер.
 */
export function ProjectActionForm({
  run,
  label,
  pendingLabel,
  confirmText,
  disabled = false,
  title,
  variant = "outline",
  size = "default",
}: {
  run: () => Promise<ProjectActionFailure>;
  label: string;
  pendingLabel: string;
  /** Текст подтверждения (window.confirm) перед отправкой; нет — без подтверждения. */
  confirmText?: string;
  disabled?: boolean;
  title?: string;
  variant?: "outline" | "destructive" | "ghost";
  size?: "default" | "sm" | "xs";
}) {
  const [error, formAction, pending] = useActionState(async (): Promise<string | null> => {
    try {
      const r = await run();
      return r.message;
    } catch (e) {
      unstable_rethrow(e);
      console.error("ProjectActionForm", e);
      return NETWORK_ERROR;
    }
  }, null);
  return (
    <form action={formAction} className="inline-flex flex-col gap-1">
      <Button
        type="submit"
        variant={variant}
        size={size}
        disabled={disabled || pending}
        title={title}
        onClick={(e) => {
          if (confirmText && !window.confirm(confirmText)) e.preventDefault();
        }}
      >
        {pending ? pendingLabel : label}
      </Button>
      <span role="alert" className="max-w-xs text-xs text-destructive [&:empty]:hidden">
        {error ?? ""}
      </span>
    </form>
  );
}

// ——————————————————————————— Панель шага 8 ———————————————————————————

/** Ссылка на выгрузку: обычный `<a download>` или недоступная кнопка с подсказкой. */
function DownloadLink({ href, label, disabled, hintId }: { href: string; label: string; disabled: boolean; hintId: string }) {
  if (disabled) {
    return (
      <Button type="button" variant="outline" disabled aria-describedby={hintId}>
        {label}
      </Button>
    );
  }
  // Не next/link: переход на клиенте и предзагрузка файлу не нужны.
  return (
    <a href={href} download className={buttonVariants({ variant: "outline" })}>
      {label}
    </a>
  );
}

export type ProjectToolbarProps = {
  mode: "guest" | "owner" | "readonly";
  /** id проекта (владелец и режим чтения). */
  projectId?: string;
  projectName: string;
  /** Засеянный демо-проект: сохранение и удаление закрыты, копирование открыто. */
  isDemo?: boolean;
  /** Есть несохранённые изменения: выгрузки сервера отражали бы прежнюю версию. */
  dirty: boolean;
  /** Данные для сохранения (рабочая область перед этим пересчитывает устаревшую модель). */
  getSaveInput?: () => SaveProjectInput;
  /** Сохранение прошло: рабочая область очищает журнал ожидающих изменений. */
  onSaved?: (result: Extract<SaveProjectResult, { ok: true }>, input: SaveProjectInput) => void;
  /** Гостевой CSV: текст файла (с BOM) и имя. */
  getCsv?: () => { csv: string; fileName: string };
  /** Момент последнего сохранения (ISO) — строка «Сохранённая версия: …». */
  savedAtText?: string | null;
};

type SaveStatus = { kind: "idle" } | { kind: "ok"; text: string } | { kind: "error"; text: string };

export function ProjectToolbar({
  mode,
  projectId,
  projectName,
  isDemo = false,
  dirty,
  getSaveInput,
  onSaved,
  getCsv,
  savedAtText,
}: ProjectToolbarProps) {
  const hintId = useId();
  const [saving, startSave] = useTransition();
  const [status, setStatus] = useState<SaveStatus>({ kind: "idle" });
  const [csvNote, setCsvNote] = useState<string | null>(null);

  function save() {
    if (!projectId || !getSaveInput) return;
    const input = getSaveInput();
    setStatus({ kind: "idle" });
    startSave(async () => {
      let next: SaveStatus;
      try {
        const r = await saveProjectAction(projectId, input);
        if (r.ok) {
          next = { kind: "ok", text: savedText(r.calculatedAt) };
          onSaved?.(r, input);
        } else {
          next = { kind: "error", text: saveFailureText(r.message) };
        }
      } catch (e) {
        unstable_rethrow(e);
        console.error("ProjectToolbar.save", e);
        next = { kind: "error", text: saveFailureText(NETWORK_ERROR) };
      }
      startSave(() => setStatus(next));
    });
  }

  function downloadCsv() {
    if (!getCsv) return;
    try {
      const { csv, fileName } = getCsv();
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Ссылку освобождаем после того, как браузер начал скачивание.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setCsvNote(`Файл «${fileName}» сформирован в браузере`);
    } catch (e) {
      console.error("ProjectToolbar.csv", e);
      setCsvNote("Не удалось сформировать CSV — обновите страницу и повторите");
    }
  }

  if (mode === "guest") {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={downloadCsv} disabled={!getCsv}>
            CSV
          </Button>
          <Link href="/login" className={buttonVariants({ variant: "default" })}>
            Войти, чтобы сохранить проект
          </Link>
        </div>
        <p className="text-xs text-muted-foreground">
          Гостевой расчёт не сохраняется: CSV собирается из того, что на экране. Сохранение проекта, отчёт для печати
          (PDF) и Excel — после входа.
        </p>
        <p role="status" aria-live="polite" className="text-xs text-muted-foreground [&:empty]:hidden">
          {csvNote ?? ""}
        </p>
      </div>
    );
  }

  const id = projectId ?? "";
  const readOnly = mode === "readonly";
  const exportsDisabled = dirty;
  const saveBlocked = readOnly || isDemo || !getSaveInput;
  let saveHint: ReactNode = null;
  if (isDemo) saveHint = "Демо-проект общий для всех, кто входит демо-аккаунтом: скопируйте его, чтобы сохранять изменения.";
  else if (readOnly) saveHint = "Режим чтения: изменения не сохраняются.";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start gap-2">
        <div className="inline-flex flex-col gap-1">
          <Button type="button" onClick={save} disabled={saveBlocked || saving}>
            {saving ? "Сохраняем проект…" : "Сохранить проект"}
          </Button>
        </div>
        <Link href={`/projects/${encodeURIComponent(id)}/report`} className={buttonVariants({ variant: "outline" })}>
          Отчёт (PDF)
        </Link>
        <DownloadLink
          href={`/projects/${encodeURIComponent(id)}/export.xlsx`}
          label="Excel"
          disabled={exportsDisabled}
          hintId={hintId}
        />
        <DownloadLink
          href={`/projects/${encodeURIComponent(id)}/export.csv`}
          label="CSV"
          disabled={exportsDisabled}
          hintId={hintId}
        />
        <ProjectActionForm
          run={() => copyProjectAction(id)}
          label="Копировать проект"
          pendingLabel="Копируем…"
        />
        <ProjectActionForm
          run={() => deleteProjectAction(id)}
          label="Удалить проект"
          pendingLabel="Удаляем…"
          variant="destructive"
          confirmText={deleteConfirmText(projectName)}
          disabled={isDemo || readOnly}
          title={isDemo ? "Демо-проект нельзя удалить — скопируйте его" : undefined}
        />
      </div>
      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        <p role="status" aria-live="polite" className={cn("text-sm [&:empty]:hidden", status.kind === "error" ? "text-destructive" : "text-foreground")}>
          {status.kind === "idle" ? "" : status.text}
        </p>
        {saveHint && <p>{saveHint}</p>}
        <p id={hintId}>
          {exportsDisabled
            ? "Excel и CSV строятся по сохранённому расчёту: сначала сохраните проект."
            : "Отчёт (PDF), Excel и CSV строятся по сохранённому расчёту."}
          {savedAtText ? ` Сохранённая версия: ${savedAtText}.` : ""}
        </p>
      </div>
    </div>
  );
}
