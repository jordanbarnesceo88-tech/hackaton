"use client";

import { createProductAction } from "@/lib/admin/actions";
import { Button } from "@/components/ui/button";
import { FormStatus, useAdminForm } from "./admin-form";
import { STATUS_LABELS } from "./format";
import { CHECK_LABEL_CLASS, INPUT_CLASS, LABEL_CLASS, LABEL_TEXT_CLASS, SELECT_CLASS } from "./styles";

/**
 * «Создать продукт» (ТЗ §3.3.5 — администратор добавляет записи каталога). Продукт получает
 * происхождение «администратор»; характеристики с источниками администратор заполняет
 * в карточке, куда форма переводит после создания. Отмеченные процессы определяют, в подборе
 * каких объектов продукт участвует.
 */
export function CreateProductForm({
  solutionTypes,
  processes,
}: {
  solutionTypes: readonly { slug: string; name: string }[];
  processes: readonly { slug: string; name: string; facilities: string }[];
}) {
  const form = useAdminForm(createProductAction);
  return (
    <form onSubmit={form.onSubmit} className="flex flex-col gap-4" aria-label="Создать продукт">
      <div key={form.state.seq} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className={LABEL_CLASS}>
          <span className={LABEL_TEXT_CLASS}>Название (модель) *</span>
          <input name="name" required maxLength={200} placeholder="например, Ronavi H1500" className={INPUT_CLASS} />
        </label>
        <label className={LABEL_CLASS}>
          <span className={LABEL_TEXT_CLASS}>Производитель</span>
          <input name="manufacturer" maxLength={200} placeholder="например, Ronavi Robotics" className={INPUT_CLASS} />
        </label>
        <label className={LABEL_CLASS}>
          <span className={LABEL_TEXT_CLASS}>Страна</span>
          <input name="country" maxLength={100} placeholder="например, Россия" className={INPUT_CLASS} />
        </label>
        <label className={LABEL_CLASS}>
          <span className={LABEL_TEXT_CLASS}>Тип решения</span>
          <select name="solutionType" defaultValue="" className={SELECT_CLASS}>
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
          <select name="status" defaultValue="operation" className={SELECT_CLASS}>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className={LABEL_CLASS}>
          <span className={LABEL_TEXT_CLASS}>Краткое описание (до 200 знаков)</span>
          <input name="description" maxLength={200} className={INPUT_CLASS} />
        </label>
        <fieldset className="flex flex-col gap-1 sm:col-span-2 lg:col-span-3">
          <legend className={LABEL_TEXT_CLASS}>Процессы, которые закрывает продукт</legend>
          <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {processes.map((p) => (
              <label key={p.slug} className={CHECK_LABEL_CLASS}>
                <input type="checkbox" name="process" value={p.slug} />
                <span>
                  {p.name} <span className="text-xs text-muted-foreground">({p.facilities})</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={form.pending}>
          Создать продукт
        </Button>
        <FormStatus state={form.state} pending={form.pending} pendingText="Создаю…" />
      </div>
    </form>
  );
}
