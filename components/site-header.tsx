import Link from "next/link";
import { BookOpen, Bot, Code2, FolderKanban, LogIn, Package, Shield, UserPlus } from "lucide-react";
import { auth } from "@/auth";
import { logoutAction } from "@/lib/auth/actions";
import { isAdminSession } from "@/lib/auth/guards";
import { cn } from "@/lib/utils";

/**
 * Шапка сайта — верхняя панель (не боковая: пробовали rail в этой ветке, владелец решил
 * вернуть верх после примерки — [Image #3], реальный скриншот клиентского интерфейса BCB).
 * Стиль оттуда: тёмная панель НЕЗАВИСИМО от темы остальной страницы (`className="dark"` —
 * задаёт --background/--card и т.д. только внутри этой поддерева, приложение вокруг остаётся
 * на теме пользователя), вкладки «иконка + подпись», двустрочные блоки (жирная строка +
 * подпись помельче) для бренда и пользователя.
 *
 * Не скопировано буквально: в референсе есть живой объект («БЦ «Меридиан», 2 этажа...»),
 * часы, плеер имитации (▶ ×1 ×4 ×16) — это данные диспетчерской BCB для КОНКРЕТНОГО объекта
 * под наблюдением, а не что-то, что есть в этом приложении на уровне шапки. Рисовать их здесь
 * означало бы шапку с элементами управления, которые ничего не делают, — нечестный интерфейс.
 * Перенесён язык (тёмная панель, вкладки-таблетки, двустрочные блоки), не конкретные виджеты.
 *
 * Навигация — по пути жюри (ТЗ §5.4): «Проекты» (после входа), «Каталог», «Методика», «API» и
 * «Админка» для администратора (ТЗ §3.1.1). «Админка» видна, только если роль ADMIN и в
 * токене, и в базе — как и раньше.
 *
 * Активная вкладка не подсвечивается: серверный компонент без доступа к текущему пути (как и
 * в прежних версиях шапки/рейла) — тот же задокументированный, не новый пробел.
 */
const TAB_CLASS =
  "tap-target flex shrink-0 items-center gap-2 rounded-md px-3 py-[9px] text-sm font-medium text-foreground/80 transition-colors hover:bg-muted hover:text-foreground";

export async function SiteHeader() {
  const session = await auth();
  const showAdmin = session?.user?.role === "ADMIN" && (await isAdminSession());
  const roleLabel = session?.user?.role === "ADMIN" ? "Администратор" : "Пользователь";
  const initial = session?.user?.email?.trim()?.[0]?.toUpperCase() ?? "?";

  return (
    <header
      className={cn(
        // dark: форсирует тёмную панель поверх любой темы страницы — см. комментарий выше.
        // glass + sticky: та же поверхность, что у рейла/step-nav, не с нуля.
        "dark glass sticky top-0 z-20 flex flex-wrap items-center gap-x-[22px] gap-y-2",
        "min-h-[60px] border-b border-border bg-background px-4 py-2 text-sm no-print sm:px-[22px]",
      )}
    >
      <Link href="/" className="tap-target mr-2 flex shrink-0 items-center gap-2.5 text-foreground">
        <Bot size={24} aria-hidden={true} className="shrink-0 text-primary" />
        <span className="flex flex-col leading-tight">
          <span className="font-semibold">Платформа оценки роботизации</span>
          <span className="text-[11px] tracking-wide text-muted-foreground uppercase">
            Роботизация и экономика
          </span>
        </span>
      </Link>

      <nav aria-label="Основная навигация" className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        {session?.user && (
          <Link href="/projects" className={TAB_CLASS}>
            <FolderKanban size={16} aria-hidden={true} />
            Проекты
          </Link>
        )}
        <Link href="/catalog" className={TAB_CLASS}>
          <Package size={16} aria-hidden={true} />
          Каталог
        </Link>
        <Link href="/methodology/tz" className={TAB_CLASS}>
          <BookOpen size={16} aria-hidden={true} />
          Методика
        </Link>
        <Link href="/api-docs" className={TAB_CLASS}>
          <Code2 size={16} aria-hidden={true} />
          API
        </Link>
        {showAdmin && (
          <Link href="/admin" className={TAB_CLASS}>
            <Shield size={16} aria-hidden={true} />
            Админка
          </Link>
        )}
      </nav>

      {session?.user ? (
        // user-chip: пилюля-бордер, круглый аватар-инициал, двустрочный блок (почта / роль) —
        // тот же язык, что у «БЦ «Меридиан»» / «Олег Руденко · Клиент» в референсе.
        <span className="chip shrink-0 gap-2.5 py-1 pr-2 pl-1.5">
          <span
            aria-hidden="true"
            className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground"
          >
            {initial}
          </span>
          <span className="hidden min-w-0 flex-col leading-tight sm:flex">
            <span className="max-w-[14rem] truncate text-xs font-medium text-foreground">
              {session.user.email}
            </span>
            <span className="text-[11px] text-muted-foreground">{roleLabel}</span>
          </span>
          <form action={logoutAction} className="shrink-0">
            <button type="submit" className="tap-target text-xs underline">
              Выйти
            </button>
          </form>
        </span>
      ) : (
        <div className="flex shrink-0 items-center gap-1">
          <Link href="/login" className={TAB_CLASS}>
            <LogIn size={16} aria-hidden={true} />
            Войти
          </Link>
          <Link href="/signup" className={TAB_CLASS}>
            <UserPlus size={16} aria-hidden={true} />
            Регистрация
          </Link>
        </div>
      )}
    </header>
  );
}
