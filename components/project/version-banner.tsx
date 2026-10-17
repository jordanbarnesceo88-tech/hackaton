"use client";

import { unstable_rethrow } from "next/navigation";
import { useId, useLayoutEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { recalcProjectAction } from "@/lib/projects/actions";
import { formatCalcDate } from "@/lib/report/tz/rows";
import { TZ_MODEL_VERSION } from "@/lib/tz/version";

/**
 * Баннер «расчёт устарел» (ТЗ §3.1.5: повторное открытие воспроизводит расчёт с версией данных
 * и модели). Сохранённый проект всегда показывается на своём снимке — продукты, нормативы и
 * параметры те же, что при сохранении, — поэтому числа на экране совпадают с отчётом. Если с
 * тех пор сменилась модель расчёта (TZ_MODEL_VERSION) или живые данные каталога, нормативы и
 * описания параметров (версия данных на живых данных ≠ сохранённой), баннер говорит об этом и
 * предлагает «Пересчитать на актуальных данных» — серверное действие recalcProjectAction.
 */

/** Версии сохранённого расчёта, с которыми сравниваются текущие. */
export type StoredVersions = { modelVersion: string; dataVersion: string; calculatedAt: string };

/** Что изменилось с момента расчёта: подписи для текста баннера; пусто — ничего. */
export function versionChanges(
  stored: Pick<StoredVersions, "modelVersion" | "dataVersion">,
  liveDataVersion: string,
  currentModelVersion: string = TZ_MODEL_VERSION,
): string[] {
  const out: string[] = [];
  if (stored.modelVersion !== currentModelVersion) out.push("модель расчёта");
  if (stored.dataVersion !== liveDataVersion) out.push("данные каталога или нормативы");
  return out;
}

/** Текст баннера: «Показан расчёт от … (модель …, данные …). Что изменилось с тех пор: …». */
export function versionBannerText(stored: StoredVersions, changed: readonly string[]): string {
  return (
    `Показан расчёт от ${formatCalcDate(stored.calculatedAt)} (модель ${stored.modelVersion}, данные ${stored.dataVersion}). ` +
    `Что изменилось с тех пор: ${changed.join(" и ")}.`
  );
}

const NETWORK_ERROR = "Не удалось связаться с сервером — обновите страницу и повторите";

export function VersionBanner({
  projectId,
  stored,
  liveDataVersion,
  dirty,
  disabledReason,
  revision,
  archive = false,
}: {
  projectId: string;
  stored: StoredVersions;
  /** Версия данных, которую получил бы проект на живых данных (lib/projects/recalc.liveDataVersion). */
  liveDataVersion: string;
  /** Есть несохранённые правки: серверный пересчёт использует прежний сохранённый ввод. */
  dirty: boolean;
  /** Почему пересчитать нельзя (демо-проект, режим чтения); null — можно. */
  disabledReason?: string | null;
  revision?: number;
  archive?: boolean;
}) {
  const hintId = useId();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const editedDuringRecalc = useRef(false);
  useLayoutEffect(() => {
    if (dirty) editedDuringRecalc.current = true;
  }, [dirty]);
  const blockedReason = dirty
    ? "Есть несохранённые изменения. Сначала сохраните проект, затем пересчитайте на актуальных данных."
    : disabledReason;
  const changed = versionChanges(stored, liveDataVersion);
  if (!archive && changed.length === 0 && !pending && error === null) return null;

  function recalc() {
    if (pending || blockedReason) return;
    editedDuringRecalc.current = false;
    setError(null);
    startTransition(async () => {
      try {
        const r = await recalcProjectAction(projectId, revision);
        if (!r.ok) {
          startTransition(() => setError(r.message));
          return;
        }
        if (editedDuringRecalc.current) {
          startTransition(() => setError(
            "После начала пересчёта ввод на странице изменился. Страница не перезагружена, чтобы сохранить ваши правки. Проверьте и сохраните проект.",
          ));
          return;
        }
        // Рабочая область держит расчёт в своём состоянии и новые пропсы после revalidatePath
        // не подхватывает (иначе сохранение сбрасывало бы её вместе с сообщением «Проект
        // сохранён»). Поэтому после пересчёта на сервере страница открывается заново — на
        // новом снимке, и баннер исчезает сам.
        const url = new URL(window.location.href);
        url.searchParams.set("edit", "1");
        window.location.assign(url.href);
      } catch (e) {
        unstable_rethrow(e);
        console.error("VersionBanner", e);
        startTransition(() => setError(NETWORK_ERROR));
      }
    });
  }

  return (
    <div
      role="status"
      data-tone="warn"
      className="callout no-print flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex flex-col gap-1">
        <p>{archive ? `Архив: показаны сохранённые числа и вывод от ${formatCalcDate(stored.calculatedAt)} (модель ${stored.modelVersion}, данные ${stored.dataVersion}), без повторного прогона текущей модели.` : versionBannerText(stored, changed)}</p>
        <p className="text-xs text-muted-foreground">
          Числа ниже взяты из сохранённого расчёта и совпадают с отчётом. Явный пересчёт заменит сохранённый расчёт текущей моделью и откроет редактирование. Чтобы оставить исходный архив, сначала скопируйте проект.
        </p>
        {blockedReason && <p id={hintId} className="text-xs text-muted-foreground">{blockedReason}</p>}
        <p role="alert" className="text-destructive [&:empty]:hidden">
          {error ?? ""}
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        onClick={recalc}
        disabled={pending || Boolean(blockedReason)}
        aria-describedby={blockedReason ? hintId : undefined}
        className="shrink-0"
      >
        {pending ? "Пересчитываем…" : "Пересчитать на актуальных данных"}
      </Button>
    </div>
  );
}
