"use client";

import { useState } from "react";
import { Label } from "@/components/ui/label";

// Generic labelled number input. Non-finite values render as 0 so a transiently-empty field
// never shows NaN. Shared across the economics calculator and any other numeric forms.
/**
 * Which string the input shows: the user's in-progress text, or the model's value.
 *
 * Two requirements pull against each other. The field has to be clearable and half-typable, so
 * "", "-" and "12." must survive — binding straight to the number made `Number("")` 0 and
 * rewrote the box the instant it was emptied. But consumers may also reject or clamp what was
 * typed (AssumptionsPanel clamps into ASSUMPTION_BOUNDS), and when that happens the model has to
 * win, or the box says 5 while every figure on the page was computed from 1 — a control
 * asserting something the model has stopped agreeing with.
 *
 * И-6. Половина этого правила была нечестной. Пока поле пусто, модель ПРОДОЛЖАЕТ держать
 * прежнее число, и вся страница считает по нему — а на экране его нет нигде. Пустая коробка не
 * ошибка: очистить поле перед набором нового числа надо уметь. Ошибка — молчание о том, по
 * какому числу в этот момент считает страница. Поэтому текст черновика остаётся, а число,
 * которое пропало с экрана, называет `computingOn` — и поле печатает его подписью рядом.
 * Возвращать модель прямо в коробку нельзя: это ровно тот случай, из-за которого черновик и
 * появился (набрать новое число стало бы невозможно).
 */
export function displayValue(draft: string | null, value: number): string {
  const fromModel = Number.isFinite(value) ? String(value) : "0";
  if (draft === null) return fromModel;
  // Mid-typing states carry no committed number, so there is nothing to disagree with yet.
  if (draft === "" || draft === "-" || draft.endsWith(".")) return draft;
  return Number(draft) === value ? draft : fromModel;
}

/**
 * То же правило для поля, у которого ПУСТО — полноправное значение, а не «ещё не ввели».
 *
 * Отличие ровно одно: пустая строка совпадает с моделью тогда и только тогда, когда модель
 * тоже пуста (`null`). Если модель держит число — хоть НОЛЬ — коробка обязана показать его:
 * пусто и ноль здесь разные инструкции движку (`resolveTaskFte`), и показать одно вместо
 * другого значит подменить ответ человека.
 *
 * Раньше черновик побеждал модель безусловно, и отказ поля был невидим: `onChange` не
 * принимает число меньше `min`, поэтому «−1» в занятости по задаче не доходило до модели, а в
 * коробке оставалось. Экран говорил −1, страница считала по 5, и ничто об этом не сообщало —
 * тот же класс расхождения, что И-6.
 */
export function nullableDisplayValue(draft: string | null, value: number | null): string {
  const fromModel = value === null || !Number.isFinite(value) ? "" : String(value);
  if (draft === null) return fromModel;
  if (draft.trim() === "") return value === null ? draft : fromModel;
  // Недонабранное число ещё ни с чем не спорит.
  if (draft === "-" || draft.endsWith(".")) return draft;
  return Number(draft) === value ? draft : fromModel;
}

/**
 * Число, по которому страница считает прямо сейчас, если в поле его больше не видно.
 * `null` — видно, говорить не о чем.
 *
 * Инвариант, который держит эта функция вместе с подписью под полем: **число, по которому
 * считает страница, обязано быть на странице видно**. Принимает уже готовую строку из
 * `displayValue`/`nullableDisplayValue`, а не черновик, — чтобы не завести вторую копию
 * правила «что сейчас в коробке» и не дать ей разойтись с первой.
 *
 * Пустая строка не приравнивается к нулю намеренно: `Number("")` — это 0, но пустая коробка
 * не показывает ноль, и при модели 0 страница считает по числу, которого на экране нет.
 */
export function computingOn(shown: string, value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return shown.trim() !== "" && Number(shown) === value ? null : value;
}

const FIELD_CLASS =
  // Подчёркивание вместо рамки: поле перестаёт быть коробкой и становится строкой,
  // в которую пишут. Фокус при этом обязан остаться видимым — без рамки его больше
  // нечем показать, и клавиатурная навигация иначе слепнет (SC 2.4.7).
  `w-full border-0 border-b-2 border-input bg-transparent px-1 py-2 text-base
   tabular-nums transition-colors outline-none
   hover:border-muted-foreground
   focus-visible:border-primary focus-visible:ring-0
   aria-invalid:border-destructive`;

/**
 * Подпись, называющая число, которое ушло с экрана, но по которому идёт расчёт.
 *
 * Говорит ровно то, что заведомо правда СЕЙЧАС. Обещания вида «оно вернётся, когда вы уйдёте
 * из поля» здесь не место: `onCommit` умеет привести значение к границам на blur, и тогда в
 * коробку вернулось бы другое число, а подпись оказалась бы ещё одним ложным утверждением —
 * тем самым, от которого она заведена.
 */
function DetachedNotice({ id, value }: { id: string; value: number }) {
  return (
    <p id={id} role="status" className="text-xs text-caution">
      В поле нет числа — расчёт по-прежнему идёт по {String(value)}.
    </p>
  );
}

export function NumField({
  id,
  label,
  value,
  step = 1,
  min = 0,
  max,
  onChange,
  onCommit,
}: {
  id: string;
  label: string;
  value: number;
  step?: number;
  min?: number;
  max?: number;
  onChange: (n: number) => void;
  /**
   * Вызывается при уходе из поля. Нужен там, где значение надо привести к границам: делать
   * это на каждом нажатии — значит сделать поле с большой нижней границей ненабираемым.
   * У `areaPerCleanerPerYear` минимум 10 000: первая же цифра «4» превращалась в 10000 и
   * переписывала ввод, следующая давала 100000, и добраться до 400000 было нельзя никак.
   */
  onCommit?: (n: number) => void;
}) {
  // null = not being edited, show the model's value; a string = the user's in-progress text.
  const [draft, setDraft] = useState<string | null>(null);
  // Keep the raw string while the field is mid-edit so it can be cleared and retyped.
  // Binding straight to the number meant `Number("")` was 0: clearing the box to type a
  // new figure instantly rewrote it to 0, and you had to select-all instead.
  const shown = displayValue(draft, value);
  const detached = computingOn(shown, value);
  const noticeId = `${id}-computing-on`;
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        className={FIELD_CLASS}
        aria-describedby={detached !== null ? noticeId : undefined}
        value={shown}
        onChange={(e) => {
          const raw = e.target.value;
          // An empty or half-typed value has no number to disagree with, so it is always kept.
          setDraft(raw);
          // Only commit parseable input; an empty or half-typed value ("-", "1e") leaves the
          // last good number in place rather than pushing NaN or 0 into the model — и именно
          // поэтому поле обязано сказать, какое это число (`DetachedNotice`).
          if (raw !== "" && Number.isFinite(Number(raw))) onChange(Number(raw));
        }}
        onBlur={() => {
          setDraft(null);
          if (onCommit) onCommit(value);
        }}
      />
      {detached !== null && <DetachedNotice id={noticeId} value={detached} />}
    </div>
  );
}

/**
 * Числовое поле, которое умеет быть ПУСТЫМ.
 *
 * `NumField` пустым быть не может: он связан с `number`, и очищенная коробка означает либо
 * ноль, либо прежнее значение. Для занятости по задачам это неверно по существу — «никто не
 * занят» (ноль) и «я не знаю» (пусто) это разные ответы, и движок трактует их по-разному:
 * по нулю он считает, что замещать некого, по отсутствию — берёт норматив категории.
 *
 * Поэтому здесь `null` — полноправное значение, а не «ещё не ввели».
 */
export function NullableNumField({
  id,
  label,
  value,
  placeholder,
  min = 0,
  max,
  invalid = false,
  onChange,
}: {
  id: string;
  label: string;
  value: number | null;
  /** Что показывать в пустом поле — например, «по нормативу 6». */
  placeholder?: string;
  min?: number;
  max?: number;
  invalid?: boolean;
  onChange: (n: number | null) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = nullableDisplayValue(draft, value);
  const detached = computingOn(shown, value);
  const noticeId = `${id}-computing-on`;
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        aria-describedby={detached !== null ? noticeId : undefined}
        className={FIELD_CLASS}
        value={shown}
        onChange={(e) => {
          const raw = e.target.value;
          setDraft(raw);
          // Пустая строка — это null, а НЕ ноль и не «оставить прежнее».
          if (raw.trim() === "") return onChange(null);
          const n = Number(raw);
          if (Number.isFinite(n) && n >= min) onChange(n);
        }}
        onBlur={() => setDraft(null)}
      />
      {detached !== null && <DetachedNotice id={noticeId} value={detached} />}
    </div>
  );
}
