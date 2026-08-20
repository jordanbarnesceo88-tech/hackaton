import Link from "next/link";
import { auth } from "@/auth";
import { logoutAction } from "@/lib/auth/actions";

export async function SiteHeader() {
  const session = await auth();
  return (
    <header className="flex items-center justify-between border-b px-6 py-3 text-sm">
      <Link href="/onboarding" className="font-semibold">Платформа оценки роботизации</Link>
      <nav className="flex items-center gap-4">
        {session?.user ? (
          <>
            <Link href="/analyses" className="underline">Мои расчёты</Link>
            <span className="text-muted-foreground">{session.user.email}</span>
            <form action={logoutAction}>
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
