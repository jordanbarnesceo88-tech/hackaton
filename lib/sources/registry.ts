import { WAREHOUSE_REAL } from "@/scripts/parse-sources/warehouse-real";
import { SOLUTION_CLASSES } from "@/scripts/seed-data/solution-classes";

export type Citation = {
  /** Что именно утверждает этот источник. */
  label: string;
  /** Цена или производительность — это разные утверждения, и у них разные источники. */
  kind: "price" | "capacity";
  url: string;
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
  ...WAREHOUSE_REAL.map((s) => ({
    label: s.name,
    kind: "price" as const,
    url: s.sourceUrl,
    lastVerified: s.lastVerified,
  })),
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

/** Возраст цитаты в днях; null, если дата непарсится — это хуже старой даты, а не лучше. */
export function citationAgeDays(c: Citation, now = Date.now()): number | null {
  const t = new Date(c.lastVerified).getTime();
  return Number.isFinite(t) ? Math.floor((now - t) / DAY_MS) : null;
}
