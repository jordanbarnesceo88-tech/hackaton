"use client";

import { useState } from "react";
import { FacilityVisualization } from "@/components/facility-visualization";
import { ParamsForm } from "@/components/calculator/params-form";
import { ResultsPanel } from "@/components/calculator/results-panel";
import { AssumptionsPanel } from "@/components/calculator/assumptions-panel";
import { SaveControl } from "@/components/calculator/save-control";
import { RecommendationPanel } from "@/components/calculator/recommendation-panel";
import { SensitivityChart } from "@/components/calculator/sensitivity-chart";
import { HeroResults } from "@/components/calculator/hero-results";
import { BreakEvenNote } from "@/components/calculator/break-even-note";
import { mapKind } from "@/lib/scene/layout";
import { computeEconomics } from "@/lib/economics/calculate";
import { toSolutionCapacity } from "@/lib/economics/normalize";
import { detectUnitMismatch } from "@/lib/economics/commensurability";
import { isCalculable } from "@/lib/economics/types";
import { rankSolutions, type SiblingSolution } from "@/lib/economics/recommend";
import { sensitivity } from "@/lib/economics/sensitivity";
import { REGION_PRESETS, regionLaborCostUsd } from "@/lib/economics/regions";
import { clampAssumption } from "@/lib/economics/assumptions";
import { formatCost } from "@/lib/format/currency";
import type { FacilityParams, AssumptionValues } from "@/lib/economics/types";

export type DefaultedParamField = "area" | "ops" | "staff";

const DEFAULTED_PARAM_LABELS: Record<DefaultedParamField, string> = {
  area: "площадь",
  ops: "объём операций",
  staff: "персонал",
};

export function EconomicsCalculator({
  categorySolutions,
  initialSelectedId,
  initialAssumptions,
  facilitySlug,
  facilityTypeName,
  industryName,
  objectName,
  dataChanged,
  savedParamsBroken = false,
  initialParams,
  defaultedParams = [],
}: {
  categorySolutions: SiblingSolution[];
  initialSelectedId: string;
  initialAssumptions: AssumptionValues;
  facilitySlug: string;
  facilityTypeName: string;
  industryName: string;
  objectName: string | null;
  dataChanged: boolean;
  savedParamsBroken?: boolean;
  initialParams?: FacilityParams;
  /**
   * Поля объекта, которых человек не назвал (или назвал негодно) и на месте которых стоит
   * значение по умолчанию. Пустой массив — все числа его собственные.
   *
   * Подставлять умолчание молча нельзя: расчёт выглядит одинаково уверенно независимо от того,
   * чьи это числа, и человек уносит ответ на вопрос, которого не задавал.
   */
  defaultedParams?: DefaultedParamField[];
}) {
  const [selectedSolutionId, setSelectedSolutionId] = useState(initialSelectedId);
  // `?? categorySolutions[0]` assumed the list is never empty. It is non-empty in practice —
  // the page 404s before rendering if the solution does not exist, and a solution is always a
  // sibling of itself — but the assumption was unchecked, and an empty list would have thrown
  // a bare "cannot read property of undefined" from somewhere deep in the render.
  const primary =
    categorySolutions.find((s) => s.id === selectedSolutionId) ?? categorySolutions[0];

  const isStock = primary?.capacityBasis === "CONCURRENT_STOCK";
  const [params, setParams] = useState<FacilityParams>(
    initialParams ?? {
      areaM2: 1000,
      opsPerDay: 500,
      staffCount: 10,
      ...(isStock ? { peakConcurrent: 20 } : {}),
    }
  );
  const [assumptions, setAssumptions] = useState<AssumptionValues>(initialAssumptions);
  // Which region the labour rate came from, if any. Remembering the id — rather than inferring
  // it by matching the derived USD figure — is what lets the rate stay in sync: the wage is
  // cited in rubles, so editing «Курс USD→RUB» has to re-derive the dollar value. Without this
  // the assumption kept the dollars fixed and the implied wage drifted 22% at 110 ₽/$, which is
  // the very defect regions.ts was changed to remove, just reached in the other order.
  const [regionId, setRegionId] = useState<string | null>(null);
  const region = regionId ? REGION_PRESETS.find((r) => r.id === regionId) ?? null : null;
  // Clamped like every other write path. usdToRub may legitimately be as low as 1, and at that
  // rate the Москва preset derives 1076.55 — over laborCostPerHourUsd's max of 1000. Unclamped,
  // that rendered fine and then made every save fail with a generic «Ошибка сохранения»,
  // because validateAssumptions rejects out-of-range values.
  const derivedLabor = region
    ? clampAssumption("laborCostPerHourUsd", regionLaborCostUsd(region, assumptions.usdToRub))
    : null;
  // NOTE: `effectiveAssumptions` is what the whole subtree must read. `assumptions` is the raw
  // state and exists only for the setter — it can lag behind by exactly the region re-derivation
  // above. Passing the raw object to SaveControl persisted the pre-derivation labour rate, so a
  // user who picked a region, adjusted «Курс USD→RUB», then saved got a client-facing report
  // reporting 4 425 300 ₽ against the 2 267 100 ₽ they had just been looking at.
  const effectiveAssumptions =
    derivedLabor !== null && derivedLabor !== assumptions.laborCostPerHourUsd
      ? { ...assumptions, laborCostPerHourUsd: derivedLabor }
      : assumptions;

  /**
   * Editing either figure a region preset owns releases the region. Without this the derived
   * value would overwrite the user's own on the next render — the control fighting the person
   * using it — and the selector would keep naming a region whose numbers no longer applied.
   * Editing anything else (the horizon, the discount rate) keeps the region, so a later change
   * to «Курс USD→RUB» still re-derives the wage from its ruble citation.
   */
  const setAssumptionsAndReleaseRegion: typeof setAssumptions = (update) => {
    // Computed in the handler, not inside the updater. A state updater must be pure — React
    // runs it during render, double-invokes it in StrictMode and re-runs it when rebasing — so
    // calling setRegionId from within it was a render-phase update of a sibling atom. It happens
    // to be idempotent today, which is exactly the kind of thing that stops being true later.
    // `effectiveAssumptions` already carries the derivation, so `prev` is not needed.
    const base = effectiveAssumptions;
    const next = typeof update === "function" ? update(base) : update;
    if (
      next.laborCostPerHourUsd !== base.laborCostPerHourUsd ||
      next.energyCostFactor !== base.energyCostFactor
    ) {
      setRegionId(null);
    }
    setAssumptions(next);
  };

  // After every hook: an early return above would change the hook order between renders,
  // which is what the rules-of-hooks lint (now failing the build) exists to catch.
  if (!primary) {
    return (
      <p className="text-sm text-muted-foreground">
        Для этой категории нет решений для расчёта.
      </p>
    );
  }

  const capacity = toSolutionCapacity(primary);

  const result = computeEconomics(capacity, params, effectiveAssumptions);
  // Соседи сравниваются БЕЗ переопределений. Переопределение — суждение о конкретном
  // решении: «этому роботу я поставлю четыре штуки по своей цене». Применять его ко всем
  // соседям значит ранжировать их по числу, которое к ним не относится, — и рекомендация
  // сверху начинает опираться на чужую введённую руками цифру.
  const rankingParams = {
    ...params,
    quantityOverride: undefined,
    capexPerUnitUsdOverride: undefined,
  };
  const ranked = rankSolutions(categorySolutions, rankingParams, effectiveAssumptions);
  const bars = sensitivity(capacity, params, effectiveAssumptions);

  // Единица производительности решения не сопоставима с «операцией объекта», и здесь это
  // видно в ответе. Молчать нельзя: число выглядит одинаково уверенно независимо от того,
  // сравнивали мы сопоставимые величины или нет.
  const mismatch = isCalculable(result)
    ? detectUnitMismatch(capacity, params, effectiveAssumptions, result.quantity)
    : null;

  return (
    <div className="flex flex-col gap-6">
      {/* Header lives here (not the server page) so the title/vendor follow an in-place switch. */}
      <div>
        <h1>
          Расчёт экономики: {primary.name}
          {objectName ? ` — объект «${objectName}»` : ""}
        </h1>
        <p className="text-sm text-muted-foreground">
          {primary.vendor} · {facilityTypeName} ({industryName})
        </p>
        {primary.priceEstimated && primary.priceLowUsd != null && primary.priceHighUsd != null && (
          <p className="text-xs text-caution">
            оценка цены: {formatCost(primary.priceLowUsd, effectiveAssumptions.usdToRub)}–
            {formatCost(primary.priceHighUsd, effectiveAssumptions.usdToRub)} · CAPEX по середине диапазона
            {primary.sourceUrl ? (
              <>
                {" "}
                <a href={primary.sourceUrl} target="_blank" rel="noopener noreferrer" className="tap-target underline">
                  источник ↗
                </a>
              </>
            ) : null}
          </p>
        )}
      </div>
      {defaultedParams.length > 0 && (
        <div className="rounded-md border border-caution/40 bg-caution/10 px-4 py-3 text-sm text-caution">
          Не задано:{" "}
          {defaultedParams.map((f) => DEFAULTED_PARAM_LABELS[f]).join(", ")} — здесь стоят
          значения по умолчанию, а не ваши. Пока это так, числа ниже — пример, а не оценка
          вашего объекта.
        </div>
      )}
      {mismatch && (
        <div className="rounded-md border border-caution/40 bg-caution/10 px-4 py-3 text-sm text-caution">
          {mismatch.kind === "fleet" ? (
            <>
              Расчёт требует <b>{mismatch.quantity}</b> единиц этого решения на один объект. Это
              признак того, что его производительность измеряется в{" "}
              <b>{primary.capacityUnit}</b>, а объём работы объекта — в операциях, и модель
              сравнивает их напрямую.
            </>
          ) : (
            <>
              Одна единица этого решения покрывает работу объекта примерно в{" "}
              <b>{Math.round(mismatch.ratio)}</b> раз больше, чем её есть. Это признак того, что
              его производительность измеряется в <b>{primary.capacityUnit}</b>, а объём работы
              объекта — в операциях, и модель сравнивает их напрямую.
            </>
          )}{" "}
          Числа ниже посчитаны верно по своей формуле, но сопоставлять их с другими решениями
          нельзя: у этого решения другая мерка работы. Мы это знаем и чиним — до тех пор
          показываем предупреждение, а не тихий результат.
        </div>
      )}
      {savedParamsBroken && (
        <div className="rounded-md border border-caution/40 bg-caution/10 px-4 py-3 text-sm text-caution">
          Параметры объекта из сохранённого расчёта восстановить не удалось — показаны обычные
          значения по умолчанию, а не ваши. Проверьте их перед тем, как опираться на цифры.
        </div>
      )}
      {dataChanged && (
        <div className="rounded-md border border-caution/40 bg-caution/10 px-4 py-3 text-sm text-caution">
          Данные решения или модель расчёта изменились с момента сохранения — показан пересчёт по
          актуальным данным, он может отличаться от сохранённого.
        </div>
      )}
      <div className="grid gap-6 md:grid-cols-2">
      <HeroResults
        result={result}
        usdToRub={effectiveAssumptions.usdToRub}
        priceEstimated={primary.priceEstimated}
      />
      <BreakEvenNote
        capacity={capacity}
        params={params}
        assumptions={effectiveAssumptions}
        result={result}
      />
      <ParamsForm
        params={params}
        setParams={setParams}
        capacity={capacity}
        capacityUnit={primary.capacityUnit}
        assumptions={effectiveAssumptions}
        usdToRub={effectiveAssumptions.usdToRub}
        selectedRegionId={regionId}
        onClearRegion={() => {
          // Commit what is on screen before detaching. `effectiveAssumptions` carries the
          // rate-derived labour cost; the raw state still holds whatever it was when the region
          // was picked. Dropping the region without committing reverted the labour rate — and
          // every figure derived from it — to a value the user had not seen since they changed
          // the exchange rate. Detaching a preset should keep your numbers, not rewind them.
          setAssumptions(effectiveAssumptions);
          setRegionId(null);
        }}
        onPickRegion={(id, labor, energyFactor) => {
          setRegionId(id);
          setAssumptions((prev) => ({
            ...prev,
            laborCostPerHourUsd: labor,
            energyCostFactor: energyFactor,
          }));
        }}
      />
      <ResultsPanel result={result} usdToRub={effectiveAssumptions.usdToRub} />
      <RecommendationPanel
        ranked={ranked}
        selectedId={selectedSolutionId}
        usdToRub={effectiveAssumptions.usdToRub}
        onSelect={(id) => {
          // Переопределения не переезжают на другое решение. Иначе цена, введённая для
          // одного робота, молча применяется к другому, а поле продолжает утверждать
          // «задано вами» — то есть пометка, ради которой всё делалось, начинает врать.
          setSelectedSolutionId(id);
          setParams((p) => ({
            ...p,
            quantityOverride: undefined,
            capexPerUnitUsdOverride: undefined,
          }));
        }}
      />
      <SensitivityChart bars={bars} usdToRub={effectiveAssumptions.usdToRub} />
      <SaveControl
        facilitySlug={facilitySlug}
        solutionId={selectedSolutionId}
        params={params}
        assumptions={effectiveAssumptions}
        result={result}
      />
      <AssumptionsPanel
        assumptions={effectiveAssumptions}
        setAssumptions={setAssumptionsAndReleaseRegion}
        capacityBasis={primary.capacityBasis}
        workloadStream={primary.workloadStream}
      />
      <FacilityVisualization
        facilityKind={mapKind(facilitySlug)}
        params={params}
        assumptions={effectiveAssumptions}
        capacity={capacity}
        capacityUnit={primary.capacityUnit}
        result={result}
      />
      </div>
    </div>
  );
}
