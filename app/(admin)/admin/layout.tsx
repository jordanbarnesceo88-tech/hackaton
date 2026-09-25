import type { ReactNode } from "react";
import { connection } from "next/server";
import { AdminNav } from "@/components/admin/admin-nav";
import { requireAdmin } from "@/lib/auth/guards";

/**
 * Раздел администратора (ТЗ §3.1.1, §3.1.4, §3.3.5). Проверка роли здесь — оптимистичная:
 * layout не перерисовывается при переходах и не защищает серверные действия, поэтому
 * requireAdmin() повторяется в каждой странице и в каждом действии lib/admin/actions.ts.
 * Роль перечитывается из базы: гость уходит на /login, пользователь без роли ADMIN видит 404.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  await connection();
  await requireAdmin();
  return (
    <div className="surface-data flex flex-col gap-6 py-8">
      <AdminNav />
      {children}
    </div>
  );
}
