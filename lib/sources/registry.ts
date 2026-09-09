import { WAREHOUSE_REAL } from "@/scripts/parse-sources/warehouse-real";
import { SOLUTION_CLASSES } from "@/scripts/seed-data/solution-classes";

export type Citation = {
  /** Что именно утверждает этот источник. */
  label: string;
  /** Цена или производительность — это разные утверждения, и у них разные источники. */
  kind: "price" | "capacity";
  /**
   * Ссылка — или null, если утверждение опирается на оценку, у которой источник назван, но
   * страницы нет. У вендорских решений цена именно такая: производители не публикуют прайс,
   * оценка взята у третьей стороны и названа в `priceBasis` словами.
   */
  url: string | null;
  /** Чем обосновано утверждение, когда ссылки нет. */
  basis?: string;
  /** Дата, когда источник открывали, YYYY-MM-DD. */
  lastVerified: string;
};

/**
 * Все внешние утверждения приложения, собранные из тех же модулей, из которых идёт сев.
 *
 * ВЫВОДИТСЯ, а не пишется: страница про честность, чей список источников разошёлся с реальными
 * данными, — худший из возможных экспонатов на такой странице. Тем же списком пользуется
 * `npm run check:sources`, чтобы два определения «списка источников» не разъехались.
 */
export const ALL_CITATIONS: Citation[] = [
  // У вендорского решения sourceUrl цитирует ПРОИЗВОДИТЕЛЬНОСТЬ — это страница продукта, с
  // которой взяты тоты в час или отборы со станции. Ценой она не занимается вовсе: цены на
  // промышленных роботов не публикуются, и в данных цена помечена оценкой, чей источник
  // назван прозой в priceBasis и ссылки не имеет.
  //
  // Регистрировать эту ссылку как источник цены значило приписывать странице утверждение,
  // которого она не делает, — и делать это на странице, существующей ради различения этих
  // двух утверждений.
  ...WAREHOUSE_REAL.flatMap((s) => [
    {
      label: s.name,
      kind: "capacity" as const,
      url: s.sourceUrl,
      lastVerified: s.lastVerified,
    },
    {
      label: s.name,
      kind: "price" as const,
      url: null,
      basis: s.priceBasis,
      lastVerified: s.lastVerified,
    },
  ]),
  ...SOLUTION_CLASSES.flatMap((c) => [
    { label: c.name, kind: "price" as const, url: c.sourceUrl, lastVerified: c.lastVerified },
    {
      label: c.name,
      kind: "capacity" as const,
      url: c.capacitySourceUrl,
      lastVerified: c.lastVerified,
    },
  ]),
];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Возраст цитаты в днях; null, если дату использовать нельзя — это ХУЖЕ старой даты, а не лучше.
 *
 * Непарсящаяся дата — не единственный такой случай. Дата из будущего (опечатка в годе или
 * дата, сдвинутая вперёд перед демонстрацией) давала отрицательный возраст, и обе проверки
 * читали его как «свежее некуда»: гейт свежести молча отключался для этого источника
 * навсегда. Формат тоже важен: `new Date` разбирает «07.09.2026» как 9 июля, то есть выдаёт
 * правдоподобный, но неверный возраст, — поэтому строка обязана быть ISO-датой.
 */
export function citationAgeDays(c: Citation, now = Date.now()): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.lastVerified)) return null;
  const t = new Date(c.lastVerified).getTime();
  if (!Number.isFinite(t)) return null;
  const age = Math.floor((now - t) / DAY_MS);
  return age < 0 ? null : age;
}
