"use client";

import { refreshCatalogAction } from "@/lib/admin/actions";
import { Button } from "@/components/ui/button";
import { FormStatus, useAdminForm } from "./admin-form";

/**
 * «Обновить каталог» (ТЗ §3.3.6 — обновление по запросу): синхронизация данных организатора
 * с сохранением правок администратора и отчёт по-русски — сколько создано, обновлено,
 * пропущено из-за правок администратора, ушло в архив и сколько источников устарело.
 */
export function RefreshCatalog() {
  const form = useAdminForm(refreshCatalogAction);
  const report = form.state.status === "ok" ? (form.state.report ?? []) : [];
  return (
    <form onSubmit={form.onSubmit} className="flex flex-col gap-3" aria-label="Обновить каталог">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={form.pending}>
          Обновить каталог
        </Button>
        <FormStatus
          state={form.state}
          pending={form.pending}
          pendingText="Сверяю каталог с данными организатора…"
          className="text-sm"
        />
      </div>
      {report.length > 0 && (
        <div className="rounded-lg border bg-muted/20 p-3">
          <h3 className="text-sm font-semibold">Отчёт синхронизации</h3>
          <ul className="mt-1 list-disc pl-5 text-sm">
            {report.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      )}
    </form>
  );
}
