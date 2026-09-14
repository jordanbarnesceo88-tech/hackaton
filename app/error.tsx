"use client";

import Link from "next/link";

/**
 * Граница ошибки верхнего уровня. Без неё необработанное исключение — например, недоступный
 * Postgres на любом запросе из lib/db/queries.ts — показывало английское «Application error»
 * без пути назад и без возможности повторить.
 *
 * Текст ошибки наружу не выводится: в сообщении Prisma встречается строка подключения.
 * `digest` показан намеренно — это единственное, что человек может назвать в обращении,
 * и по нему запись находится в логах сервера.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="surface-prose flex flex-col gap-6 py-16">
      <h1>Что-то сломалось</h1>
      <p className="text-muted-foreground">
        Страница не открылась. Расчёты и сохранённые данные при этом не пострадали — попробуйте
        ещё раз, а если повторится, откройте главную и начните заново.
      </p>
      {error.digest ? (
        <p className="text-muted-foreground font-mono text-sm">Код обращения: {error.digest}</p>
      ) : null}
      <div className="flex flex-wrap gap-4">
        <button type="button" onClick={reset} className="underline underline-offset-4">
          Попробовать ещё раз
        </button>
        <Link href="/" className="underline underline-offset-4">
          На главную
        </Link>
      </div>
    </div>
  );
}
