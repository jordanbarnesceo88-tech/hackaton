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
}: {
  industry: string;
  facility: string;
  facilityName: string;
  objectName: string | null;
  typical: FacilityParams;
}) {
  // Стартуем с типовых значений, а не с нулей: человек, впервые открывший расчёт, не знает,
  // сколько операций в сутки у типового объекта такого рода, и уходит вместо того, чтобы
  // поправить цифру под себя. Значения помечены типовыми прямо в подписи.
  const [params, setParams] = useState<FacilityParams>(typical);

  const next = `/compare/${facility}?${buildWizardQuery({ industry, facility, objectName, params })}`;

  return (
    <StepShell
      question={`Расскажите про ваш ${objectName ? `объект «${objectName}»` : facilityName.toLowerCase()}`}
      hint="Значения подставлены типовые для этого типа объекта — поправьте под себя. По ним посчитается верхняя граница эффекта; сузить её до конкретного решения можно на следующем шаге."
      nextHref={next}
      nextLabel="Показать решения"
    >
      <div className="flex flex-col gap-6">
        <NumField
          id="opsPerDay"
          label="Объём операций в сутки"
          value={params.opsPerDay}
          onChange={(n) => setParams((p) => ({ ...p, opsPerDay: n }))}
        />
        {/* На этом шаге решение ещё не выбрано, поэтому спрашивать «персонал, замещаемый
            решением» здесь нельзя — человек поневоле введёт весь штат, и сравнение выдаст
            потолок за оценку. Спрашиваем то, что он действительно знает, а сужение до
            работы конкретного решения происходит на шаге расчёта. */}
        <NumField
          id="staffCount"
          label="Персонал, которого может коснуться автоматизация"
          value={params.staffCount}
          onChange={(n) => setParams((p) => ({ ...p, staffCount: n }))}
        />
        <NumField
          id="areaM2"
          label="Площадь, м² (только визуализация)"
          value={params.areaM2}
          onChange={(n) => setParams((p) => ({ ...p, areaM2: n }))}
        />
      </div>
    </StepShell>
  );
}
