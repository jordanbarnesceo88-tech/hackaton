import type { NormValues } from "../norms";
import type { ProcessDef } from "../processes";
import type { ItemResult, LineItem, Origin, ProductForCalc, ScenarioItem } from "../types";
import type { WorkHours } from "./context";

/**
 * Внутренние формы движка: рассчитанная позиция сценария со всеми входами денег. Наружу не
 * экспортируются из index.ts — публичный результат описан в lib/tz/types.ts.
 */
export type ItemCalc = {
  item: ScenarioItem;
  process: ProcessDef;
  product: ProductForCalc;
  norms: NormValues;
  hours: WorkHours;
  n: number;
  chargers: number;
  roleCost: number;
  cashRealizationShare?: number;
  /** Цена за единицу для покупки (ручная или из карточки); null — для RaaS не нужна. */
  priceRub: number | null;
  priceOverridden: boolean;
  /** Ставка RaaS за робота в месяц; null — для покупки не нужна. */
  raasRubMonth: number | null;
  raasOverridden: boolean;
  result: ItemResult;
};

/** Происхождение характеристики продукта по её ключу (из ProductForCalc.sources). */
export function charOrigin(product: ProductForCalc, key: string, fallback: Origin): Origin {
  return product.sources.find((s) => s.key === key)?.origin ?? fallback;
}

/**
 * Сливает строки нескольких позиций по ключу в порядке первого появления: значения
 * суммируются, подстановки соединяются через «+», при разном происхождении — «derived».
 * Для сценария из одной позиции возвращает её строки без изменений.
 */
export function mergeLines(parts: LineItem[][]): LineItem[] {
  if (parts.length === 1) return parts[0] ?? [];
  const out: LineItem[] = [];
  const byKey = new Map<string, { line: LineItem; subs: string[]; notes: Set<string>; formulas: string[] }>();
  for (const lines of parts) {
    for (const l of lines) {
      const cur = byKey.get(l.key);
      if (!cur) {
        const copy: LineItem = { ...l };
        byKey.set(l.key, { line: copy, subs: [l.substituted], notes: new Set(l.originNote ? [l.originNote] : []), formulas: [l.formula] });
        out.push(copy);
        continue;
      }
      cur.line.valueRub += l.valueRub;
      cur.subs.push(l.substituted);
      cur.formulas.push(l.formula);
      if (l.originNote) cur.notes.add(l.originNote);
      if (cur.line.origin !== l.origin) cur.line.origin = "derived";
      if (l.overridden) cur.line.overridden = true;
      cur.line.includedInSubscription = Boolean(cur.line.includedInSubscription && l.includedInSubscription);
      if (!cur.line.includedInSubscription) delete cur.line.includedInSubscription;
      cur.line.includedInService = Boolean(cur.line.includedInService && l.includedInService);
      if (!cur.line.includedInService) delete cur.line.includedInService;
    }
  }
  for (const { line, subs, notes, formulas } of byKey.values()) {
    if (subs.length > 1) line.substituted = subs.map((s) => `[${s}]`).join(" + ");
    if (new Set(formulas).size > 1) line.formula = `Сумма по позициям: ${formulas.map(value => `[${value}]`).join(" + ")}`;
    if (notes.size > 0) line.originNote = [...notes].join("; ");
  }
  return out;
}

/** Сумма строк. */
export function sumLines(lines: readonly LineItem[]): number {
  return lines.reduce((a, l) => a + l.valueRub, 0);
}
