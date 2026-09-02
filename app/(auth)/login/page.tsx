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
      <h1 className="text-2xl font-semibold">Вход</h1>
      {error && <p className="text-sm text-destructive">Неверный email или пароль</p>}
      <form action={login} className="flex flex-col gap-3">
        <input name="email" type="email" required placeholder="Email"
          className="rounded-md border px-3 py-2 text-sm" />
        <input name="password" type="password" required placeholder="Пароль"
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
