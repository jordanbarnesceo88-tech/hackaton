"use client";

import { archiveProductAction, deleteProductAction, revertProductAction } from "@/lib/admin/actions";
import { Button } from "@/components/ui/button";
import { FormStatus, useAdminForm } from "./admin-form";
import { CHECK_LABEL_CLASS } from "./styles";

/**
 * Действия с продуктом (ТЗ §3.3.5): архив, возврат данных организатора, удаление. Удалить можно
 * только продукт, заведённый администратором; продукт организатора — только в архив (его снимок
 * нужен сохранённым проектам, а следующее обновление каталога создало бы его заново).
 */
export function ProductActions({
  slug,
  origin,
  archived,
  editedByAdmin,
  inOrganizerData,
}: {
  slug: string;
  origin: "ORGANIZER" | "ADMIN";
  archived: boolean;
  editedByAdmin: boolean;
  /** Продукт есть в текущих данных организатора — его можно вернуть к ним. */
  inOrganizerData: boolean;
}) {
  const archive = useAdminForm(archiveProductAction);
  const revert = useAdminForm(
    revertProductAction,
    "Правки администратора по этому продукту будут удалены, значения вернутся к данным организатора. Продолжить?",
  );
  const remove = useAdminForm(deleteProductAction, "Удалить продукт без возможности восстановления?");

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <form onSubmit={archive.onSubmit} className="flex flex-col gap-2 rounded-lg border p-3">
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="archived" value={archived ? "0" : "1"} />
        <h3 className="text-sm font-semibold">{archived ? "Продукт в архиве" : "Архив"}</h3>
        <p className="text-xs text-muted-foreground">
          {archived
            ? "Не показывается в каталоге и не участвует в подборе. Сохранённые проекты хранят его снимок."
            : "Скрыть продукт из каталога и подбора, не теряя его истории и снимков в проектах."}
        </p>
        <Button type="submit" variant="outline" size="sm" disabled={archive.pending} className="w-fit">
          {archived ? "Вернуть из архива" : "В архив"}
        </Button>
        <FormStatus state={archive.state} pending={archive.pending} />
      </form>

      <form onSubmit={revert.onSubmit} className="flex flex-col gap-2 rounded-lg border p-3">
        <input type="hidden" name="slug" value={slug} />
        <h3 className="text-sm font-semibold">Данные организатора</h3>
        {origin === "ORGANIZER" && inOrganizerData ? (
          <>
            <p className="text-xs text-muted-foreground">
              {editedByAdmin
                ? "Удалить правки администратора и заново загрузить продукт из данных организатора."
                : "Правок администратора нет — продукт совпадает с данными организатора."}
            </p>
            <Button
              type="submit"
              variant="outline"
              size="sm"
              disabled={revert.pending || !editedByAdmin}
              className="w-fit"
            >
              Вернуть данные организатора
            </Button>
            <FormStatus state={revert.state} pending={revert.pending} pendingText="Возвращаю данные…" />
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            {origin === "ADMIN"
              ? "Продукт заведён администратором — данных организатора для него нет."
              : "Продукта нет в текущих данных организатора — вернуть нечего; оставьте его в архиве."}
          </p>
        )}
      </form>

      <form onSubmit={remove.onSubmit} className="flex flex-col gap-2 rounded-lg border p-3">
        <input type="hidden" name="slug" value={slug} />
        <h3 className="text-sm font-semibold">Удаление</h3>
        {origin === "ADMIN" ? (
          <>
            <p className="text-xs text-muted-foreground">
              Необратимо. Продукт, который выбран в сценарии проекта, не удаляется — переведите его в архив.
            </p>
            <label className={CHECK_LABEL_CLASS}>
              <input type="checkbox" name="confirm" value="yes" required />
              Подтверждаю удаление
            </label>
            <Button type="submit" variant="destructive" size="sm" disabled={remove.pending} className="w-fit">
              Удалить продукт
            </Button>
            <FormStatus state={remove.state} pending={remove.pending} pendingText="Удаляю…" />
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            Удалить нельзя: данные организатора — используйте «В архив».
          </p>
        )}
      </form>
    </div>
  );
}
