import { normThroughput } from "../econ/fleet";
import type { ProcessDef } from "../processes";
import type { ProductFlag, ProductForCalc } from "../types";
import { positiveOrNull, type MissingItem } from "./constraints";
import { SELECTION_CONSTANTS } from "./rules";
import { fmtNum } from "./text";

/**
 * Недостающие данные и пометка «требует проверки» (ТЗ §3.4.2, §3.4.3). Подбор не подставляет
 * ноль вместо неизвестного: продукт без производительности получает статус «Недостаточно
 * данных», без цены — пометку «покупка не рассчитывается», и к каждому пробелу прилагается
 * подсказка, как его заполнить.
 */

/** Можно ли посчитать парк по данным продукта. */
export type ThroughputAssessment = {
  /**
   * Паспортная производительность пригодна для расчёта парка — решает `normThroughput` движка
   * экономики: на один робот или станцию, в единицах процесса, не «до X».
   */
  hasNorm: boolean;
  /**
   * Цикл считается по скорости и планировке объекта: процесс с имитацией и мобильный робот с
   * опубликованной скоростью — то же условие, при котором движок получает цикл (`thrCycle`).
   */
  hasCycle: boolean;
  /** Данных недостаточно — статус «Недостаточно данных». */
  insufficient: boolean;
  /**
   * Почему паспортная производительность не идёт в расчёт; null — идёт. Текст с маленькой
   * буквы: он встраивается в ограничение и в причину статуса.
   */
  normIssue: string | null;
};

/**
 * Пригодность паспортной производительности подбор не решает сам, а спрашивает у движка
 * экономики (`normThroughput`, lib/tz/econ/fleet.ts). Иначе подбор мог бы показать «Кандидат»
 * у продукта, для которого расчёт покупки откажет `throughput_required`. Правило движка:
 * значение на один робот или станцию, в единицах процесса, без оговорки «до» (это предел, а не
 * типичное значение). Причина отказа нормы — текст движка, тот же, что в трассировке расчёта.
 *
 * Цикл по скорости движок получает только для процесса с имитацией и мобильного робота,
 * поэтому для процесса с расчётом (`calcSupported`) «Недостаточно данных» — это «ни нормы, ни
 * цикла». Для процессов-прототипов парк не считается, и там правило ТЗ-минимума: нет ни
 * производительности, ни скорости.
 */
export function assessThroughput(product: ProductForCalc, process: ProcessDef): ThroughputAssessment {
  const thr = positiveOrNull(product.throughputPerH);
  const speed = positiveOrNull(product.speedMps);
  const norm = normThroughput(product, process);

  let normIssue: string | null = null;
  if (norm.value === null) {
    if (thr === null || norm.skipped === null) normIssue = "паспортная производительность не опубликована";
    else {
      const unit = product.throughputUnit?.trim() ? ` ${product.throughputUnit.trim()}` : "";
      normIssue = `паспортная производительность ${fmtNum(thr)}${unit} в расчёт не идёт (${norm.skipped})`;
    }
  }

  const hasNorm = norm.value !== null;
  const hasCycle = process.simSupported && product.mobile && speed !== null;
  const insufficient = process.calcSupported ? !hasNorm && !hasCycle : thr === null && speed === null;
  return { hasNorm, hasCycle, insufficient, normIssue };
}

/** Текст стандартной подсказки для недостающей производительности. */
const THROUGHPUT_HOW_TO_FIX = "Укажите производительность вручную или выберите продукт с данными";

/**
 * Причина статуса «Недостаточно данных» — первой строкой в `reasons`. null — данных хватает.
 */
export function insufficientReason(product: ProductForCalc, process: ProcessDef, a: ThroughputAssessment): string | null {
  if (!a.insufficient) return null;
  if (!process.calcSupported) return "Недостаточно данных: нет ни производительности, ни скорости";
  const cycle = !product.mobile
    ? "цикл по скорости для стационарного решения не считается"
    : !process.simSupported
      ? `цикл по планировке для процесса «${process.name}» не считается`
      : "скорость для расчёта цикла не опубликована";
  return `Недостаточно данных для расчёта парка: ${a.normIssue ?? "паспортная производительность не опубликована"}, ${cycle}`;
}

/**
 * Ограничение «производительность по циклу» (правило S8): паспортной нормы нет или она
 * непригодна, но цикл по скорости посчитать можно. Только для процессов с расчётом парка.
 */
export function cycleOnlyNote(product: ProductForCalc, process: ProcessDef, a: ThroughputAssessment): string | null {
  const speed = positiveOrNull(product.speedMps);
  if (!process.calcSupported || a.hasNorm || !a.hasCycle || speed === null) return null;
  return `${a.normIssue} — в расчёт идёт цикл по скорости ${fmtNum(speed)} м/с и планировке объекта`;
}

/**
 * Недостающие данные продукта: производительность (если парк не посчитать), цена (покупка
 * невозможна) и ставка RaaS (услуга не рассчитывается без явной оценки).
 */
export function missingData(product: ProductForCalc, a: ThroughputAssessment): MissingItem[] {
  const out: MissingItem[] = [];
  if (a.insufficient) {
    out.push({ key: "throughput", label: "Производительность", howToFix: THROUGHPUT_HOW_TO_FIX });
  }
  // Как у движка экономики: цена и ставка должны быть положительными числами, иначе отказ
  // price_required / raas_rate_required.
  if (positiveOrNull(product.priceRub) === null) {
    out.push({
      key: "price",
      label: "Цена оборудования",
      howToFix:
        "Покупка без цены не рассчитывается: укажите цену за единицу (₽) вручную или запросите " +
        "коммерческое предложение у производителя",
    });
  }
  if (positiveOrNull(product.raasRubMonth) === null) {
    out.push({
      key: "raas",
      label: "Ставка RaaS",
      howToFix:
        "Услуга (RaaS) без ставки не рассчитывается: укажите ставку за робота в месяц (₽) или " +
        "подставьте оценку по нормативу — она будет помечена как оценка",
    });
  }
  return out;
}

/** Пометки, которые исключают продукт (R2): в «требует проверки» они не повторяются. */
const HARD_FLAGS: ReadonlySet<ProductFlag> = new Set(["model-not-found", "variant-unpublished", "rnd-exclude"]);

/** Что означает пометка качества данных — для строки «требует проверки: …». */
export const FLAG_NOTES: Readonly<Record<ProductFlag, string>> = {
  "duplicate-merged": "карточка собрана из нескольких строк каталога организатора",
  "model-not-found": "модель не найдена у производителя",
  "variant-unpublished": "вариант не опубликован производителем",
  "manufacturer-disputed": "производитель указан спорно",
  "price-disputed": "в источниках разные цены",
  "price-may-be-subscription": "цена может быть годовой подпиской, а не ценой покупки",
  "price-placeholder": "цена похожа на условную (типовое значение каталога)",
  "case-unconfirmed": "кейс внедрения не подтверждён",
  "values-from-other-product": "часть характеристик взята у другого продукта",
  "no-price": "цена не опубликована",
  "rnd-exclude": "опытный образец",
};

/**
 * Требует ли продукт проверки. Правило плана: любая пометка каталога, неподтверждённая цена
 * или производительность, полнота карточки меньше 60 %. Дополнительно — ограничение объекта,
 * которое нельзя проверить без данных продукта (ТЗ §3.4.3: «при недостатке данных решение
 * может быть отмечено как требующее проверки»).
 */
export function needsVerification(product: ProductForCalc, unverifiedConstraints: number): boolean {
  return (
    product.flags.length > 0 ||
    !product.priceConfirmed ||
    !product.throughputConfirmed ||
    lowCompleteness(product.completenessPct) ||
    unverifiedConstraints > 0
  );
}

/**
 * Полнота карточки ниже порога проверки. Нечисловая полнота (NaN, ±∞ из повреждённого снимка)
 * считается низкой: подтвердить карточку нечем, и `NaN < 60` не должно снимать пометку.
 */
function lowCompleteness(pct: number): boolean {
  return !Number.isFinite(pct) || pct < SELECTION_CONSTANTS.completenessVerifyPct.value;
}

/**
 * Строка «требует проверки: …» с причинами, которые видны из карточки: пометки качества данных
 * (кроме исключающих — они уже в причинах исключения), неподтверждённые цена и
 * производительность, низкая полнота. null — таких причин нет. Отсутствующие цена и
 * производительность здесь не повторяются: они уже в «недостающих данных».
 */
export function verificationNote(product: ProductForCalc): string | null {
  const notes: string[] = [];
  for (const flag of product.flags) {
    if (HARD_FLAGS.has(flag)) continue;
    if (flag === "no-price" && positiveOrNull(product.priceRub) === null) continue;
    const note = FLAG_NOTES[flag];
    if (!notes.includes(note)) notes.push(note);
  }
  if (positiveOrNull(product.priceRub) !== null && !product.priceConfirmed) notes.push("цена не подтверждена первоисточником");
  if (positiveOrNull(product.throughputPerH) !== null && !product.throughputConfirmed) {
    notes.push("производительность не подтверждена первоисточником");
  }
  const minPct = SELECTION_CONSTANTS.completenessVerifyPct.value;
  if (!Number.isFinite(product.completenessPct)) notes.push("полнота карточки не рассчитана");
  else if (lowCompleteness(product.completenessPct)) {
    notes.push(`полнота карточки ${fmtNum(product.completenessPct)} % (меньше ${fmtNum(minPct)} %)`);
  }
  return notes.length > 0 ? `требует проверки: ${notes.join("; ")}` : null;
}
