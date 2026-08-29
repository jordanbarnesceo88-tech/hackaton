"use server";

import { Prisma } from "@prisma/client";
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
  try {
    await prisma.user.create({ data: { email, passwordHash, name } });
  } catch (e) {
    // Two concurrent signups can both clear the findUnique check above and then race on the
    // `User.email` unique constraint; the loser throws P2002. Map it to the same friendly
    // message instead of surfacing an unhandled 500.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { error: "Пользователь с таким email уже существует" };
    }
    throw e;
  }
  // signIn throws a redirect on success.
  await signIn("credentials", { email, password, redirectTo: "/" });
  return { error: null };
}

export async function logoutAction(): Promise<void> {
  await signOut({ redirectTo: "/" });
}
