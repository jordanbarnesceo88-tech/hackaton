"use client";

import { SPEEDS } from "./playback";
import type { SimOption } from "./variants";

/**
 * Управление имитацией (ТЗ §3.6.3): старт, стоп, перезапуск, скорость проигрывания, выбор
 * сценария и парка; плюс «Сразу к итогу», «Скачать PNG» (§3.7.4) и «Принять парк по имитации».
 *
 * Только нативные элементы: <button> и <select> работают с клавиатуры и скринридером без
 * дополнительной разметки. Кнопки скорости — переключатели с постоянным именем и aria-pressed
 * (APG, Button (Toggle)); «Старт» и «Стоп» — отдельные кнопки, а не одна с меняющимся именем.
 * Значки ▶ ❚❚ ↺ входят в видимую подпись и в имя кнопки — они совпадают (SC 2.5.3).
 */

const BTN =
  "inline-flex h-8 items-center gap-1 rounded-md border border-border bg-background px-2.5 text-sm font-medium " +
  "whitespace-nowrap transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const BTN_PRIMARY =
  "inline-flex h-8 items-center gap-1 rounded-md border border-transparent bg-primary px-2.5 text-sm font-medium " +
  "whitespace-nowrap text-primary-foreground transition-colors hover:bg-primary/85 disabled:pointer-events-none " +
  "disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const SPEED_BTN =
  "h-8 min-w-10 border-r border-border bg-background px-2 text-sm font-medium tabular-nums last:border-r-0 " +
  "transition-colors hover:bg-muted aria-pressed:bg-primary aria-pressed:text-primary-foreground " +
  "disabled:opacity-50 focus-visible:relative focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-ring";

export type AcceptFleetControl = {
  /** Минимальный устойчивый парк по имитации (M). */
  fleet: number;
  /** Недоступно: парк сценария уже равен M. */
  disabled: boolean;
  /** Что сделает кнопка (или почему недоступна) — подсказка под кнопкой. */
  hint: string;
};

export function SimControls({
  selectId,
  options,
  value,
  onSelect,
  canPlay,
  playing,
  canSkip,
  speed,
  onStart,
  onStop,
  onRestart,
  onSkip,
  onSpeed,
  canExport,
  exporting,
  onPng,
  accept,
  onAccept,
}: {
  selectId: string;
  options: SimOption[];
  value: string | null;
  onSelect: (value: string) => void;
  /**
   * Прогон без анимации завершён и роботы в нём двигались — можно проигрывать. Вход, отклонённый
   * предварительной проверкой (грузоподъёмность, вне модели), проигрывать нечего.
   */
  canPlay: boolean;
  playing: boolean;
  /** Идёт или приостановлено проигрывание — есть к чему «сразу к итогу». */
  canSkip: boolean;
  speed: number;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
  onSkip: () => void;
  onSpeed: (speed: number) => void;
  canExport: boolean;
  exporting: boolean;
  onPng: () => void;
  /** null — кнопка «Принять парк по имитации» не показывается (только чтение, нет M). */
  accept: AcceptFleetControl | null;
  onAccept: () => void;
}) {
  const hintId = `${selectId}-accept-hint`;
  return (
    <div className="grid gap-3">
      <div className="grid gap-1">
        <label htmlFor={selectId} className="text-sm font-medium">
          Сценарий и парк
        </label>
        <select
          id={selectId}
          value={value ?? ""}
          onChange={(e) => onSelect(e.target.value)}
          disabled={options.length === 0}
          className="h-9 w-full max-w-xl rounded-md border border-input bg-background px-2 text-sm
            focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {value === null && <option value="">Нет сценария для имитации</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={BTN_PRIMARY} onClick={onStart} disabled={!canPlay || playing}>
          ▶ Старт
        </button>
        <button type="button" className={BTN} onClick={onStop} disabled={!playing}>
          ❚❚ Стоп
        </button>
        <button type="button" className={BTN} onClick={onRestart} disabled={!canPlay}>
          ↺ Перезапуск
        </button>
        <div
          role="group"
          aria-label="Скорость проигрывания"
          className="inline-flex overflow-hidden rounded-md border border-border"
        >
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              className={SPEED_BTN}
              aria-pressed={speed === s}
              onClick={() => onSpeed(s)}
            >
              ×{s}
            </button>
          ))}
        </div>
        <button type="button" className={BTN} onClick={onSkip} disabled={!canSkip}>
          Сразу к итогу
        </button>
        <button type="button" className={BTN} onClick={onPng} disabled={!canExport || exporting}>
          {exporting ? "Собираем PNG…" : "Скачать PNG"}
        </button>
      </div>

      {accept && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={BTN}
            onClick={onAccept}
            disabled={accept.disabled}
            aria-describedby={hintId}
          >
            Принять парк по имитации
          </button>
          <span id={hintId} className="text-xs text-muted-foreground">
            {accept.hint}
          </span>
        </div>
      )}
    </div>
  );
}
