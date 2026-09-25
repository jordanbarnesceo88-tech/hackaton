/**
 * Состояние загрузки рабочей области проекта (ТЗ §4.3.3: расчёт с видимым статусом). Пока
 * сервер читает проект и воспроизводит расчёт из снимка, вместо пустого экрана — строка
 * состояния для глаз и для скринридера.
 */
export default function ProjectLoading() {
  return (
    <div className="surface-data flex flex-col gap-4 py-8">
      <p role="status" aria-live="polite" className="flex items-center gap-3 text-sm text-muted-foreground">
        <span
          aria-hidden="true"
          className="inline-block size-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-primary motion-reduce:animate-none"
        />
        Загружаем проект…
      </p>
      <div aria-hidden="true" className="flex flex-col gap-3">
        <div className="h-9 w-2/3 rounded-md bg-muted" />
        <div className="h-10 w-full rounded-md bg-muted/70" />
        <div className="h-64 w-full rounded-md bg-muted/50" />
      </div>
    </div>
  );
}
