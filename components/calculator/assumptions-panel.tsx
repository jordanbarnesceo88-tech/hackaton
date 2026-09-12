import type { Dispatch, SetStateAction } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NumField } from "@/components/ui/num-field";
import type { AssumptionValues, CapacityBasis, WorkloadStream } from "@/lib/economics/types";
import { ASSUMPTION_BOUNDS, clampAssumption } from "@/lib/economics/assumptions";
import { ASSUMPTION_LABELS, RATIO_KEYS } from "./assumption-labels";
import { ASSUMPTION_JUSTIFICATIONS } from "@/lib/economics/assumption-justifications";
import { Disclosure } from "@/components/ui/disclosure";

// U1: assumptions the engine only consumes for a specific capacity basis. Hidden for other
// bases so every visible field actually affects the result (operatingHoursPerDay only
// annualizes PER_HOUR_FLOW capacity; turnoverPerDay only derives the CONCURRENT_STOCK peak).
const BASIS_ONLY: Partial<Record<keyof AssumptionValues, CapacityBasis>> = {
  operatingHoursPerDay: "PER_HOUR_FLOW",
  turnoverPerDay: "CONCURRENT_STOCK",
};

// Тот же принцип, но по потоку нагрузки, а не по базису ёмкости. Без этого решение потока
// операций показывало «Площадь на уборщика в год» и «Уборок площади в сутки» — поля, которые
// не двигают ни одно число на экране, — а решение потока площади показывало «Операций на
// сотрудника в год», столь же бесполезное. Инвариант панели («каждое видимое поле влияет на
// результат») держится обоими фильтрами, а не одним.
const STREAM_ONLY: Partial<Record<keyof AssumptionValues, WorkloadStream>> = {
  opsPerWorkerPerYear: "OPERATION_FLOW",
  areaPerCleanerPerYear: "FLOOR_AREA",
  cleaningsPerDay: "FLOOR_AREA",
};

// Т-4: допущения, которых движок не читает НИ ПРИ КАКОМ потоке. После подпроекта A замещение
// считается от занятости, названной владельцем объекта, а норматив выработки живёт на
// категории и имеет ссылку — оба делителя остались в типе и в базе (их несут сохранённые
// расчёты), но управлять ими больше нечем.
//
// Поле, которое можно править без всякого эффекта, нарушает тот же инвариант, ради которого
// здесь стоят фильтры по базису и потоку: каждое видимое поле влияет на результат. Скрыть
// честнее, чем оставить и промолчать, и честнее, чем «погасить» его как слабый рычаг —
// слабый и отсутствующий это разные утверждения.
const NOT_READ_BY_ENGINE = new Set<keyof AssumptionValues>([
  "opsPerWorkerPerYear",
  "areaPerCleanerPerYear",
]);

export function AssumptionsPanel({
  assumptions,
  setAssumptions,
  capacityBasis,
  workloadStream,
}: {
  assumptions: AssumptionValues;
  setAssumptions: Dispatch<SetStateAction<AssumptionValues>>;
  capacityBasis: CapacityBasis;
  workloadStream: WorkloadStream;
}) {
  const visibleKeys = (Object.keys(ASSUMPTION_LABELS) as (keyof AssumptionValues)[]).filter(
    (k) =>
      !NOT_READ_BY_ENGINE.has(k) &&
      (!BASIS_ONLY[k] || BASIS_ONLY[k] === capacityBasis) &&
      (!STREAM_ONLY[k] || STREAM_ONLY[k] === workloadStream)
  );
  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <CardTitle as="h2">Допущения (можно изменить)</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
        {visibleKeys.map((k) => (
          <div key={k} className="flex flex-col gap-1">
          <NumField
            id={k}
            label={ASSUMPTION_LABELS[k]}
            value={assumptions[k]}
            step={RATIO_KEYS.has(k) ? 0.05 : 1}
            min={ASSUMPTION_BOUNDS[k].min}
            max={ASSUMPTION_BOUNDS[k].max}
            // Clamp on the way in: `type=number` min/max only constrain the spinner, so a typed
            // or pasted value still arrives unbounded. Without this, «Замещение труда» = 5
            // yields a 12x NPV that renders with full confidence and can be saved to a report.
            // Во время набора зажимаем только СВЕРХУ: верхняя граница защищает от абсурдных
            // значений и никогда не мешает печатать, а нижняя во время набора нарушается
            // всегда — первой же цифрой. Её применяем на уходе из поля.
            onChange={(n) =>
              setAssumptions((a) => ({
                ...a,
                [k]: Math.min(n, ASSUMPTION_BOUNDS[k]?.max ?? n),
              }))
            }
            onCommit={(n) => setAssumptions((a) => ({ ...a, [k]: clampAssumption(k, n) }))}
          />
          {/* Признак — на виду, обоснование — в раскрытии. Скептик сначала спрашивает не
              «почему 15 %», а «это вы посчитали или откуда-то взяли», и ответ на второй
              вопрос должен читаться без единого клика. «Наш выбор» рядом со ставкой
              дисконтирования честнее любого текста: спорить с ней можно, проверить — нельзя. */}
          <p className="text-xs text-muted-foreground">
            <span className="rounded bg-muted px-1.5 py-0.5 font-medium">
              {ASSUMPTION_JUSTIFICATIONS[k].basis}
            </span>
            <Disclosure
              title={ASSUMPTION_LABELS[k]}
              body={ASSUMPTION_JUSTIFICATIONS[k].text}
            />
          </p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
