"use client";

import { useId } from "react";
import { updateProductAction } from "@/lib/admin/actions";
import { Button } from "@/components/ui/button";
import { FormStatus, useAdminForm } from "./admin-form";
import { STATUS_LABELS } from "./format";
import { CHECK_LABEL_CLASS, INPUT_CLASS, LABEL_CLASS, LABEL_TEXT_CLASS, SELECT_CLASS } from "./styles";

export type ProductFormValues = {
  slug: string;
  name: string;
  manufacturer: string | null;
  country: string | null;
  /** Slug типа решения; "" — без типа. */
  solutionType: string;
  status: string;
  excluded: boolean;
  excludedReason: string | null;
  archived: boolean;
  /**
   * Версия строки продукта (updatedAt). Входит в ключ полей: если продукт изменило другое
   * действие (архив, возврат данных организатора), поля показывают свежие значения, а не
   * устаревшие — иначе следующее сохранение вернуло бы старое.
   */
  version: string;
};

/**
 * Идентификация продукта (ТЗ §3.3.4, группа «Идентификация»; §3.3.5 — правка каталога):
 * название, производитель, страна, тип решения, статус, исключение из подбора с причиной,
 * архив. Сохранение ставит продукту признак «правка администратора» — «Обновить каталог»
 * его не перезапишет, пока не нажата «Вернуть данные организатора».
 */
export function ProductForm({
  values,
  solutionTypes,
}: {
  values: ProductFormValues;
  solutionTypes: readonly { slug: string; name: string }[];
}) {
  const form = useAdminForm(updateProductAction);
  const id = useId();
  return (
    <form onSubmit={form.onSubmit} className="flex flex-col gap-4" aria-label="Идентификация продукта">
      <input type="hidden" name="slug" value={values.slug} />
      <div key={`${form.state.seq}:${values.version}`} className="grid gap-4 sm:grid-cols-2">
        <label className={LABEL_CLASS}>
          <span className={LABEL_TEXT_CLASS}>Название (модель)</span>
          <input name="name" required maxLength={200} defaultValue={values.name} className={INPUT_CLASS} />
        </label>
        <label className={LABEL_CLASS}>
          <span className={LABEL_TEXT_CLASS}>Производитель</span>
          <input
            name="manufacturer"
            maxLength={200}
            defaultValue={values.manufacturer ?? ""}
            placeholder="например, Ronavi Robotics"
            className={INPUT_CLASS}
          />
        </label>
        <label className={LABEL_CLASS}>
          <span className={LABEL_TEXT_CLASS}>Страна</span>
          <input
            name="country"
            maxLength={100}
            defaultValue={values.country ?? ""}
            placeholder="например, Россия"
            className={INPUT_CLASS}
          />
        </label>
        <label className={LABEL_CLASS}>
          <span className={LABEL_TEXT_CLASS}>Тип решения</span>
          <select name="solutionType" defaultValue={values.solutionType} className={SELECT_CLASS}>
            <option value="">— без типа —</option>
            {solutionTypes.map((t) => (
              <option key={t.slug} value={t.slug}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className={LABEL_CLASS}>
          <span className={LABEL_TEXT_CLASS}>Статус</span>
          <select name="status" defaultValue={values.status} className={SELECT_CLASS}>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-col justify-end gap-2">
          <label className={CHECK_LABEL_CLASS}>
            <input type="checkbox" name="archived" defaultChecked={values.archived} />
            В архиве (не показывается в каталоге и подборе)
          </label>
        </div>
        <div className="flex flex-col gap-2 sm:col-span-2">
          <label className={CHECK_LABEL_CLASS}>
            <input type="checkbox" name="excluded" defaultChecked={values.excluded} aria-describedby={`${id}-excl`} />
            Исключить из подбора
          </label>
          <label className={LABEL_CLASS}>
            <span className={LABEL_TEXT_CLASS}>Причина исключения (обязательна, если продукт исключён)</span>
            <input
              name="excludedReason"
              maxLength={300}
              defaultValue={values.excludedReason ?? ""}
              placeholder="например, модель снята с производства"
              className={INPUT_CLASS}
            />
          </label>
          <p id={`${id}-excl`} className="text-xs text-muted-foreground">
            Исключённый продукт виден в подборе с этой причиной; пользователь может добавить его вручную с
            предупреждением (ТЗ §3.4).
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={form.pending}>
          Сохранить идентификацию
        </Button>
        <FormStatus state={form.state} pending={form.pending} />
      </div>
    </form>
  );
}
