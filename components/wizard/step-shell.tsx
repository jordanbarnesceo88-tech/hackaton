"use client";

import Link from "next/link";

/**
 * Общая рамка шага: вопрос как заголовок, содержимое, «Далее».
 *
 * Вопрос набран заголовком, а не подписью над полем — в этом половина разницы между формой и
 * опросом. Подсказка про Enter показывается, только когда переход возможен: обещание, которое
 * не сработает, хуже отсутствующего.
 */
export function StepShell({
  question,
  hint,
  children,
  nextHref,
  nextLabel = "Далее",
}: {
  question: string;
  hint?: string;
  children: React.ReactNode;
  nextHref: string | null;
  nextLabel?: string;
}) {
  return (
    <div className="surface-prose flex flex-col gap-6 py-12">
      <div className="flex flex-col gap-2">
        <h1>{question}</h1>
        {hint && <p className="text-muted-foreground">{hint}</p>}
      </div>

      {children}

      <div className="flex items-center gap-3">
        {nextHref ? (
          <Link
            href={nextHref}
            className="rounded-md bg-primary px-6 py-3 font-medium text-primary-foreground
              transition-opacity hover:opacity-90
              focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {nextLabel}
          </Link>
        ) : (
          <span
            aria-disabled="true"
            className="cursor-not-allowed rounded-md bg-muted px-6 py-3 font-medium text-muted-foreground"
          >
            {nextLabel}
          </span>
        )}
        {nextHref && (
          <span className="text-sm text-muted-foreground">нажмите Enter ↵</span>
        )}
      </div>
    </div>
  );
}
