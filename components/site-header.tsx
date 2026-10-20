import Link from "next/link";
import { BookOpen, Code2, FolderKanban, LifeBuoy, LogIn, Package, Shield, UserPlus } from "lucide-react";
import { auth } from "@/auth";
import { logoutAction } from "@/lib/auth/actions";
import { isAdminSession } from "@/lib/auth/guards";
import { cn } from "@/lib/utils";
import { AuthHandoffLink } from "./auth-handoff-link";
import { AlfaRobotLogo } from "./brand/alfa-robot-logo";
import { DemoMenu } from "./demo-menu";
import { FleetPlatformAccess } from "./fleet-platform-access";

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
 *
 * Ширины. В один ряд шапка помещается только с xl (1280px): бренд, пять вкладок админа и
 * чип с почтой — ~1140px. Раньше ряд переносился как придётся: на 1024 «Админка» уезжала во
 * вторую строку, на 768 вкладки вставали столбиком, на 390 уходили за правый край экрана.
 * Теперь до xl — два ряда: бренд и вход/пользователь сверху, вкладки отдельной строкой с
 * горизонтальной прокруткой; на телефоне у «Войти»/«Регистрация» остаются значки (подпись —
 * для скринридера). Липкой шапка становится тоже только с xl, где её высота гарантированно
 * 60px: липкие панели ниже (StepNav, панель рабочей области) садятся под неё на top-[60px],
 * а до xl — на top-0, и на телефоне не складываются в две липкие полосы на треть экрана.
 *
 * Бренд (2026-10-20, правки владельца): только логотип «alfa robot», без подписи, светлым
 * цветом из присланных файлов (#D4D1E2, для тёмного фона). Вкладка «Демо» - меню с демо-расчётами
 * и туром, которые раньше были кнопками первого экрана (components/demo-menu.tsx). Справа от
 * вкладок - кнопка «Платформа управления парком роботов» (окно с демо-доступом,
 * components/fleet-platform-access.tsx).
 */
const TAB_CLASS =
  "tap-target flex shrink-0 items-center gap-2 rounded-md px-3 py-[9px] text-sm font-medium text-foreground/80 transition-colors hover:bg-muted hover:text-foreground";

/** Отдельный продукт, не вкладка этого сайта: контур в цвет логотипа, подпись в две строки с md. */
const FLEET_CLASS =
  "tap-target flex shrink-0 cursor-pointer items-center gap-2 rounded-md border border-[#A897FC]/45 px-3 py-[9px] text-xs font-medium text-[#D4D1E2] transition-colors hover:border-[#A897FC] hover:bg-muted hover:text-foreground md:py-1.5";

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
        "dark glass z-20 flex flex-wrap items-center gap-x-2 gap-y-1 xl:sticky xl:top-0 xl:flex-nowrap",
        // xl:py-1.5: кнопка платформы в две строки - 44px; с полями по 8px и рамкой шапка вышла
        // бы 61px, а липкие панели ниже рассчитаны на 60px (top-[60px]).
        "min-h-[60px] border-b border-border bg-background px-3 py-2 text-sm no-print sm:gap-x-[22px] sm:px-[22px] xl:py-1.5",
      )}
    >
      {/* basis-0 + grow до xl: бренд занимает остаток первого ряда и при нехватке места
          сжимается, а не выталкивает вход/пользователя в отдельную строку — flex-wrap
          переносит элемент раньше, чем сжимает. */}
      <Link
        href="/"
        className="tap-target flex min-w-0 flex-1 basis-0 items-center text-foreground xl:mr-2 xl:flex-none xl:basis-auto"
      >
        <AlfaRobotLogo className="h-6 w-auto max-w-full shrink-0 text-[#D4D1E2]" />
      </Link>

      <nav
        aria-label="Основная навигация"
        className="order-last -mx-1 flex w-full min-w-0 items-center gap-1 overflow-x-auto xl:order-none xl:mx-0 xl:w-auto xl:flex-1"
      >
        {session?.user && (
          <Link href="/projects" className={TAB_CLASS}>
            <FolderKanban size={16} aria-hidden={true} />
            Проекты
          </Link>
        )}
        <DemoMenu triggerClassName={TAB_CLASS} />
        <Link href="/catalog" className={TAB_CLASS}>
          <Package size={16} aria-hidden={true} />
          Каталог
        </Link>
        <Link href="/methodology/tz" className={TAB_CLASS}>
          <BookOpen size={16} aria-hidden={true} />
          Методика
        </Link>
        <Link href="/knowledge" className={TAB_CLASS}>
          <LifeBuoy size={16} aria-hidden={true} />
          Внедрение
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

      <FleetPlatformAccess triggerClassName={FLEET_CLASS} />

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
          <AuthHandoffLink href="/login" className={TAB_CLASS}>
            <LogIn size={16} aria-hidden={true} />
            <span className="sr-only sm:not-sr-only">Войти</span>
          </AuthHandoffLink>
          <AuthHandoffLink href="/signup" className={TAB_CLASS}>
            <UserPlus size={16} aria-hidden={true} />
            <span className="sr-only sm:not-sr-only">Регистрация</span>
          </AuthHandoffLink>
        </div>
      )}
    </header>
  );
}
