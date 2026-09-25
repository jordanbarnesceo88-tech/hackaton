import Link from "next/link";
import { auth } from "@/auth";
import { logoutAction } from "@/lib/auth/actions";
import { isAdminSession } from "@/lib/auth/guards";

/**
 * Шапка сайта. Название ведёт на главную; навигация — по пути жюри (ТЗ §5.4): «Проекты»
 * (после входа), «Каталог», «Методика», «API» и «Админка» для администратора (ТЗ §3.1.1).
 * Прежняя модель v1 («Мои расчёты») из шапки убрана — она доступна со страницы «Проекты».
 *
 * «Админка» видна, только если роль ADMIN и в токене, и в базе: токен-«администратор» без
 * подтверждения базой (роль понизили) ссылки не видит, а для остальных пользователей запроса
 * к базе нет вовсе. isAdminSession не роняет шапку при ошибке базы — ссылка просто скрыта.
 *
 * Тексты ссылок не содержат строк, которые e2e-тесты ищут на страницах («Рассчитать», «Далее»,
 * «Откуда цифры»), и в шапке нет h1 — заголовок первого уровня у каждой страницы свой.
 */
export async function SiteHeader() {
  const session = await auth();
  const showAdmin = session?.user?.role === "ADMIN" && (await isAdminSession());
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-4 py-3 text-sm no-print sm:px-6">
      <Link href="/" className="tap-target mr-4 min-w-0 truncate font-semibold text-primary">
        Платформа оценки роботизации
      </Link>
      <nav aria-label="Основная навигация" className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
        {session?.user && (
          <Link href="/projects" className="tap-target shrink-0 underline">
            Проекты
          </Link>
        )}
        <Link href="/catalog" className="tap-target shrink-0 underline">
          Каталог
        </Link>
        <Link href="/methodology/tz" className="tap-target shrink-0 underline">
          Методика
        </Link>
        <Link href="/api-docs" className="tap-target shrink-0 underline">
          API
        </Link>
        {showAdmin && (
          <Link href="/admin" className="tap-target shrink-0 underline">
            Админка
          </Link>
        )}
        {session?.user ? (
          <>
            {/* The email is the only unbounded string in the header. Left to grow it pushed the
                nav past the viewport on a phone — 146px of horizontal scroll on every page, on
                all three engines, which also breaks WCAG 2.2 SC 1.4.10 (Reflow). Hidden on the
                narrowest screens, truncated above that. */}
            <span className="hidden min-w-0 truncate text-muted-foreground sm:inline sm:max-w-[16rem]">
              {session.user.email}
            </span>
            <form action={logoutAction} className="shrink-0">
              <button type="submit" className="tap-target underline">
                Выйти
              </button>
            </form>
          </>
        ) : (
          <>
            <Link href="/login" className="tap-target underline">
              Войти
            </Link>
            <Link href="/signup" className="tap-target underline">
              Регистрация
            </Link>
          </>
        )}
      </nav>
    </header>
  );
}
