"use client";

import Link from "next/link";
import { useActionState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { signUpAction, type SignUpState } from "@/lib/auth/actions";

const initial: SignUpState = { error: null };

export default function SignupPage() {
  const [state, action, pending] = useActionState(signUpAction, initial);
  return (
    <div className="mx-auto flex max-w-sm flex-col gap-4 py-16">
      <h1>Регистрация</h1>
      {/* The signup error arrives via useActionState — no navigation, so it needs announcing.
          role="alert" (assertive) rather than status: the submission failed and the user is
          about to retry. */}
      <p role="alert" aria-live="assertive" className="text-sm text-destructive">
        {state.error}
      </p>
      <form action={action} className="flex flex-col gap-3">
        {/* Visible labels, not placeholders — see the note in the login page. */}
        <label htmlFor="name" className="text-sm font-medium">Имя (необязательно)</label>
        <input id="name" name="name" type="text" autoComplete="name"
          className="field field--lg" />
        <label htmlFor="email" className="text-sm font-medium">Email</label>
        <input id="email" name="email" type="email" required autoComplete="email"
          className="field field--lg" />
        <label htmlFor="password" className="text-sm font-medium">Пароль</label>
        <input id="password" name="password" type="password" required minLength={8}
          autoComplete="new-password" aria-describedby="password-hint"
          className="field field--lg" />
        <p id="password-hint" className="-mt-2 text-xs text-muted-foreground">
          Минимум 8 символов
        </p>
        <button type="submit" disabled={pending} className={buttonVariants({ size: "lg" })}>
          Зарегистрироваться
        </button>
      </form>
      <p className="text-sm text-muted-foreground">
        Уже есть аккаунт? <Link href="/login" className="tap-target underline">Войти</Link>
      </p>
    </div>
  );
}
