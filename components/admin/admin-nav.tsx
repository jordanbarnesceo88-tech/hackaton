"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/** Разделы админки (ТЗ §3.1.4, §3.3.5): каталог, нормативы, параметры объектов, данные. */
const SECTIONS = [
  { href: "/admin", label: "Обзор", exact: true },
  { href: "/admin/catalog", label: "Каталог", exact: false },
  { href: "/admin/norms", label: "Нормативы", exact: false },
  { href: "/admin/params", label: "Параметры объектов", exact: false },
  { href: "/admin/data", label: "Данные и журнал", exact: false },
] as const;

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Разделы администрирования" className="no-print">
      <ul className="flex flex-wrap gap-x-1 gap-y-1 border-b pb-2 text-sm">
        {SECTIONS.map((s) => {
          const active = s.exact ? pathname === s.href : pathname === s.href || pathname.startsWith(`${s.href}/`);
          return (
            <li key={s.href}>
              <Link
                href={s.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "tap-target inline-block rounded-md px-3 py-1.5 transition-colors hover:bg-muted",
                  active ? "bg-muted font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                {s.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
