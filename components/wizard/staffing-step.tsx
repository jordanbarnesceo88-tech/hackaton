"use client";

import { useState } from "react";
import { StepShell } from "./step-shell";
import { NullableNumField } from "@/components/ui/num-field";
import { buildWizardQuery } from "@/lib/wizard/steps";
import { staffingRemainder, staffingExceedsHeadcount } from "@/lib/wizard/task-staffing";
import type { TaskStaffingRow } from "@/lib/wizard/task-staffing";
import type { FacilityParams } from "@/lib/economics/types";

/**
 * Шаг «кто чем занят» — тот, без которого ветка стояла нерабочей.
 *
 * Движок перестал выводить замещение из спроса: он считает его от занятости, названной
 * владельцем объекта. Спросить эту занятость было негде, поэтому семь решений из одиннадцати
 * отказывались считать, а экран объяснял это словами «проверьте параметры расчёта — некоторые
 * значения некорректны», то есть винил человека в том, чего не хватало продукту (Р-1).
 *
 * Три вещи, которые этот экран обязан делать и которых не делает обычная форма:
 *  — пустое поле остаётся пустым, если норматива нет. Правдоподобное число вместо
 *    отсутствующего источника немедленно станет «расчётом», хотя его никто не считал;
 *  — предзаполненное помечено нормативом со ссылкой, а не выдано за ответ человека;
 *  — остаток назван вслух. «Остальные N человек — не роботизируем» снимает главное возражение
 *    к любому такому калькулятору до того, как оно прозвучит.
 */
export function StaffingStep({
  industry,
  facility,
  facilityName,
  objectName,
  params,
  rows: initialRows,
}: {
  industry: string;
  facility: string;
  facilityName: string;
  objectName: string | null;
  params: FacilityParams;
  rows: TaskStaffingRow[];
}) {
  const [declared, setDeclared] = useState<Record<string, number | null>>(() =>
    Object.fromEntries(initialRows.map((r) => [r.slug, r.declared ?? null]))
  );

  const rows: TaskStaffingRow[] = initialRows.map((r) => ({
    ...r,
    declared: declared[r.slug] ?? undefined,
  }));

  const remainder = staffingRemainder(rows, params.staffCount);
  const exceeds = staffingExceedsHeadcount(rows, params.staffCount);

  // Задачи, по которым ответа нет и норматива тоже нет: их решения посчитать НЕЧЕМ, и честнее
  // сказать это здесь, чем показать отказ на следующем экране без объяснения.
  const blocked = rows.filter((r) => r.declared === undefined && r.suggested === null);

  // Задачи, по которым ответа нет, а норматив ЕСТЬ. Движок для них возьмёт норматив
  // (`resolveTaskFte`: заявленное → норматив → null), то есть замещение этих людей затронет.
  // А остаток считается только по заявленному (`staffingRemainder`) — намеренно: неподтверждённый
  // норматив это наше предположение, а не ответ человека. Оба решения верны по отдельности, но
  // вместе они дают ложную строку: «остальные 40 человек из 40 — не роботизируем. Их работа в
  // расчёт экономии не входит», пока расчёт на следующем экране замещает шестерых из них по
  // нормативу. Число остатка остаётся прежним, а вот молчать о нормативе нельзя.
  const byNorm = rows.filter((r) => r.declared === undefined && r.suggested !== null);

  const taskStaffing: Record<string, number> = {};
  for (const r of rows) if (r.declared !== undefined) taskStaffing[r.slug] = r.declared;

  const nextParams: FacilityParams = {
    ...params,
    ...(Object.keys(taskStaffing).length > 0 ? { taskStaffing } : {}),
  };
  const next = exceeds
    ? null
    : `/compare/${facility}?${buildWizardQuery({
        industry,
        facility,
        objectName,
        params: nextParams,
      })}`;

  return (
    <StepShell
      question={`Кто чем занят${objectName ? ` в «${objectName}»` : ` в ${facilityName.toLowerCase()}`}?`}
      hint="Сколько человек сегодня делает каждую из этих работ. Замещение считается от этих чисел, а не от всего штата — поэтому от них зависит каждая цифра дальше."
      nextHref={next}
      nextLabel="Показать решения"
    >
      {exceeds && (
        <p className="rounded-md border-l-2 border-destructive bg-destructive/5 px-3 py-2 text-sm text-destructive">
          Сумма по задачам больше, чем весь персонал объекта ({params.staffCount}). Одного
          человека нельзя занять двумя работами на полную ставку — поправьте числа или
          вернитесь и увеличьте штат.
        </p>
      )}

      <div className="flex flex-col gap-6">
        {rows.map((r) => (
          <div key={r.slug} className="flex flex-col gap-1">
            <NullableNumField
              id={`task-${r.slug}`}
              label={r.taskLabel}
              value={declared[r.slug] ?? null}
              max={params.staffCount}
              invalid={exceeds}
              placeholder={r.suggested === null ? "нет норматива — назовите сами" : String(r.suggested)}
              onChange={(n) => setDeclared((d) => ({ ...d, [r.slug]: n }))}
            />
            {r.suggested !== null ? (
              <p className="text-xs text-muted-foreground">
                По нормативу для этого объекта — {r.suggested}{" "}
                {r.sourceUrl && (
                  <>
                    (
                    <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">
                      источник
                    </a>
                    )
                  </>
                )}
                . Оставьте поле пустым, чтобы считать по нормативу, или впишите своё число.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Открытого норматива по этой работе найти не удалось, поэтому подставить нечего.
                Без вашего числа решения этой задачи посчитать нельзя.
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="rounded-md border border-border px-4 py-3 text-sm">
        {exceeds ? (
          <span className="text-destructive">
            Задачам отдано на {Math.abs(remainder)} человек больше, чем есть на объекте.
          </span>
        ) : (
          <>
            Остальные <b className="tabular-nums">{remainder}</b> человек из{" "}
            <b className="tabular-nums">{params.staffCount}</b> — не роботизируем. Их работа в
            расчёт экономии не входит.
            {byNorm.length > 0 && (
              <span className="mt-2 block text-muted-foreground">
                Кроме {byNorm.map((r) => r.taskLabel.toLowerCase()).join(", ")}: своего числа вы
                здесь не назвали, поэтому расчёт возьмёт норматив — эти люди посчитаны в остатке,
                но замещение их затронет. Впишите своё число, чтобы остаток был точным.
              </span>
            )}
          </>
        )}
      </div>

      {blocked.length > 0 && !exceeds && (
        <p className="rounded-md border-l-2 border-caution bg-caution/5 px-3 py-2 text-sm text-caution">
          Без числа по{" "}
          {blocked.map((r) => r.taskLabel.toLowerCase()).join(", ")} решения этих работ на
          следующем экране посчитаны не будут — им неоткуда взять занятость.
        </p>
      )}
    </StepShell>
  );
}
