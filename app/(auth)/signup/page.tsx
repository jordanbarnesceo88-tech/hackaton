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
        {/* Visible labels, not placeholders — see the note in the login page. */}
        <label htmlFor="name" className="text-sm font-medium">Имя (необязательно)</label>
        <input id="name" name="name" type="text" autoComplete="name"
          className="rounded-md border px-3 py-2 text-sm" />
        <label htmlFor="email" className="text-sm font-medium">Email</label>
        <input id="email" name="email" type="email" required autoComplete="email"
          className="rounded-md border px-3 py-2 text-sm" />
        <label htmlFor="password" className="text-sm font-medium">Пароль</label>
        <input id="password" name="password" type="password" required minLength={8}
          autoComplete="new-password" aria-describedby="password-hint"
          className="rounded-md border px-3 py-2 text-sm" />
        <p id="password-hint" className="-mt-2 text-xs text-muted-foreground">
          Минимум 8 символов
        </p>
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
