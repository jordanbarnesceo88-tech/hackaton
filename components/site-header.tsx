import Link from "next/link";
import { auth } from "@/auth";
import { logoutAction } from "@/lib/auth/actions";

export async function SiteHeader() {
  const session = await auth();
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-4 py-3 text-sm no-print sm:px-6">
      <Link href="/onboarding" className="mr-4 min-w-0 truncate font-semibold text-primary">
          Платформа оценки роботизации
        </Link>
      <nav className="flex min-w-0 items-center gap-4">
        {session?.user ? (
          <>
            <Link href="/analyses" className="shrink-0 underline">Мои расчёты</Link>
            {/* The email is the only unbounded string in the header. Left to grow it pushed the
                nav past the viewport on a phone — 146px of horizontal scroll on every page, on
                all three engines, which also breaks WCAG 2.2 SC 1.4.10 (Reflow). Hidden on the
                narrowest screens, truncated above that. */}
            <span className="hidden min-w-0 truncate text-muted-foreground sm:inline sm:max-w-[16rem]">
              {session.user.email}
            </span>
            <form action={logoutAction} className="shrink-0">
              <button type="submit" className="underline">Выйти</button>
            </form>
          </>
        ) : (
          <>
            <Link href="/login" className="underline">Войти</Link>
            <Link href="/signup" className="underline">Регистрация</Link>
          </>
        )}
      </nav>
    </header>
  );
}
