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
 */
export function displayValue(draft: string | null, value: number): string {
  const fromModel = Number.isFinite(value) ? String(value) : "0";
  if (draft === null) return fromModel;
  // Mid-typing states carry no committed number, so there is nothing to disagree with yet.
  if (draft === "" || draft === "-" || draft.endsWith(".")) return draft;
  return Number(draft) === value ? draft : fromModel;
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
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        // Подчёркивание вместо рамки: поле перестаёт быть коробкой и становится строкой,
        // в которую пишут. Фокус при этом обязан остаться видимым — без рамки его больше
        // нечем показать, и клавиатурная навигация иначе слепнет (SC 2.4.7).
        className="w-full border-0 border-b-2 border-input bg-transparent px-1 py-2 text-base
          tabular-nums transition-colors outline-none
          hover:border-muted-foreground
          focus-visible:border-primary focus-visible:ring-0
          aria-invalid:border-destructive"
        // Keep the raw string while the field is mid-edit so it can be cleared and retyped.
        // Binding straight to the number meant `Number("")` was 0: clearing the box to type a
        // new figure instantly rewrote it to 0, and you had to select-all instead.
        value={displayValue(draft, value)}
        onChange={(e) => {
          const raw = e.target.value;
          // An empty or half-typed value has no number to disagree with, so it is always kept.
          setDraft(raw);
          // Only commit parseable input; an empty or half-typed value ("-", "1e") leaves the
          // last good number in place rather than pushing NaN or 0 into the model.
          if (raw !== "" && Number.isFinite(Number(raw))) onChange(Number(raw));
        }}
        onBlur={() => {
          setDraft(null);
          if (onCommit) onCommit(value);
        }}
      />
    </div>
  );
}
