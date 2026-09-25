import type { PrismaClient, Role } from "@prisma/client";
import { changedTotal, formatSyncReport, syncOrganizerData } from "../lib/catalog/sync";
import { MAX_PASSWORD_BYTES, hashPassword, passwordByteLength, verifyPassword } from "../lib/auth/password";
import { seedDemoProject } from "./seed-demo";

/**
 * Сев слоя модели по методике ТЗ (tz-1.0.0). Вызывается из scripts/seed.ts после сева
 * прежней модели (v1): таксономия v1 заводит типы объектов, к которым здесь привязываются
 * процессы и параметры.
 *
 * 1. Данные организатора — `syncOrganizerData` (lib/catalog/sync.ts): типы решений, процессы,
 *    параметры объектов, нормативы, каталог продуктов, выпуск данных. Правки администратора
 *    сохраняются.
 * 2. Демо-аккаунты (ТЗ §8.2.5): demo@demo.local — пользователь, admin@demo.local —
 *    администратор. Пароли — из DEMO_USER_PASSWORD / DEMO_ADMIN_PASSWORD; если переменная не
 *    задана или пуста, берётся пароль по умолчанию из README (demo-user-2026 / demo-admin-2026).
 *    На стенде, доступном извне, пароли нужно задать свои.
 * 3. Демо-проект склада — `seedDemoProject` (реализуется в T3.6).
 *
 * Повторный сев ничего не меняет: синхронизация пишет только отличия, а пароль демо-аккаунта
 * перехэшируется, только если текущий хэш не подходит к паролю (bcrypt солит каждый хэш, и
 * безусловная запись меняла бы строку при каждом прогоне).
 *
 * Импорты относительные: сев идёт через tsx, где алиас «@/» не нужен.
 */

type DemoAccount = {
  email: string;
  name: string;
  role: Role;
  roleLabel: string;
  passwordEnv: "DEMO_USER_PASSWORD" | "DEMO_ADMIN_PASSWORD";
  defaultPassword: string;
};

/** Демо-аккаунты по ТЗ §8.2.5 — те же адреса и пароли, что в README, .env.example и compose. */
export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  {
    email: "demo@demo.local",
    name: "Демо-пользователь",
    role: "USER",
    roleLabel: "пользователь",
    passwordEnv: "DEMO_USER_PASSWORD",
    defaultPassword: "demo-user-2026",
  },
  {
    email: "admin@demo.local",
    name: "Демо-администратор",
    role: "ADMIN",
    roleLabel: "администратор",
    passwordEnv: "DEMO_ADMIN_PASSWORD",
    defaultPassword: "demo-admin-2026",
  },
];

/**
 * Пароль демо-аккаунта: из переменной окружения, а если она не задана или состоит из
 * пробелов — по умолчанию. Пароль длиннее 72 байт bcrypt молча обрезал бы, поэтому такой
 * пароль — ошибка сева, а не тихо ослабленный вход.
 */
export function demoPassword(
  account: DemoAccount,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const raw = env[account.passwordEnv];
  const password = raw !== undefined && raw.trim() !== "" ? raw : account.defaultPassword;
  if (passwordByteLength(password) > MAX_PASSWORD_BYTES) {
    throw new Error(
      `${account.passwordEnv}: пароль длиннее ${MAX_PASSWORD_BYTES} байт — bcrypt учёл бы только начало. ` +
        "Задайте пароль короче.",
    );
  }
  return password;
}

type AccountOutcome = "создан" | "обновлён" | "без изменений";

/** Заводит или приводит в порядок один демо-аккаунт: роль и пароль. */
async function upsertDemoAccount(prisma: PrismaClient, account: DemoAccount): Promise<AccountOutcome> {
  const password = demoPassword(account);
  const existing = await prisma.user.findUnique({
    where: { email: account.email },
    select: { id: true, role: true, passwordHash: true },
  });
  if (!existing) {
    await prisma.user.create({
      data: {
        email: account.email,
        name: account.name,
        role: account.role,
        passwordHash: await hashPassword(password),
      },
    });
    return "создан";
  }
  const passwordOk = await verifyPassword(password, existing.passwordHash);
  if (passwordOk && existing.role === account.role) return "без изменений";
  await prisma.user.update({
    where: { id: existing.id },
    data: {
      role: account.role,
      ...(passwordOk ? {} : { passwordHash: await hashPassword(password) }),
    },
  });
  return "обновлён";
}

/** Сев слоя модели ТЗ: данные организатора, демо-аккаунты, демо-проект. */
export async function seedV2(prisma: PrismaClient): Promise<void> {
  console.log("Модель по методике ТЗ (tz-1.0.0): синхронизация данных организатора…");
  const report = await syncOrganizerData(prisma, { respectAdminEdits: true });
  for (const line of formatSyncReport(report)) console.log(`  ${line}`);

  let accountsChanged = 0;
  for (const account of DEMO_ACCOUNTS) {
    const outcome = await upsertDemoAccount(prisma, account);
    if (outcome !== "без изменений") accountsChanged++;
    console.log(`  Демо-аккаунт ${account.email} (${account.roleLabel}): ${outcome}`);
  }

  await seedDemoProject(prisma);

  const total = changedTotal(report) + accountsChanged;
  console.log(
    total === 0
      ? "  Итог слоя модели ТЗ: изменений нет."
      : `  Итог слоя модели ТЗ: изменено записей — ${total}.`,
  );

  // Продукт, который не удалось записать, — не повод молча продолжать: каталог неполон,
  // и подбор на показе отличался бы от данных организатора. Отчёт уже напечатан выше.
  if (report.products.failed > 0) {
    throw new Error(`Синхронизация не записала продуктов: ${report.products.failed} (причины — в отчёте выше)`);
  }
}
