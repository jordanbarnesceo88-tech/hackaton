"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signUpAction, type SignUpState } from "@/lib/auth/actions";

const initial: SignUpState = { error: null };

export default function SignupPage() {
  const [state, action, pending] = useActionState(signUpAction, initial);
  return (
    <div className="mx-auto flex max-w-sm flex-col gap-4 py-16">
      <h1 className="text-2xl font-semibold">Регистрация</h1>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <form action={action} className="flex flex-col gap-3">
        <input name="name" type="text" placeholder="Имя (необязательно)"
          className="rounded-md border px-3 py-2 text-sm" />
        <input name="email" type="email" required placeholder="Email"
          className="rounded-md border px-3 py-2 text-sm" />
        <input name="password" type="password" required placeholder="Пароль (мин. 8 символов)"
          className="rounded-md border px-3 py-2 text-sm" />
        <button type="submit" disabled={pending}
          className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50">
          Зарегистрироваться
        </button>
      </form>
      <p className="text-sm text-muted-foreground">
        Уже есть аккаунт? <Link href="/login" className="underline">Войти</Link>
      </p>
    </div>
  );
}
