import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { getSavedAnalysis, getSolutionForCalc } from "@/lib/db/queries";
import { computeEconomics } from "@/lib/economics/calculate";
import { withAssumptionDefaults } from "@/lib/economics/assumptions";
import { toSolutionCapacity } from "@/lib/economics/normalize";
import { sensitivity } from "@/lib/economics/sensitivity";
import { resultsDiverged } from "@/lib/analyses/diverged";
import { isCalculable } from "@/lib/economics/types";
import { formatCost } from "@/lib/format/currency";
import { formatYearsRu } from "@/lib/format/plural";
import { SensitivityChart } from "@/components/calculator/sensitivity-chart";
import { ProvenanceBadge } from "@/components/provenance-badge";
import { PrintButton } from "@/components/report/print-button";
import type { FacilityParams } from "@/lib/economics/types";

export default async function ReportPage({
  params,
}: {
  params: Promise<{ analysisId: string }>;
}) {
  const { analysisId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const saved = await getSavedAnalysis(analysisId, session.user.id);
  if (!saved) notFound();

  const solution = await getSolutionForCalc(saved.solutionId);
  if (!solution) notFound();

  const p = saved.params as FacilityParams;
  // Backfill defaults so a pre-existing saved analysis (missing a newer assumption like
  // energyCostFactor) doesn't recompute to NaN/invalid in the report.
  const a = withAssumptionDefaults(saved.assumptions);
  const capacity = toSolutionCapacity(solution);
  const result = computeEconomics(capacity, p, a);
  const bars = sensitivity(capacity, p, a);
  const dataChanged = resultsDiverged(saved.results, result);
  const money = (usd: number) => formatCost(usd, a.usdToRub);
  const hasNumbers = isCalculable(result);
  const ft = solution.solutionCategory.facilityType;

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="no-print mb-4 flex justify-end">
        <PrintButton />
      </div>

      <header className="border-b-2 border-primary pb-3">
        <div className="text-xs font-medium uppercase tracking-wide text-primary">
          Robotization ROI
        </div>
        <h1 className="text-2xl font-semibold">Отчёт ROI: {saved.name}</h1>
        <div className="text-xs text-muted-foreground">
          Сформировано {new Date().toLocaleDateString("ru-RU")}
        </div>
      </header>

      <section className="report-block mt-4">
        <h2 className="text-sm font-semibold text-muted-foreground">Объект и решение</h2>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
          <span>{ft.name} ({ft.industry.name})</span>
          <span>·</span>
          <b>{solution.name}</b>
          <span className="text-muted-foreground">{solution.vendor}</span>
          <ProvenanceBadge source={solution.source} sourceUrl={solution.sourceUrl} />
        </div>
      </section>

      <section className="report-block mt-4">
        <h2 className="text-sm font-semibold text-muted-foreground">Параметры и допущения</h2>
        <div className="mt-1 grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
          <div>Площадь: {p.areaM2} м²</div>
          <div>Стоимость труда: {money(a.laborCostPerHourUsd)}/час</div>
          <div>Операций в сутки: {p.opsPerDay}</div>
          <div>Замещение труда: {(a.laborReplacementPct * 100).toFixed(0)}%</div>
          <div>Остаточный надзор: {(a.residualSupervisionPct * 100).toFixed(0)}%</div>
          <div>Персонал (замещаемый): {p.staffCount}</div>
          <div>Ставка дисконтирования: {(a.discountRate * 100).toFixed(0)}%</div>
          <div>Горизонт ROI: {a.roiHorizonYears} лет</div>
          <div>Срок службы техники: {a.assetLifeYears} лет</div>
        </div>
      </section>

      <section className="report-block mt-4">
        <h2 className="text-sm font-semibold text-muted-foreground">Экономика</h2>
        {!hasNumbers ? (
          <div className="mt-1 text-sm text-muted-foreground">Проверьте параметры расчёта</div>
        ) : (
          <div className="mt-1 grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
            <div>Требуется единиц: <b>{result.quantity}</b></div>
            <div>Замещается персонала (ЭПЗ): <b>{result.displacedFte.toFixed(1)}</b></div>
            <div>CAPEX: <b>{money(result.capexUsd)}</b></div>
            <div>OPEX/год: <b>{money(result.opexAnnualUsd)}</b></div>
            <div>Базовые затраты на труд/год: <b>{money(result.baselineAnnualUsd)}</b></div>
            {result.economical ? (
              <>
                <div>Годовая экономия: <b>{money(result.annualSavingsUsd)}</b></div>
                <div>Срок окупаемости (простой): <b>{formatYearsRu(result.simplePaybackYears)}</b></div>
                <div>
                  Срок окупаемости (дисконт.):{" "}
                  <b>
                    {result.discountedPaybackYears === null
                      ? "не окупается в пределах горизонта"
                      : formatYearsRu(result.discountedPaybackYears)}
                  </b>
                </div>
                <div>ROI (простой): <b>{result.simpleRoiPct.toFixed(0)}%</b></div>
                <div>NPV: <b>{money(result.npvUsd)}</b></div>
              </>
            ) : (
              <div className="col-span-2 font-medium text-destructive">
                Решение не окупается при текущих параметрах
              </div>
            )}
          </div>
        )}
        {solution.priceEstimated &&
          solution.priceLowUsd != null &&
          solution.priceHighUsd != null && (
            <p className="mt-1 text-xs text-amber-700">
              Оценка цены: {money(solution.priceLowUsd)}–{money(solution.priceHighUsd)} · CAPEX по
              середине диапазона.
            </p>
          )}
      </section>

      {bars.length > 0 && (
        <section className="report-block mt-4">
          <SensitivityChart bars={bars} usdToRub={a.usdToRub} />
        </section>
      )}

      <footer className="mt-6 border-t pt-3 text-xs text-muted-foreground">
        {dataChanged && (
          <p className="mb-1 text-amber-700">
            Данные решения или модель расчёта изменились с момента сохранения — показатели
            пересчитаны по актуальным данным.
          </p>
        )}
        {solution.source === "PARSED" && solution.sourceUrl && (
          <p>
            Источник данных о решении:{" "}
            <a href={solution.sourceUrl} className="underline">{solution.sourceUrl}</a>
          </p>
        )}
        <p>
          Показатели — независимая оценка по открытым данным; цены — оценочные диапазоны, не
          оферта. Проверьте перед принятием решения.
        </p>
      </footer>
    </div>
  );
}
