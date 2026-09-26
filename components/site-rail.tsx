import Link from "next/link";
import { Bot, BookOpen, Code2, FolderKanban, LogIn, Package, Shield, UserPlus } from "lucide-react";
import { auth } from "@/auth";
import { logoutAction } from "@/lib/auth/actions";
import { isAdminSession } from "@/lib/auth/guards";
import { RailNav, type RailNavItem } from "@/components/rail-nav";

/**
 * Боковая панель сайта (заменяет прежнюю верхнюю шапку site-header.tsx — по образцу rail в
 * BCB_Platform_demo.html: навигация слева, а не сверху). Сессия и роль читаются здесь, на
 * сервере; сворачивание в иконки — в клиентском RailNav (components/rail-nav.tsx), потому что
 * это состояние живёт только в браузере.
 *
 * Ссылки — по пути жюри (ТЗ §5.4): «Проекты» (после входа), «Каталог», «Методика», «API» и
 * «Админка» для администратора (ТЗ §3.1.1). «Админка» видна, только если роль ADMIN и в
 * токене, и в базе: токен-«администратор» без подтверждения базой (роль понизили) ссылки не
 * видит, а для остальных пользователей запроса к базе нет вовсе. isAdminSession не роняет
 * панель при ошибке базы — ссылка просто скрыта.
 *
 * Тексты ссылок не содержат строк, которые e2e-тесты ищут на страницах («Рассчитать», «Далее»,
 * «Откуда цифры»), и в панели нет h1 — заголовок первого уровня у каждой страницы свой.
 */
export async function SiteRail() {
  const session = await auth();
  const showAdmin = session?.user?.role === "ADMIN" && (await isAdminSession());
  const initial = session?.user?.email?.trim()?.[0]?.toUpperCase() ?? "?";

  // icon: рендерённый элемент (<FolderKanban .../>), не ссылка на компонент — см. комментарий
  // к RailNavItem в rail-nav.tsx про то, почему функция здесь роняет страницу в проде.
  const iconProps = { size: 18, "aria-hidden": true as const };
  const items: RailNavItem[] = [
    ...(session?.user
      ? [{ href: "/projects", label: "Проекты", icon: <FolderKanban {...iconProps} /> }]
      : []),
    { href: "/catalog", label: "Каталог", icon: <Package {...iconProps} /> },
    { href: "/methodology/tz", label: "Методика", icon: <BookOpen {...iconProps} /> },
    { href: "/api-docs", label: "API", icon: <Code2 {...iconProps} /> },
    ...(showAdmin ? [{ href: "/admin", label: "Админка", icon: <Shield {...iconProps} /> }] : []),
  ];

  return (
    <RailNav
      items={items}
      header={
        <Link
          href="/"
          className="tap-target flex items-center gap-3 border-b border-border px-2.5 py-3 font-semibold text-primary"
        >
          <Bot size={22} aria-hidden={true} className="shrink-0" />
          <span className="hidden truncate md:inline">Платформа оценки роботизации</span>
        </Link>
      }
      footer={
        session?.user ? (
          <div className="mb-1 flex items-center gap-2 px-0.5 py-1">
            <span
              aria-hidden="true"
              className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-medium text-primary-foreground"
            >
              {initial}
            </span>
            {/* Email is the only unbounded string here; hidden with the rest of the labels on a
                collapsed/mobile rail rather than truncated inline, since there's no room for it
                next to the avatar at 56px wide. */}
            <span className="hidden min-w-0 truncate text-xs text-muted-foreground md:inline">
              {session.user.email}
            </span>
            <form action={logoutAction} className="ml-auto hidden shrink-0 md:block">
              <button type="submit" className="tap-target text-xs underline">
                Выйти
              </button>
            </form>
          </div>
        ) : (
          <div className="mb-1 flex flex-col gap-1">
            <Link
              href="/login"
              className="tap-target flex items-center gap-3 rounded-md px-2.5 py-[9px] transition-colors hover:bg-muted"
            >
              <LogIn size={18} aria-hidden={true} />
              <span className="hidden md:inline">Войти</span>
            </Link>
            <Link
              href="/signup"
              className="tap-target flex items-center gap-3 rounded-md px-2.5 py-[9px] transition-colors hover:bg-muted"
            >
              <UserPlus size={18} aria-hidden={true} />
              <span className="hidden md:inline">Регистрация</span>
            </Link>
          </div>
        )
      }
    />
  );
}
