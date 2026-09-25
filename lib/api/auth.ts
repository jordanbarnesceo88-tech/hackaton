import { createHash, timingSafeEqual } from "node:crypto";
import { getAdminUser, getSessionUser } from "@/lib/auth/guards";
import { ADMIN_TOKEN_MIN_LENGTH } from "./auth-constants";

/**
 * Доступ к API v1 (ТЗ §3.1.1 — роли, §3.8 — интеграции, §4.4 — безопасность).
 *
 * Три уровня:
 * - гость — открытые чтения (каталог, нормативы, параметры) и демо-расчёт без сохранения;
 * - пользователь — сессия Auth.js (cookie после входа на сайте): создание и чтение своих
 *   проектов;
 * - администратор — сессия пользователя с ролью ADMIN, роль перечитывается из БД
 *   (getAdminUser, а не токен сессии), ИЛИ заголовок `Authorization: Bearer <ADMIN_API_TOKEN>`
 *   для серверных интеграций (WMS/ERP/1С, выгрузки ФЦ БАС), у которых нет браузерной сессии.
 *
 * Токен администратора задаётся переменной окружения ADMIN_API_TOKEN. Не задан или короче
 * ADMIN_TOKEN_MIN_LENGTH символов — вход по токену выключен целиком: пустая строка или «123»
 * не должны открывать запись в каталог. Сравнение — в постоянном времени: оба значения
 * хэшируются SHA-256 и сравниваются timingSafeEqual, так что ни содержимое, ни длина токена не
 * утекают через время ответа.
 */

export { ADMIN_TOKEN_MIN_LENGTH };

/** Администратор API: по сессии (есть пользователь для журнала) или по токену (пользователя нет). */
export type ApiAdmin =
  | { via: "session"; userId: string; email: string | null }
  | { via: "bearer"; userId: null; email: null };

/** Итог проверки администратора: доступ или отказ со статусом и сообщением по-русски. */
export type ApiAdminCheck = { ok: true; admin: ApiAdmin } | { ok: false; status: 401 | 403; error: string };

/**
 * Токен из заголовка Authorization вида «Bearer <токен>» (схема без учёта регистра, RFC 6750).
 * null — заголовок другой схемы или без токена.
 */
export function bearerToken(header: string | null | undefined): string | null {
  if (typeof header !== "string") return null;
  const m = /^\s*bearer\s+(\S+)\s*$/i.exec(header);
  return m?.[1] ?? null;
}

/**
 * Ожидаемый токен из окружения; null — вход по токену выключен (переменная не задана, пустая
 * или короче ADMIN_TOKEN_MIN_LENGTH).
 */
export function adminTokenFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): string | null {
  const raw = env.ADMIN_API_TOKEN;
  if (typeof raw !== "string") return null;
  const token = raw.trim();
  return token.length >= ADMIN_TOKEN_MIN_LENGTH ? token : null;
}

/** Совпадает ли предъявленный токен с ожидаемым; время сравнения не зависит от содержимого. */
export function tokenMatches(presented: string, expected: string): boolean {
  const a = createHash("sha256").update(presented, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  // Равенство хэшей при разных строках невозможно на практике, но проверка длины строк после
  // сравнения в постоянном времени ничего не выдаёт и отсекает этот случай формально.
  return timingSafeEqual(a, b) && presented.length === expected.length;
}

/** Сообщения отказа — одно место для обработчиков, документации и тестов. */
export const API_AUTH_MESSAGES = {
  badHeader: "Заголовок Authorization должен иметь вид «Bearer <токен>»",
  bearerDisabled:
    `Вход по токену выключен: на сервере не задан ADMIN_API_TOKEN (не короче ${ADMIN_TOKEN_MIN_LENGTH} символов). ` +
    "Войдите на сайте под администратором или попросите администратора сервера задать токен",
  badToken: "Неверный токен администратора — проверьте значение ADMIN_API_TOKEN",
  adminRequired:
    "Нужен доступ администратора: войдите на сайте под администратором или передайте заголовок Authorization: Bearer <ADMIN_API_TOKEN>",
  notAdmin: "Недостаточно прав: действие доступно только администратору",
  userRequired: "Войдите на сайте — действие доступно после входа (cookie сессии)",
} as const;

/**
 * Проверка администратора API. Заголовок Authorization, если он есть, решает всё: неверный
 * токен — 401, без запасного пути через сессию (иначе ошибка интеграции пряталась бы за чужой
 * сессией). Без заголовка — сессия с ролью ADMIN из БД: гость — 401, пользователь без роли —
 * 403. Ошибку базы пропускает наружу: обработчик отвечает 503.
 */
export async function checkApiAdmin(req: Request): Promise<ApiAdminCheck> {
  const header = req.headers.get("authorization");
  if (header !== null && header.trim() !== "") {
    const presented = bearerToken(header);
    if (presented === null) return { ok: false, status: 401, error: API_AUTH_MESSAGES.badHeader };
    const expected = adminTokenFromEnv();
    if (expected === null) return { ok: false, status: 401, error: API_AUTH_MESSAGES.bearerDisabled };
    if (!tokenMatches(presented, expected)) return { ok: false, status: 401, error: API_AUTH_MESSAGES.badToken };
    return { ok: true, admin: { via: "bearer", userId: null, email: null } };
  }
  const user = await getSessionUser();
  if (!user) return { ok: false, status: 401, error: API_AUTH_MESSAGES.adminRequired };
  const admin = await getAdminUser();
  if (!admin) return { ok: false, status: 403, error: API_AUTH_MESSAGES.notAdmin };
  return { ok: true, admin: { via: "session", userId: admin.userId, email: admin.email } };
}

/** Администратор API или null (без объяснения причины). */
export async function apiAdmin(req: Request): Promise<ApiAdmin | null> {
  const res = await checkApiAdmin(req);
  return res.ok ? res.admin : null;
}

/** Id вошедшего пользователя (сессия Auth.js) или null. Роль не важна: проекты есть у всех. */
export async function apiUser(): Promise<string | null> {
  const user = await getSessionUser();
  return user?.userId ?? null;
}
