"use client";

import { useState } from "react";
import { StepShell } from "./step-shell";
import { NumField } from "@/components/ui/num-field";
import { buildWizardQuery } from "@/lib/wizard/steps";
import type { FacilityParams } from "@/lib/economics/types";

export function ParamsStep({
  industry,
  facility,
  facilityName,
  objectName,
  typical,
  rejected,
}: {
  industry: string;
  facility: string;
  facilityName: string;
  objectName: string | null;
  typical: FacilityParams;
  /** Поля, присланные в ссылке и не принятые. */
  rejected: ("area" | "ops" | "staff")[];
}) {
  // Стартуем с типовых значений, а не с нулей: человек, впервые открывший расчёт, не знает,
  // сколько операций в сутки у типового объекта такого рода, и уходит вместо того, чтобы
  // поправить цифру под себя. Значения помечены типовыми прямо в подписи.
  const [params, setParams] = useState<FacilityParams>(typical);

  // Дальше не сравнение, а занятость: движок считает замещение от неё, и без неё список
  // решений наполовину состоял бы из отказов.
  const next = `/onboarding/staffing?${buildWizardQuery({ industry, facility, objectName, params })}`;

  return (
    <StepShell
      question={`Расскажите про ваш ${objectName ? `объект «${objectName}»` : facilityName.toLowerCase()}`}
      hint="Значения подставлены типовые для этого типа объекта — поправьте под себя. По ним посчитается верхняя граница эффекта; сузить её до конкретного решения можно на следующем шаге."
      nextHref={next}
      nextLabel="Дальше: кто чем занят"
    >
      {rejected.length > 0 && (
        // Молча заменить негодное значение на типовое — значит показать человеку число,
        // которого он не вводил, и не сказать об этом. Он набрал −5, увидит 500 и решит,
        // что интерфейс его не услышал.
        <p className="rounded-md border-l-2 border-caution bg-caution/5 px-3 py-2 text-sm text-caution">
          {rejected.length === 1
            ? "Одно из присланных значений не принято"
            : "Несколько присланных значений не приняты"}
          : эти поля должны быть положительными числами. Ниже подставлены типовые значения —
          поправьте их под себя.
        </p>
      )}

      <div className="flex flex-col gap-6">
        <NumField
          id="opsPerDay"
          label="Объём операций в сутки"
          value={params.opsPerDay}
          onChange={(n) => setParams((p) => ({ ...p, opsPerDay: n }))}
        />
        {/* Весь штат, и это теперь буквально так (Р-2): занятость по каждой работе
            спрашивает следующий шаг, а здесь нужно число, которое человек знает точно и
            которое служит потолком замещения и основанием строки «остальные N человек не
            роботизируем». */}
        <NumField
          id="staffCount"
          label="Весь штат объекта"
          value={params.staffCount}
          onChange={(n) => setParams((p) => ({ ...p, staffCount: n }))}
        />
        {/* На этом шаге решение ещё не выбрано, поэтому сказать «только визуализация» нельзя:
            для решений, обслуживающих площадь, это главный вход, и человек, поверивший
            подписи, оставит типовое значение там, где от него зависит весь расчёт. */}
        <NumField
          id="areaM2"
          label="Площадь, м²"
          value={params.areaM2}
          onChange={(n) => setParams((p) => ({ ...p, areaM2: n }))}
        />
        <p className="-mt-4 text-xs text-muted-foreground">
          Решения, обслуживающие площадь (уборка), считают работу по ней; остальные — по
          объёму операций. Какое именно поле важно, будет видно в расчёте.
        </p>
      </div>
    </StepShell>
  );
}
