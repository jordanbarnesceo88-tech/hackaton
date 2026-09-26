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
// .tab — BCB's nav-item chrome (padding 9px 12px, 10px radius, hover fill). No persistent
// "active" state: SiteHeader is a server component with no route-aware context available from
// the root layout, so highlighting the current section would need pathname threading from
// every page — a bigger change than this pass covers; hover/focus states are real, selection
// isn't.
const TAB_CLASS =
  "tap-target shrink-0 rounded-md px-3 py-[9px] transition-colors hover:bg-muted hover:text-foreground";

export async function SiteHeader() {
  const session = await auth();
  const showAdmin = session?.user?.role === "ADMIN" && (await isAdminSession());
  // Первая буква — заглушка аватара, как в user-chip BCB, а не первая непустая логика проекта:
  // ничего похожего на аватар пользователь пока не загружает.
  const initial = session?.user?.email?.trim()?.[0]?.toUpperCase() ?? "?";
  return (
    // min-h вместо фиксированной h-[60px] (BCB --bar-h): 60px — бюджет для одной строки
    // навигации на десктопе, но эта шапка переносится на телефоне (flex-wrap), а
    // фиксированная высота обрезала бы вторую строку.
    // glass (BCB .bar/.maptools treatment) + sticky: the shell now actually has something to
    // show through it. Previously .glass existed in app/globals.css but nothing referenced it.
    <header className="glass sticky top-0 z-10 flex flex-wrap items-center justify-between gap-x-[22px] gap-y-2 min-h-[60px] border-b border-border px-4 py-2 text-sm no-print sm:px-[22px]">
      <Link href="/" className="tap-target mr-4 min-w-0 truncate font-semibold text-primary">
        Платформа оценки роботизации
      </Link>
      <nav aria-label="Основная навигация" className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1">
        {session?.user && (
          <Link href="/projects" className={TAB_CLASS}>
            Проекты
          </Link>
        )}
        <Link href="/catalog" className={TAB_CLASS}>
          Каталог
        </Link>
        <Link href="/methodology/tz" className={TAB_CLASS}>
          Методика
        </Link>
        <Link href="/api-docs" className={TAB_CLASS}>
          API
        </Link>
        {showAdmin && (
          <Link href="/admin" className={TAB_CLASS}>
            Админка
          </Link>
        )}
        {session?.user ? (
          // user-chip (BCB): пилюля с бордером, круглый аватар-заглушка, почта, выход.
          <span className="chip ml-1 gap-2 py-1 pr-1.5 pl-1.5">
            <span
              aria-hidden="true"
              className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-medium text-primary-foreground"
            >
              {initial}
            </span>
            {/* The email is the only unbounded string in the header. Left to grow it pushed the
                nav past the viewport on a phone — 146px of horizontal scroll on every page, on
                all three engines, which also breaks WCAG 2.2 SC 1.4.10 (Reflow). Hidden on the
                narrowest screens, truncated above that. */}
            <span className="hidden min-w-0 truncate sm:inline sm:max-w-[16rem]">
              {session.user.email}
            </span>
            <form action={logoutAction} className="shrink-0">
              <button type="submit" className="tap-target underline">
                Выйти
              </button>
            </form>
          </span>
        ) : (
          <>
            <Link href="/login" className={TAB_CLASS}>
              Войти
            </Link>
            <Link href="/signup" className={TAB_CLASS}>
              Регистрация
            </Link>
          </>
        )}
      </nav>
    </header>
  );
}
