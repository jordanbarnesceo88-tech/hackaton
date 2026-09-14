import Link from "next/link";

export const metadata = { title: "Страница не найдена — Платформа оценки роботизации" };

/**
 * 404 на русском. До неё Next отдавал свою дефолтную страницу — английское
 * «This page could not be found» внутри <html lang="ru">, без единой ссылки назад.
 * Скринридер зачитывал английскую фразу в русском языковом контексте (WCAG 3.1.2).
 *
 * `notFound()` достижим из трёх мест: решения с несуществующим id, типа объекта вне
 * таксономии и чужого сохранённого расчёта, — поэтому ссылок здесь две, а не одна:
 * попавший сюда человек чаще всего шёл либо в каталог, либо к своим расчётам.
 */
export default function NotFound() {
  return (
    <div className="surface-prose flex flex-col gap-6 py-16">
      <h1>Страница не найдена</h1>
      <p className="text-muted-foreground">
        Такой страницы нет. Обычно это значит, что ссылка устарела: решение убрали из каталога,
        расчёт удалили или адрес набран с опечаткой.
      </p>
      <div className="flex flex-wrap gap-4">
        <Link href="/" className="underline underline-offset-4">
          На главную
        </Link>
        <Link href="/analyses" className="underline underline-offset-4">
          Мои расчёты
        </Link>
      </div>
    </div>
  );
}
