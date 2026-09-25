/**
 * Классы оформления админки — одни на все формы и таблицы раздела, чтобы поля и кнопки
 * выглядели одинаково на страницах каталога, нормативов, параметров и данных.
 */

// .field: BCB's flat form-control recipe (border-color-only focus, no ring) — see
// app/globals.css. aria-invalid keeps its own destructive border on top; tabular-nums stays
// because these are numeric norm/parameter fields.
export const INPUT_CLASS = "field tabular-nums disabled:opacity-60 aria-invalid:border-destructive";

export const SELECT_CLASS = "field disabled:opacity-60";

export const LABEL_CLASS = "flex min-w-0 flex-col gap-1 text-sm";

export const LABEL_TEXT_CLASS = "text-xs font-medium text-muted-foreground";

export const CHECK_LABEL_CLASS = "inline-flex items-center gap-2 text-sm";

export const TH_CLASS = "px-3 py-2 text-left text-[0.6875rem] font-medium tracking-[0.08em] text-muted-foreground uppercase";

export const TD_CLASS = "border-t border-border-faint px-3 py-2 align-top";

export const TABLE_WRAP_CLASS = "data-table-wrap";

export const SECTION_CLASS = "flex flex-col gap-3";

// Нейтральная метка (BCB .chip) и статусный бейдж (BCB .badge, data-tone на теге) —
// см. app/globals.css. Раньше это была одна ad-hoc строка на оба случая.
export const CHIP_CLASS = "chip whitespace-nowrap";
export const BADGE_CLASS = "badge whitespace-nowrap";
