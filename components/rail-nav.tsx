"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { PanelLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Клиентская часть боковой панели: сворачивание в иконки и его запоминание. Вынесена из
 * SiteRail (серверный компонент, читает сессию), потому что состояние сворачивания живёт
 * только в браузере, и потому что ширина <aside> зависит от этого состояния — обёртку нельзя
 * было оставить в серверном компоненте статическим классом.
 *
 * Тот же приём, что и в facility-visualization.tsx для prefers-reduced-motion:
 * useSyncExternalStore с явным серверным снимком, а не useState + запись в эффекте. Дело не
 * только в стиле — `setState` синхронно внутри эффекта на маунте запускает каскадный
 * повторный рендер (react-hooks/set-state-in-effect, ловится линтом с --max-warnings=0), а
 * useSyncExternalStore для внешнего источника (localStorage) — как раз тот API, что не
 * попадает под это ограничение: сервер рендерит «развёрнуто» (getServerSnapshot), клиент при
 * гидратации либо совпадает с ним, либо useSyncExternalStore сам просит перерендер — без
 * ручного setState в эффекте.
 */
const STORAGE_KEY = "rail-collapsed";
const listeners = new Set<() => void>();
let cachedCollapsed: boolean | null = null;

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    // Приватный режим/запрещённое хранилище — остаёмся развёрнутыми, не ломаем панель.
    return false;
  }
}

function getSnapshot(): boolean {
  if (cachedCollapsed === null) cachedCollapsed = readCollapsed();
  return cachedCollapsed;
}

function getServerSnapshot(): boolean {
  return false;
}

function subscribeToCollapse(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function setCollapsed(next: boolean) {
  cachedCollapsed = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  } catch {
    // Тише не сохранить — не критично, просто не запомнится между визитами.
  }
  listeners.forEach((l) => l());
}

export type RailNavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number; "aria-hidden"?: boolean }>;
};

export function RailNav({
  items,
  header,
  footer,
}: {
  items: readonly RailNavItem[];
  header?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const collapsed = useSyncExternalStore(subscribeToCollapse, getSnapshot, getServerSnapshot);

  function toggle() {
    setCollapsed(!collapsed);
  }

  const showLabel = (mobileNever: boolean) =>
    cn("truncate", mobileNever ? "hidden" : collapsed ? "hidden md:hidden" : "hidden md:inline");

  return (
    // w-14 (56px) — иконки на телефоне ВСЕГДА, это чистый брейкпоинт, JS тут ни при чём.
    // На md+ ширина берётся из --rail-w (BCB), но только пока не свёрнуто вручную.
    <aside
      className={cn(
        "rail glass sticky top-0 z-10 flex h-dvh w-14 shrink-0 flex-col border-r border-border no-print",
        collapsed ? "md:w-14" : "md:w-(--rail-w)",
      )}
    >
      {header}
      <nav
        aria-label="Основная навигация"
        className="flex min-w-0 flex-1 flex-col gap-1 overflow-y-auto px-2 py-2"
      >
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            title={collapsed ? item.label : undefined}
            className="tap-target flex items-center gap-3 rounded-md px-2.5 py-[9px] transition-colors hover:bg-muted hover:text-foreground"
          >
            <item.icon size={18} aria-hidden={true} />
            <span className={showLabel(false)}>{item.label}</span>
          </Link>
        ))}
      </nav>
      <div className="border-t border-border px-2 py-2">
        {footer}
        {/* Кнопка сворачивания — только на десктопе: на телефоне панель и так уже в иконках,
            переключать там нечего. */}
        <button
          type="button"
          onClick={toggle}
          aria-pressed={collapsed}
          className="tap-target hidden w-full items-center gap-3 rounded-md px-2.5 py-[9px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:flex"
        >
          <PanelLeft size={18} aria-hidden={true} />
          <span className={cn("truncate", collapsed && "hidden")}>
            {collapsed ? "" : "Свернуть"}
          </span>
        </button>
      </div>
    </aside>
  );
}
