"use client";

import { unstable_rethrow } from "next/navigation";
import { useState, useTransition } from "react";
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

/** Текст баннера: «Показан расчёт от … (модель …, данные …). С тех пор изменились …». */
export function versionBannerText(stored: StoredVersions, changed: readonly string[]): string {
  return (
    `Показан расчёт от ${formatCalcDate(stored.calculatedAt)} (модель ${stored.modelVersion}, данные ${stored.dataVersion}). ` +
    `С тех пор изменились ${changed.join(" и ")}.`
  );
}

const NETWORK_ERROR = "Не удалось связаться с сервером — обновите страницу и повторите";

export function VersionBanner({
  projectId,
  stored,
  liveDataVersion,
  disabledReason,
}: {
  projectId: string;
  stored: StoredVersions;
  /** Версия данных, которую получил бы проект на живых данных (lib/projects/recalc.liveDataVersion). */
  liveDataVersion: string;
  /** Почему пересчитать нельзя (демо-проект, режим чтения); null — можно. */
  disabledReason?: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const changed = versionChanges(stored, liveDataVersion);
  if (changed.length === 0) return null;

  function recalc() {
    setError(null);
    startTransition(async () => {
      try {
        const r = await recalcProjectAction(projectId);
        if (!r.ok) {
          startTransition(() => setError(r.message));
          return;
        }
        // Рабочая область держит расчёт в своём состоянии и новые пропсы после revalidatePath
        // не подхватывает (иначе сохранение сбрасывало бы её вместе с сообщением «Проект
        // сохранён»). Поэтому после пересчёта на сервере страница открывается заново — на
        // новом снимке, и баннер исчезает сам.
        window.location.reload();
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
      className="no-print flex flex-col gap-2 rounded-md border border-caution/50 bg-caution/10 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex flex-col gap-1">
        <p>{versionBannerText(stored, changed)}</p>
        <p className="text-xs text-muted-foreground">
          Числа ниже воспроизведены из сохранённого снимка и совпадают с отчётом. Пересчёт возьмёт текущие данные
          каталога, нормативы и модель; несохранённые правки на странице при этом не учитываются.
        </p>
        {disabledReason && <p className="text-xs text-muted-foreground">{disabledReason}</p>}
        <p role="alert" className="text-destructive [&:empty]:hidden">
          {error ?? ""}
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        onClick={recalc}
        disabled={pending || Boolean(disabledReason)}
        className="shrink-0"
      >
        {pending ? "Пересчитываем…" : "Пересчитать на актуальных данных"}
      </Button>
    </div>
  );
}
