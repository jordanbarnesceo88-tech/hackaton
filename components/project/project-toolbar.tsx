"use client";

import type { ProjectActionFailure, SaveProjectInput, SaveProjectResult } from "@/lib/projects/action-types";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { useActionState, useId, useState, type ReactNode } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  copyProjectAction,
  deleteProjectAction,
} from "@/lib/projects/actions";
import { cn } from "@/lib/utils";
import { projectInputSizeIssue } from "@/lib/projects/payload-limit";
import { useDurableCalculation } from "./use-durable-calculation";
import { CalculationJobStatus } from "./calculation-job-status";
import { formatCalcDate } from "@/lib/report/tz/rows";
import { guestDraftRoute, storeGuestDraft, type GuestDraftInput } from "@/lib/projects/guest-draft";

/**
 * Панель действий рабочей области (ТЗ §2.2 шаг 8 — сохранение и отчёт; §3.1.3 — копирование и
 * удаление проекта; §3.7.3 — выгрузки PDF, Excel, CSV; §4.3.3 — видимый статус расчёта).
 *
 * Две части:
 * - `RecalcBar` — липкая строка под навигацией по шагам: кнопка «Пересчитать», строка
 *   состояния «Расчёт выполнен за … мс · модель … · данные …», статус имитации и баннер
 *   «Параметры изменены — нажмите «Пересчитать»». Кнопка одна на странице и видна из любого
 *   шага, поэтому в панели шага 8 её нет;
 * - `ProjectToolbar` — действия шага 8. Владелец: «Сохранить проект» (долговременный серверный
 *   расчёт модели и имитации; результаты браузера не принимаются), «Отчёт (PDF)»,
 *   «Excel», «CSV», «Копировать проект», «Удалить проект». PDF, Excel и CSV строятся сервером по
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
  /** Current server state and the explanation belong to the same command bar. */
  status?: ReactNode;
  explanation?: string;
  retry?: boolean;
};

export function RecalcBar({ onRecalc, readOnly = false, stale, statusText, simText, unsaved = false, status, explanation, retry = false }: RecalcBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-xs">
      <Button type="button" size="sm" onClick={onRecalc} disabled={readOnly}>
        {retry ? "Повторить расчёт" : "Пересчитать"}
      </Button>
      {status}
      <details className="min-w-0 text-muted-foreground"><summary className="cursor-pointer py-1">Детали расчёта</summary><div className="grid gap-1 py-2">
        {explanation && <p className="max-w-3xl text-sm leading-relaxed">{explanation}</p>}
        <p role="status" aria-live="polite" className="break-words tabular-nums">{statusText}</p>
        {simText && <p aria-live="polite">{simText}</p>}
      </div></details>
      <p
        role="status"
        data-tone="warn"
        className="badge [&:empty]:hidden"
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
  revision?: number;
  mode: "guest" | "owner" | "readonly";
  /** id проекта (владелец и режим чтения). */
  projectId?: string;
  projectName: string;
  reportScenarioKey?: string;
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
  getGuestDraft?: () => GuestDraftInput;
  /** Момент последнего сохранения (ISO) — строка «Сохранённая версия: …». */
  savedAtText?: string | null;
};

type SaveStatus = { kind: "idle" } | { kind: "ok"; text: string } | { kind: "error" | "conflict"; text: string };

export function ProjectToolbar({
  revision,
  mode,
  projectId,
  projectName,
  reportScenarioKey,
  isDemo = false,
  dirty,
  getSaveInput,
  onSaved,
  getCsv,
  getGuestDraft,
  savedAtText,
}: ProjectToolbarProps) {
  const hintId = useId();
  const calculation = useDurableCalculation();
  const saving = calculation.busy;
  const [status, setStatus] = useState<SaveStatus>({ kind: "idle" });
  const [csvNote, setCsvNote] = useState<string | null>(null);
  const [latestSavedAt, setLatestSavedAt] = useState<string | null>(null);

  async function save() {
    if (saving || !projectId || !getSaveInput) return;
    const input = getSaveInput();
    const sizeIssue = projectInputSizeIssue(input);
    if (sizeIssue) {
      setStatus({ kind: "error", text: `Не удалось сохранить: ${sizeIssue}. Несохранённые правки остаются в этой вкладке` });
      return;
    }
    if (typeof input.expectedRevision !== "number") {
      setStatus({ kind: "conflict", text: "Неизвестна ревизия проекта. Откройте актуальную версию отдельно, сохранив этот черновик" });
      return;
    }
    setStatus({ kind: "idle" });
    try {
      const r = await calculation.run({ operation: "SAVE", projectId, ...input, expectedRevision: input.expectedRevision }, `save:${projectId}`);
      if (!r) return;
      if (r.job.publicationState !== "PUBLISHED") {
        setStatus({ kind: "conflict", text: "Расчёт готов и сохранён отдельно: проект изменился во время выполнения. Ваш черновик остаётся в этой вкладке" });
        return;
      }
      if (!r.results || r.job.publishedRevision === null) throw new Error("Сервер не вернул сохранённый снимок. Откройте результат расчёта по ссылке");
      onSaved?.({ ok: true, results: r.results, revision: r.job.publishedRevision,
        calculatedAt: r.results.calculatedAt, dataVersion: r.results.dataVersion }, input);
      setLatestSavedAt(formatCalcDate(r.results.calculatedAt));
      setStatus({ kind: "ok", text: savedText(r.results.calculatedAt) });
    } catch (error) {
      setStatus({ kind: "error", text: error instanceof Error ? error.message : saveFailureText(NETWORK_ERROR) });
    }
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
          <Button type="button" disabled={!getGuestDraft} onClick={() => {
            try {
              if (!getGuestDraft) return;
              const nonce = storeGuestDraft(getGuestDraft());
              window.location.assign(guestDraftRoute("/login", nonce));
            } catch (e) { setCsvNote(e instanceof Error ? e.message : "Не удалось перенести черновик. Разрешите хранилище вкладки и повторите."); }
          }}>
            Войти, чтобы сохранить проект
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          В этой вкладке на 30 минут сохранятся параметры, сценарии и план пилота. После входа подтвердите создание проекта:
          сервер заново проверит ввод и выполнит расчёт. CSV доступен по текущему результату; PDF и Excel — из сохранённого проекта.
        </p>
        <p role="status" aria-live="polite" className="text-xs text-muted-foreground [&:empty]:hidden">
          {csvNote ?? ""}
        </p>
      </div>
    );
  }

  const id = projectId ?? "";
  const readOnly = mode === "readonly";
  const exportsDisabled = dirty || saving;
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
        {exportsDisabled ? (
          <Button type="button" variant="outline" disabled aria-describedby={hintId}>
            Отчёт (PDF)
          </Button>
        ) : (
          <Link href={`/projects/${encodeURIComponent(id)}/report${reportScenarioKey ? `?scenario=${encodeURIComponent(reportScenarioKey)}` : ""}`} className={buttonVariants({ variant: "outline" })}>
            Отчёт (PDF)
          </Link>
        )}
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
          run={() => deleteProjectAction(id, revision)}
          label="Удалить проект"
          pendingLabel="Удаляем…"
          variant="destructive"
          confirmText={deleteConfirmText(projectName)}
          disabled={isDemo || readOnly}
          title={isDemo ? "Демо-проект нельзя удалить — скопируйте его" : undefined}
        />
      </div>
      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        <p role="status" aria-live="polite" className={cn("text-sm [&:empty]:hidden", status.kind === "error" || status.kind === "conflict" ? "text-destructive" : "text-foreground")}>
          {status.kind === "idle" ? "" : status.text}
        </p>
        {status.kind === "conflict" && <a href={`/projects/${encodeURIComponent(id)}`} target="_blank" rel="noreferrer" className="text-primary underline">Открыть актуальную версию в новой вкладке; оставить этот черновик</a>}
        <CalculationJobStatus job={calculation.job} cancelling={calculation.cancelling} onCancel={() => {
          void calculation.cancel().catch(error => setStatus({ kind: "error", text: error instanceof Error ? error.message : "Не удалось подтвердить отмену" }));
        }} />
        {saveHint && <p>{saveHint}</p>}
        <p id={hintId}>
          {exportsDisabled
            ? "Отчёт (PDF), Excel и CSV строятся по сохранённому расчёту: сначала сохраните проект."
            : "Отчёт (PDF), Excel и CSV строятся по сохранённому расчёту."}
          {latestSavedAt || savedAtText ? ` Сохранённая версия: ${latestSavedAt ?? savedAtText}.` : ""}
        </p>
      </div>
    </div>
  );
}
