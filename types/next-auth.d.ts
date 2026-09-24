import type { DefaultSession } from "next-auth";

// Роль пользователя по ТЗ §3.1.1. Гость — это отсутствие сессии, поэтому ролей в сессии две.
// Литералы повторяют перечисление `Role` в prisma/schema.prisma. lib/auth/guards.ts на этапе
// компиляции проверяет, что каждое значение Role из схемы допустимо здесь.

declare module "next-auth" {
  interface Session {
    // role в сессии есть всегда: колбэк session в auth.ts подставляет USER, если в токене её нет.
    user: { id: string; role: "USER" | "ADMIN" } & DefaultSession["user"];
  }
  // Что возвращает authorize в auth.ts. Необязательно, потому что тот же тип описывает и
  // пользователя других провайдеров Auth.js.
  interface User {
    role?: "USER" | "ADMIN";
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    id?: string;
    role?: "USER" | "ADMIN";
  }
}
