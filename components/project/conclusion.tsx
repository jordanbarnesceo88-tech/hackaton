"use client";

import type { Conclusion as ConclusionData } from "@/lib/tz/types";

/**
 * Вывод по проекту (ТЗ §3.5.7: рекомендация — не жёсткий порог, а число, риски и
 * интерпретация; §3.7.1 — краткий вывод под сравнением сценариев). Заголовок, пункты (риски,
 * сильнейший рычаг, смена вывода по горизонту, порог зарплаты) и обязательная оговорка
 * «предварительная оценка» в выделенном блоке.
 */
export function Conclusion({
  conclusion,
}: {
  conclusion: ConclusionData;
  /** Для единообразия с отчётом: элементов управления здесь нет, вид не меняется. */
  print?: boolean;
}) {
  return (
    <section aria-label="Вывод по проекту" className="flex flex-col gap-3">
      <h3 className="text-base font-semibold">{conclusion.headline}</h3>
      {conclusion.bullets.length > 0 && (
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
          {conclusion.bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      )}
      <p role="note" className="rounded-md border border-caution/40 bg-caution/10 px-3 py-2 text-sm">
        {conclusion.disclaimer}
      </p>
    </section>
  );
}
