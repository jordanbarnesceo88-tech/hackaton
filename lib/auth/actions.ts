"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/client";
import { hashPassword } from "@/lib/auth/password";
import { signIn, signOut } from "@/auth";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export type SignUpState = { error: string | null };

export async function signUpAction(
  _prev: SignUpState,
  formData: FormData
): Promise<SignUpState> {
  const email = String(formData.get("email") ?? "").toLowerCase().trim();
  const password = String(formData.get("password") ?? "");
  const name = String(formData.get("name") ?? "").trim() || null;

  if (!EMAIL_RE.test(email)) return { error: "Некорректный email" };
  if (password.length < 8) return { error: "Пароль должен быть не короче 8 символов" };

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return { error: "Пользователь с таким email уже существует" };

  const passwordHash = await hashPassword(password);
  await prisma.user.create({ data: { email, passwordHash, name } });
  // signIn throws a redirect on success.
  await signIn("credentials", { email, password, redirectTo: "/" });
  return { error: null };
}

export async function logoutAction(): Promise<void> {
  await signOut({ redirectTo: "/" });
}
