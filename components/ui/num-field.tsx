"use client";

import { useState } from "react";
import { Label } from "@/components/ui/label";

// Generic labelled number input. Non-finite values render as 0 so a transiently-empty field
// never shows NaN. Shared across the economics calculator and any other numeric forms.
export function NumField({
  id,
  label,
  value,
  step = 1,
  min = 0,
  max,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  step?: number;
  min?: number;
  max?: number;
  onChange: (n: number) => void;
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
        className="rounded-md border px-3 py-2 text-sm"
        // Keep the raw string while the field is mid-edit so it can be cleared and retyped.
        // Binding straight to the number meant `Number("")` was 0: clearing the box to type a
        // new figure instantly rewrote it to 0, and you had to select-all instead.
        value={draft ?? (Number.isFinite(value) ? String(value) : "0")}
        onChange={(e) => {
          const raw = e.target.value;
          setDraft(raw);
          // Only commit parseable input; an empty or half-typed value ("-", "1e") leaves the
          // last good number in place rather than pushing NaN or 0 into the model.
          if (raw !== "" && Number.isFinite(Number(raw))) onChange(Number(raw));
        }}
        onBlur={() => setDraft(null)}
      />
    </div>
  );
}
