"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { compareHref, MAX_COMPARE } from "./search-params";

/**
 * Выбор решений для сравнения (ТЗ §3.3.7). Обёртка вокруг таблицы каталога: флажки строк —
 * обычные `<input name="ids">` внутри GET-формы на /catalog/compare, поэтому без JavaScript
 * форма тоже работает (адрес получится «ids=a&ids=b», страница сравнения понимает обе формы).
 *
 * С JavaScript форма следит за числом отмеченных: пятый флажок снимается с сообщением, а
 * отправка ведёт на «/catalog/compare?ids=a,b». Отмеченные флажки читаются из самой формы в
 * обработчиках событий, а не дублируются в состоянии: так браузерное восстановление формы
 * (кнопка «назад») не расходится с тем, что отправится.
 */

/** Slug'и отмеченных решений в порядке строк таблицы. */
function checkedIds(form: HTMLFormElement): string[] {
  return Array.from(form.querySelectorAll<HTMLInputElement>('input[name="ids"]:checked')).map((i) => i.value);
}

export function CompareForm({ children }: { children: ReactNode }) {
  const router = useRouter();
  const statusId = useId();
  const [count, setCount] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <form
      method="get"
      action="/catalog/compare"
      aria-describedby={statusId}
      onChange={(e) => {
        const target = e.target;
        if (!(target instanceof HTMLInputElement) || target.name !== "ids") return;
        let ids = checkedIds(e.currentTarget);
        if (target.checked && ids.length > MAX_COMPARE) {
          target.checked = false;
          ids = checkedIds(e.currentTarget);
          setMessage(`Сравнить можно не больше ${MAX_COMPARE} решений — снимите отметку с одного из выбранных.`);
        } else {
          setMessage(null);
        }
        setCount(ids.length);
      }}
      onSubmit={(e) => {
        e.preventDefault();
        const ids = checkedIds(e.currentTarget);
        setCount(ids.length);
        if (ids.length < 2) {
          setMessage(`Отметьте от 2 до ${MAX_COMPARE} решений в первой колонке таблицы.`);
          return;
        }
        setMessage(null);
        router.push(compareHref(ids.slice(0, MAX_COMPARE)));
      }}
      className="flex flex-col gap-3"
    >
      {children}
      <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border bg-background/95 px-4 py-2 shadow-sm backdrop-blur">
        <p id={statusId} role="status" aria-live="polite" className="text-sm">
          <span className="tabular-nums">
            Выбрано для сравнения: {count} из {MAX_COMPARE}
          </span>
          {message && <span className="block text-caution">{message}</span>}
        </p>
        <button type="submit" className={cn(buttonVariants({ size: "lg" }), "ml-auto px-4")}>
          Сравнить выбранные
        </button>
      </div>
    </form>
  );
}
