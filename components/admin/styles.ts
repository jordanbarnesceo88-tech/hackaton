/**
 * Классы оформления админки — одни на все формы и таблицы раздела, чтобы поля и кнопки
 * выглядели одинаково на страницах каталога, нормативов, параметров и данных.
 */

export const INPUT_CLASS =
  "w-full min-w-0 rounded-md border border-input bg-background px-2 py-1.5 text-sm tabular-nums outline-none " +
  "transition-colors focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/40 " +
  "disabled:opacity-60 aria-invalid:border-destructive";

export const SELECT_CLASS =
  "w-full min-w-0 rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none transition-colors " +
  "focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-60";

export const LABEL_CLASS = "flex min-w-0 flex-col gap-1 text-sm";

export const LABEL_TEXT_CLASS = "text-xs font-medium text-muted-foreground";

export const CHECK_LABEL_CLASS = "inline-flex items-center gap-2 text-sm";

export const TH_CLASS = "px-3 py-2 text-left text-xs font-medium text-muted-foreground";

export const TD_CLASS = "border-t px-3 py-2 align-top";

export const TABLE_WRAP_CLASS = "overflow-x-auto rounded-lg border";

export const SECTION_CLASS = "flex flex-col gap-3";

export const CHIP_CLASS = "inline-flex items-center rounded-full border px-2 py-0.5 text-xs leading-tight whitespace-nowrap";
