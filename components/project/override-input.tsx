"use client";

import { useId, useState } from "react";
import { fx } from "@/lib/tz/econ/text";

/**
 * Ручная корректировка автоматически рассчитанного значения (ТЗ §3.5.4: авто-значения видны,
 * их можно переопределить, каждое изменение пишется в журнал).
 *
 * Расчётное значение не прячется: оно всегда подписано «авто: …», а заданное вручную —
 * помечено «задано вами» (или другим бейджем, например «оценка 5,2 % цены») с кнопкой «вернуть
 * расчётное». Изменение применяется явно (кнопка «Применить» или Enter), а не на каждое
 * нажатие клавиши: одна корректировка — одна запись журнала, и причина, если её указали,
 * уходит вместе с ней.
 *
 * Значение вне допустимого диапазона не прижимается молча, а не принимается: под полем
 * появляется сообщение с диапазоном и примером (ТЗ §4: ошибка говорит, как исправить). Так
 * в журнал не попадает число, которого пользователь не вводил.
 *
 * Доли (загрузка 0,775, ставка 0,12) редактируются в процентах (`percent`): на экране «77,5 %»,
 * ввод «80» — это 80 %, а наверх уходит доля 0,8. Подсказка с диапазоном тоже в процентах,
 * поэтому единицы поля, подсказки и сообщения об ошибке совпадают.
 */

/**
 * Число из русской записи: пробелы и неразрывные пробелы — разделители разрядов, запятая —
 * десятичный знак («2 700 000», «0,775», «1 250 000,5»). Пусто или не число — null.
 */
export function parseRuNumber(text: string): number | null {
  // Класс \s в JS покрывает и неразрывные пробелы U+00A0 и U+202F, которые ставит Intl ru-RU.
  const s = text.replace(/\s/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const editableFormatters = new Map<number, Intl.NumberFormat>();

/**
 * Число для поля ввода (подсказка-плейсхолдер): без разделителей разрядов, с десятичной
 * запятой и не длиннее, чем подпись «авто: …» — до сотых, у чисел меньше единицы — до
 * десятитысячных. «19,059720457433293» → «19,06».
 */
export function editableNumber(n: number): string {
  const digits = Math.abs(n) < 1 ? 4 : 2;
  let f = editableFormatters.get(digits);
  if (!f) {
    f = new Intl.NumberFormat("ru-RU", { useGrouping: false, minimumFractionDigits: 0, maximumFractionDigits: digits });
    editableFormatters.set(digits, f);
  }
  return f.format(n);
}

/** Доля → проценты и обратно без хвостов двоичной арифметики (0,07 × 100 = 7, а не 7,000…01). */
export function toPercent(share: number): number {
  return Number((share * 100).toPrecision(12));
}

export function fromPercent(pct: number): number {
  return Number((pct / 100).toPrecision(12));
}

type CheckOptions = {
  /** Целое не меньше 1 (число роботов). */
  integer?: boolean;
  /** Нижняя граница без `range`; по умолчанию 0 (строго больше, как требует движок). */
  min?: number;
  minInclusive?: boolean;
  /**
   * Допустимый диапазон; вне его значение не принимается. В `checkOverride` — в единицах
   * ввода (проценты), в `readOverride` — в единицах движка (доли), он пересчитывает сам.
   */
  range?: readonly [number | null, number | null];
  /** Единица ввода — для текста ошибки («70–85 %»). */
  unit?: string;
  /** Ввод в процентах — ошибка подсказывает, что «0,8» здесь означает 0,8 %, а не 80 %. */
  percent?: boolean;
};

function rangeLabel(lo: number | null, hi: number | null, unit: string): string {
  const u = unit === "" ? "" : ` ${unit}`;
  if (lo !== null && hi !== null) return `${fx(lo)}–${fx(hi)}${u}`;
  if (lo !== null) return `не меньше ${fx(lo)}${u}`;
  return `не больше ${fx(hi ?? 0)}${u}`;
}

/**
 * Проверка введённого числа (в единицах ввода). `integer` — целое не меньше 1; `range` —
 * диапазон норматива: вне его — ошибка с диапазоном и примером, без прижатия; иначе число не
 * меньше `min` (по умолчанию строго больше нуля, как требует движок для цены, ставки и
 * производительности). Возвращает число или текст ошибки с подсказкой, как исправить.
 */
export function checkOverride(
  n: number | null,
  opts: CheckOptions,
): { ok: true; value: number } | { ok: false; message: string } {
  if (n === null) {
    return {
      ok: false,
      message: opts.percent ? "Введите число в процентах, например 80." : "Введите число, например 12 или 0,8.",
    };
  }
  if (opts.integer) {
    return Number.isInteger(n) && n >= 1
      ? { ok: true, value: n }
      : { ok: false, message: "Нужно целое число не меньше 1." };
  }
  if (opts.range) {
    const [lo, hi] = opts.range;
    if ((lo !== null && n < lo) || (hi !== null && n > hi)) {
      const allowed = rangeLabel(lo, hi, opts.unit ?? "");
      const hint = opts.percent && n > 0 && n <= 1 ? " Значение вводится в процентах: 80 означает 80 %." : "";
      return { ok: false, message: `Допустимо ${allowed}: введите число в этом диапазоне.${hint}` };
    }
    return { ok: true, value: n };
  }
  const min = opts.min ?? 0;
  const inclusive = opts.minInclusive ?? false;
  const passes = inclusive ? n >= min : n > min;
  if (passes) return { ok: true, value: n };
  return {
    ok: false,
    message: inclusive ? `Число не может быть меньше ${fx(min)}.` : `Число должно быть больше ${fx(min)}.`,
  };
}

/**
 * Разбор и проверка текста поля целиком: русская запись → число → проверка в единицах ввода →
 * значение для движка (при `percent` — доля). `range` передаётся в единицах движка (долях).
 */
export function readOverride(
  draft: string,
  opts: CheckOptions,
): { ok: true; value: number } | { ok: false; message: string } {
  const pct = opts.percent ?? false;
  const range = opts.range
    ? ([
        opts.range[0] === null ? null : pct ? toPercent(opts.range[0]) : opts.range[0],
        opts.range[1] === null ? null : pct ? toPercent(opts.range[1]) : opts.range[1],
      ] as const)
    : undefined;
  const checked = checkOverride(parseRuNumber(draft), { ...opts, range });
  if (!checked.ok) return checked;
  return { ok: true, value: pct ? fromPercent(checked.value) : checked.value };
}

const INPUT_CLASS =
  "w-36 rounded-md border border-input bg-transparent px-2 py-1.5 text-sm tabular-nums outline-none " +
  "focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/40 aria-invalid:border-destructive";

const BUTTON_CLASS =
  "rounded-md border border-input px-2.5 py-1.5 text-sm transition-colors hover:bg-accent " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50";

const BADGE_CLASS = "rounded bg-caution/15 px-1.5 py-0.5 text-xs font-medium text-caution";

export function OverrideInput({
  label,
  unit,
  auto,
  value,
  onChange,
  readOnly = false,
  integer = false,
  min,
  minInclusive,
  range,
  percent = false,
  format = (n: number) => fx(n),
  hint,
  badge = "задано вами",
}: {
  label: string;
  /** Единица ввода и показа; при `percent` — «%» или «% в год». */
  unit: string;
  /** Расчётное значение (в единицах движка); null — движок его не вычислил (нет данных). */
  auto: number | null;
  /** Заданное вручную значение (в единицах движка); undefined или null — не задано. */
  value: number | null | undefined;
  /** null — вернуть расчётное; `reason` — причина из поля «Причина изменения». */
  onChange?: (value: number | null, reason?: string) => void;
  readOnly?: boolean;
  integer?: boolean;
  min?: number;
  minInclusive?: boolean;
  /** Допустимый диапазон в единицах движка; значение вне его не принимается. */
  range?: readonly [number | null, number | null];
  /** Значения — доли, на экране и во вводе — проценты (0,775 ↔ «77,5 %»). */
  percent?: boolean;
  /** Формат числа для «авто: …» (без `percent`). */
  format?: (n: number) => string;
  /** Дополнительная строка под полем: диапазон, источник и т. п. */
  hint?: string;
  /** Бейдж заданного значения; по умолчанию «задано вами», для оценки — «оценка …». */
  badge?: string;
}) {
  const id = useId();
  const [draft, setDraft] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const overridden = value !== undefined && value !== null;
  const shown = (n: number) => (percent ? fx(toPercent(n), 2) : format(n));
  const withUnit = (n: number) => (unit === "" ? shown(n) : `${shown(n)} ${unit}`);
  const autoText = auto === null ? "не рассчитано" : withUnit(auto);
  const editable = (n: number) => editableNumber(percent ? toPercent(n) : n);

  // Ошибка относится к конкретной паре «авто / задано»: если значение сменилось снаружи
  // (пересчёт, другой сценарий), старое сообщение описывало бы уже не то число.
  const subject = `${auto} ${value}`;
  const [seen, setSeen] = useState(subject);
  if (seen !== subject) {
    setSeen(subject);
    setError(null);
  }

  if (readOnly || !onChange) {
    return (
      <div className="flex flex-col gap-0.5 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums">
          {overridden ? withUnit(value) : autoText}
          {overridden && <span className={`ml-2 ${BADGE_CLASS}`}>{badge}</span>}
        </span>
        {overridden && <span className="text-xs text-muted-foreground">авто: {autoText}</span>}
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
    );
  }

  const apply = () => {
    const checked = readOverride(draft, { integer, min, minInclusive, range, unit, percent });
    if (!checked.ok) {
      setError(checked.message);
      return;
    }
    setError(null);
    setDraft("");
    const r = reason.trim();
    setReason("");
    onChange(checked.value, r === "" ? undefined : r);
  };

  const reset = () => {
    setError(null);
    setDraft("");
    const r = reason.trim();
    setReason("");
    onChange(null, r === "" ? undefined : r);
  };

  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1 text-sm">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          className={INPUT_CLASS}
          value={draft}
          placeholder={overridden ? editable(value) : auto === null ? "задайте значение" : editable(auto)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              apply();
            }
          }}
        />
        {unit !== "" && !label.includes(unit) && <span className="text-muted-foreground">{unit}</span>}
        <button type="button" className={BUTTON_CLASS} onClick={apply} disabled={draft.trim() === ""}>
          Применить
        </button>
      </div>
      <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        <span className="tabular-nums">авто: {autoText}</span>
        {overridden && (
          <>
            <span className={BADGE_CLASS}>{badge}</span>
            <span className="tabular-nums text-foreground">{withUnit(value)}</span>
            <button
              type="button"
              onClick={reset}
              className="underline underline-offset-2 transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              вернуть расчётное
            </button>
          </>
        )}
      </p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <input
        type="text"
        aria-label={`Причина изменения (необязательно): ${label}`}
        placeholder="Причина изменения (необязательно)"
        className="w-full max-w-sm rounded-md border border-input bg-transparent px-2 py-1 text-xs outline-none focus-visible:border-primary"
        value={reason}
        maxLength={300}
        onChange={(e) => setReason(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && draft.trim() !== "") {
            e.preventDefault();
            apply();
          }
        }}
      />
      {error && (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
