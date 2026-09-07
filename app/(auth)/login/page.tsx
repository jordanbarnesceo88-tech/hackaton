import Link from "next/link";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  async function login(formData: FormData) {
    "use server";
    try {
      await signIn("credentials", {
        email: String(formData.get("email") ?? "").toLowerCase().trim(),
        password: String(formData.get("password") ?? ""),
        redirectTo: "/",
      });
    } catch (e) {
      // next-auth throws a redirect on success; re-throw those.
      if (e && typeof e === "object" && "digest" in e && String((e as { digest: string }).digest).startsWith("NEXT_REDIRECT")) {
        throw e;
      }
      redirect("/login?error=1");
    }
  }
  return (
    <div className="mx-auto flex max-w-sm flex-col gap-4 py-16">
      <h1>Вход</h1>
      {error && <p className="text-sm text-destructive">Неверный email или пароль</p>}
      <form action={login} className="flex flex-col gap-3">
        {/* A placeholder is not a label (WCAG 2.2 SC 3.3.2 / 1.3.1): it disappears the moment
            the field has content, and screen readers may not announce it as the field's name. */}
        <label htmlFor="email" className="text-sm font-medium">Email</label>
        <input id="email" name="email" type="email" required autoComplete="email"
          className="rounded-md border px-3 py-2 text-sm" />
        <label htmlFor="password" className="text-sm font-medium">Пароль</label>
        <input id="password" name="password" type="password" required autoComplete="current-password"
          className="rounded-md border px-3 py-2 text-sm" />
        <button type="submit" className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground">
          Войти
        </button>
      </form>
      <p className="text-sm text-muted-foreground">
        Нет аккаунта? <Link href="/signup" className="underline">Регистрация</Link>
      </p>
    </div>
  );
}
