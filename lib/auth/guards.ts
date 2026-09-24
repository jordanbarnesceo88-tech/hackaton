import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import type { Session } from "next-auth";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/client";

/**
 * Охранные функции для ролей ТЗ §3.1.1 (гость / пользователь / администратор) и изоляции
 * данных (§4.4.1, §4.4.2). Паттерн «слой доступа к данным» из документации Next.js
 * (01-app/02-guides/authentication.md): проверка стоит в каждой странице, в каждом серверном
 * действии и в каждом обработчике API, а не в proxy.ts. Серверные действия доступны прямым
 * POST-запросом в обход страниц, поэтому проверка на странице их не защищает.
 *
 * Два уровня доверия:
 * - роль из сессии (JWT) — «оптимистичная». Она записана при входе и живёт до истечения
 *   токена. Годится, чтобы решить, что показать, но не чтобы разрешить действие;
 * - роль из базы — авторитетная. requireAdmin, getAdminUser и isAdminSession перечитывают её
 *   на каждый запрос: администратора, которого понизили, токен не выдаст за администратора.
 *
 * forbidden() и unauthorized() не используются: им нужен experimental.authInterrupts.
 * Гость отправляется на /login, пользователь без прав администратора видит 404 — так
 * адреса админки не подтверждают своё существование обычному пользователю.
 */

/** Роль в сессии. Гость — это отсутствие сессии, поэтому значений два. */
export type UserRole = Session["user"]["role"];

export type SessionUser = {
  userId: string;
  /** Может отсутствовать в токене; authorize в auth.ts всегда кладёт её при входе. */
  email: string | null;
  role: UserRole;
};

export type AdminUser = SessionUser & { role: "ADMIN" };

/**
 * Пользователь из сессии или null, без перенаправления. Роль — из токена (оптимистичная).
 * Для страниц, где гостю показывают другое содержимое, и для обработчиков API.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!session?.user || !userId) return null;
  return {
    userId,
    email: session.user.email ?? null,
    // Токены, выданные до появления ролей, поля role не содержат — это обычный пользователь.
    role: session.user.role === "ADMIN" ? "ADMIN" : "USER",
  };
}

/** Вошедший пользователь; гостя перенаправляет на /login. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * Роль из базы. React cache() держит результат в пределах одного прохода рендера: шапка,
 * layout админки и страница делят один запрос к базе. Вне рендера (серверное действие,
 * обработчик API) cache() просто вызывает функцию.
 * null — пользователя из токена в базе нет (удалён или база пересоздана).
 */
const readDbRole = cache(async (userId: string): Promise<UserRole | null> => {
  const row = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  // Присваивание Role из Prisma в UserRole — проверка на этапе компиляции: новое значение
  // перечисления Role в схеме не пройдёт tsc, пока его не добавят в types/next-auth.d.ts.
  const role: UserRole | null = row ? row.role : null;
  return role;
});

/**
 * Администратор, подтверждённый по базе, или null. Не бросает на «нет прав», но пропускает
 * ошибку базы. Для обработчиков API, которым нужен ответ 401/403, а не страница 404.
 */
export async function getAdminUser(): Promise<AdminUser | null> {
  const user = await getSessionUser();
  if (!user) return null;
  const role = await readDbRole(user.userId);
  return role === "ADMIN" ? { ...user, role: "ADMIN" } : null;
}

/**
 * Администратор; роль перечитывается из базы, токен может быть устаревшим.
 * Гость → /login; пользователь без роли ADMIN (в том числе с ADMIN только в токене) → 404.
 * Вызывается в layout админки, в каждой её странице и в каждом её серверном действии.
 */
export async function requireAdmin(): Promise<AdminUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const role = await readDbRole(user.userId);
  if (role !== "ADMIN") notFound();
  return { ...user, role: "ADMIN" };
}

/**
 * Показывать ли элементы администратора (ссылка «Админка» в шапке). Роль берётся из базы, как в
 * requireAdmin, поэтому ссылка видна ровно тогда, когда /admin откроется. Гость не стоит запроса
 * к базе. Ошибка базы не должна ронять шапку каждой страницы: она пишется в журнал, ответ false.
 */
export async function isAdminSession(): Promise<boolean> {
  try {
    return (await getAdminUser()) !== null;
  } catch (e) {
    console.error("isAdminSession: не удалось прочитать роль из базы", e);
    return false;
  }
}
