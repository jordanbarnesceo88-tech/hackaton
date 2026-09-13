import type { Dispatch, SetStateAction } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NumField, NullableNumField } from "@/components/ui/num-field";
import { RegionSelect } from "@/components/calculator/region-select";
import type {
  FacilityParams,
  SolutionCapacity,
  AssumptionValues,
} from "@/lib/economics/types";
import {
  resolvePeakConcurrent,
  computeQuantity,
  demandPerYear,
} from "@/lib/economics/normalize";
import { resolveTaskFte } from "@/lib/economics/task-labour";
import { OverrideField } from "@/components/calculator/override-field";

export function ParamsForm({
  params,
  setParams,
  capacity,
  capacityUnit,
  assumptions,
  selectedRegionId,
  onPickRegion,
  onClearRegion,
  usdToRub,
}: {
  params: FacilityParams;
  setParams: Dispatch<SetStateAction<FacilityParams>>;
  capacity: SolutionCapacity;
  capacityUnit: string;
  assumptions: AssumptionValues;
  selectedRegionId: string | null;
  onPickRegion: (id: string, labor: number, energyFactor: number) => void;
  onClearRegion: () => void;
  usdToRub: number;
}) {
  const isStock = capacity.capacityBasis === "CONCURRENT_STOCK";
  // Считается БЕЗ переопределения: иначе «расчёт даёт» показывало бы то же число, которое
  // человек только что ввёл, и пометка потеряла бы смысл.
  const computedQuantity = computeQuantity(
    capacity,
    { ...params, quantityOverride: undefined },
    assumptions
  );

  // Что сказал бы норматив, если человек не назовёт своё число. Считается тем же
  // resolveTaskFte, которым считает движок, — плейсхолдер не имеет права обещать иное.
  const byNorm = resolveTaskFte({
    declared: undefined,
    demandPerYear: demandPerYear(params, assumptions, capacity.workloadStream),
    workerOutputPerYear: capacity.workerOutputPerYear,
    staffCount: params.staffCount,
  });

  // Граница сохранения требует строго положительных параметров объекта, и поле обязано
  // сказать об этом ЗДЕСЬ. Иначе человек набирает ноль, видит «Проверьте параметры расчёта»
  // вместо чисел, жмёт «Сохранить» и получает общую «Ошибку сохранения», которая ничего не
  // объясняет, — тот самый разрыв, о котором предупреждает комментарий в OverrideField.
  const nonPositive = (
    [
      ["areaM2", "Площадь", params.areaM2],
      ["opsPerDay", "Объём операций", params.opsPerDay],
      ["staffCount", "Весь штат объекта", params.staffCount],
    ] as const
  ).filter(([, , v]) => !(Number.isFinite(v) && v > 0));

  // Норматив — дробное число, и округление в подписи не имеет права выдавать себя за него.
  // Движок считает по 6,2857…, а плейсхолдер обещал «по нормативу 6.3»: расхождение крошечное,
  // но это то самое расхождение — экран называет одно число, страница считает по другому.
  const roundedNorm = byNorm === null ? null : Math.round(byNorm * 10) / 10;
  const normLabel =
    roundedNorm === null ? null : `${roundedNorm === byNorm ? "" : "≈"}${roundedNorm}`;

  // Занятость по задачам против штата — второй разрыв того же рода, что `nonPositive`.
  //
  // `max` у input[type=number] ограничивает ТОЛЬКО стрелки спиннера: набранное или вставленное
  // число проходит целиком. Дальше расходятся три места. Движок зажимает каждое решение в штат
  // (`Math.min(cap, declared)` в resolveTaskFte) и молча считает по 25, пока поле показывает
  // 40. Граница сохранения (`validateParams`) отклоняет СУММУ больше штата и роняет «Сохранить»
  // в общую «Ошибку сохранения», которая ничего не объясняет. Экран не говорил ни о том, ни о
  // другом — а это ровно те два дефекта, которые здесь закрывались уже дважды.
  //
  // Допуск в одну сотую — тот же, что на границе сохранения: занятость по нормативу дробная, и
  // сумма таких чисел не обязана попадать в штат до последнего разряда с плавающей точкой.
  const declaredHere = params.taskStaffing?.[capacity.categorySlug];
  const claimed = Object.values(params.taskStaffing ?? {}).reduce((s, v) => s + v, 0);
  const cappedHere = declaredHere !== undefined && declaredHere > params.staffCount;
  const overStaffed = claimed > params.staffCount + 0.01;
  // При нулевом или отрицательном штате об этом уже кричит блок `nonPositive`; второй красный
  // блок про то же самое ничего не добавляет.
  const staffingConflict = params.staffCount > 0 && (cappedHere || overStaffed);
  // `aria-invalid` утверждает, что негодно ЭТО значение. Когда штат перебран суммой по другим
  // работам, значение в этом поле может быть безупречным, и помечать его было бы неправдой —
  // о переборе говорит блок ниже, он же называет обе величины.
  const thisFieldInvalid = params.staffCount > 0 && cappedHere;

  const setTaskFte = (n: number | null) =>
    setParams((p) => {
      const next = { ...(p.taskStaffing ?? {}) };
      // Пустое поле СТИРАЕТ ключ, а не пишет ноль: отсутствие означает «считай по нормативу»,
      // ноль — «этой работой никто не занят». Записать одно вместо другого значит подменить
      // ответ человека.
      if (n === null) delete next[capacity.categorySlug];
      else next[capacity.categorySlug] = n;
      return {
        ...p,
        taskStaffing: Object.keys(next).length > 0 ? next : undefined,
      };
    });
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Параметры объекта</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <RegionSelect
          usdToRub={usdToRub}
          selectedRegionId={selectedRegionId}
          onPick={onPickRegion}
          onClear={onClearRegion}
        />
        {/* Подпись зависит от ПОТОКА решения, а не от общего правила. Раньше здесь стояло
            «только визуализация» — это было верно, пока площадь ни на что не влияла. Теперь
            для решения потока площади она главный экономический вход: гонит спрос, парк,
            покрытие, замещение и NPV. Оставить прежнюю подпись значило бы сказать человеку,
            что решающее поле декоративно, — и это ровно тот инвариант («каждое видимое поле
            влияет на результат»), ради которого в панель допущений добавлен фильтр по потоку. */}
        <NumField
          id="areaM2"
          label={
            capacity.workloadStream === "FLOOR_AREA"
              ? "Площадь, м² — по ней считается вся работа"
              : "Площадь, м² (только визуализация)"
          }
          value={params.areaM2}
          onChange={(n) => setParams((p) => ({ ...p, areaM2: n }))} />
        <NumField
          id="opsPerDay"
          label={
            capacity.workloadStream === "FLOOR_AREA"
              ? "Объём операций в сутки (не влияет на это решение)"
              : "Объём операций в сутки"
          }
          value={params.opsPerDay}
          onChange={(n) => setParams((p) => ({ ...p, opsPerDay: n }))}
        />
        {/* Р-2. Здесь стояло ОДНО поле, подписанное «сколько человек делает работу этого
            решения», но привязанное к staffCount — то есть ко всему штату объекта. Подпись
            обещала занятость по задаче, посевное значение означало весь штат (у склада 40),
            а движок трактовал его третьим способом. После подпроекта A рядом появился
            taskStaffing, который спрашивает ровно то же самое, и два поля стали дублировать
            друг друга.

            Разведено honestly: занятость задачи — это taskStaffing, и она пишется сюда;
            staffCount возвращается к своему посевному смыслу — весь штат объекта, потолок
            замещения и основание строки «остальные N человек не роботизируем». */}
        <NullableNumField
          id="taskStaffing"
          label="Сколько человек делает работу этого решения"
          value={declaredHere ?? null}
          max={params.staffCount}
          invalid={thisFieldInvalid}
          placeholder={
            normLabel === null ? "норматива нет — назовите число" : `по нормативу ${normLabel}`
          }
          onChange={setTaskFte}
        />
        <p className="-mt-4 text-xs text-muted-foreground">
          Те, чью работу забирает именно это решение, а не весь штат. От этого числа считается
          замещение, поэтому от него зависит каждый показатель ниже.{" "}
          {byNorm === null
            ? "Открытого норматива по этой работе у нас нет, поэтому без вашего числа расчёта не будет."
            : "Оставьте поле пустым, чтобы считать по нормативу."}
        </p>
        {staffingConflict && (
          <p className="rounded-md border-l-2 border-destructive bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {cappedHere
              ? `Этой работой занято ${declaredHere} — больше, чем весь штат объекта (${params.staffCount}). Замещение модель считает по ${params.staffCount}: больше людей на объекте нет.`
              : `Сумма занятости по всем работам — ${Math.round(claimed * 100) / 100} при штате ${params.staffCount}. Одного человека нельзя занять двумя работами на полную ставку.`}{" "}
            Сохранить такой расчёт нельзя — уменьшите занятость или увеличьте штат.
          </p>
        )}
        <NumField
          id="staffCount"
          label="Весь штат объекта"
          value={params.staffCount}
          onChange={(n) => setParams((p) => ({ ...p, staffCount: n }))}
        />
        <p className="-mt-4 text-xs text-muted-foreground">
          Потолок: сколько бы ни было занято задачей, замещение не может превысить весь штат.
        </p>
        {nonPositive.length > 0 && (
          <p className="rounded-md border-l-2 border-destructive bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {nonPositive.map(([, label]) => label).join(", ")} — {nonPositive.length === 1 ? "должно быть больше нуля" : "должны быть больше нуля"}.
            Ноль и отрицательные модель считать не может, и сохранить такой расчёт тоже нельзя.
          </p>
        )}
        {isStock && (
          <NumField
            id="peakConcurrent"
            label="Пиковая одновременная нагрузка"
            // Show what the engine is actually sizing against. When the field has never been
            // set — which happens if the user switches in-place into a stock solution — the
            // engine derives the peak from throughput and turnover, and rendering `?? 0` here
            // put a 0 on screen while the fleet was sized from something else entirely.
            value={resolvePeakConcurrent(params, assumptions) ?? 0}
            onChange={(n) => setParams((p) => ({ ...p, peakConcurrent: n }))}
          />
        )}
        <p className="text-xs text-muted-foreground">
          Производительность решения: {capacity.capacityPerUnit} {capacityUnit}
        </p>

        {/* Переопределения. Отделены линией и подписью намеренно: выше — то, что человек
            знает про свой объект, ниже — то, чем он спорит с расчётом. Смешивать их в один
            список значило бы стереть разницу между «мои данные» и «моя правка модели». */}
        <div className="mt-2 flex flex-col gap-4 border-t pt-4">
          <p className="text-sm font-medium">
            Свои значения
            <span className="ml-2 font-normal text-muted-foreground">
              — если вы не согласны с расчётом
            </span>
          </p>
          <OverrideField
            id="quantityOverride"
            integer
            label="Количество единиц"
            computed={computedQuantity}
            value={params.quantityOverride}
            onChange={(n) => setParams((p) => ({ ...p, quantityOverride: n }))}
          />
          <OverrideField
            id="capexPerUnitUsdOverride"
            label="Цена за единицу, USD"
            computed={capacity.priceUsd}
            step={1000}
            format={(n) => `US$${Math.round(n).toLocaleString("en-US")}`}
            value={params.capexPerUnitUsdOverride}
            onChange={(n) => setParams((p) => ({ ...p, capexPerUnitUsdOverride: n }))}
          />
          {params.quantityOverride !== undefined &&
            computedQuantity !== null &&
            params.quantityOverride < computedQuantity && (
              <p className="rounded-md border-l-2 border-caution bg-caution/5 px-3 py-2 text-xs">
                Парк меньше расчётного закрывает не всю работу объекта, поэтому и экономия ниже
                — модель уменьшает её пропорционально покрытию, а не оставляет прежней.
              </p>
            )}
        </div>
      </CardContent>
    </Card>
  );
}
