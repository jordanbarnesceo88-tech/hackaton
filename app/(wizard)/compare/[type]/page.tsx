import Link from "next/link";
import { notFound } from "next/navigation";
import { getCatalogForFacilityType, getAssumptions } from "@/lib/db/queries";
import { formatCost } from "@/lib/format/currency";
import { capacityPerYear } from "@/lib/economics/normalize";
import { assumptionsToValues } from "@/lib/economics/assumptions";
import { computeEconomics } from "@/lib/economics/calculate";
import { toSolutionCapacity } from "@/lib/economics/normalize";
import { isCalculable } from "@/lib/economics/types";
import { formatYearsRu } from "@/lib/format/plural";
import { parseWizardParams, buildWizardQuery } from "@/lib/wizard/steps";
import { ProvenanceBadge } from "@/components/provenance-badge";
import { BestSolution, type Candidate } from "@/components/calculator/best-solution";
import type { AssumptionValues, CapacityBasis, WorkloadStream } from "@/lib/economics/types";

const BASIS_LABEL: Record<CapacityBasis, string> = {
  PER_HOUR_FLOW: "поток/час",
  PER_DAY_FLOW: "поток/сутки",
  CONCURRENT_STOCK: "одновременно",
};

type SolutionRow = {
  id: string;
  name: string;
  vendor: string;
  // Спускается с категории в getCatalogForFacilityType: движок принимает поток на решении.
  workloadStream: WorkloadStream;
  isClass: boolean;
  priceUsd: number;
  capacityPerUnit: number;
  capacityUnit: string;
  capacityBasis: CapacityBasis;
  maintenanceUsdYear: number;
  energyUsdYear: number;
  licensingUsdYear: number;
  priceEstimated: boolean;
  priceLowUsd: number | null;
  priceHighUsd: number | null;
  priceBasis: string | null;
};

// Normalized comparison metrics. Annualized throughput and price-per-annual-unit are only
// meaningful for flow bases (per-hour / per-day); CONCURRENT_STOCK is a stock, not a flow, so
// we abstain (—) rather than print a misleading number. Uses the DB assumption constants
// (operating hours/day, working days/year) so every row is normalized on the same basis.
function annualThroughput(s: SolutionRow, a: AssumptionValues): number | null {
  if (s.capacityBasis === "CONCURRENT_STOCK") return null;
  return capacityPerYear(
    { ...s, capacityBasis: s.capacityBasis, capacityPerUnit: s.capacityPerUnit },
    a
  );
}

function Th({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-medium ${className}`}>{children}</th>;
}
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 align-top ${className}`}>{children}</td>;
}

export default async function ComparePage({
  params,
  searchParams,
}: {
  params: Promise<{ type: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { type } = await params;
  const sp = await searchParams;
  const wizard = parseWizardParams(sp);
  const [catalog, assumptionRows] = await Promise.all([
    getCatalogForFacilityType(type),
    getAssumptions(),
  ]);

  if (!catalog) {
    notFound();
  }

  const a = assumptionsToValues(assumptionRows);
  const money = (usd: number) => formatCost(usd, a.usdToRub);
  const objectName = wizard.objectName;

  // Весь набор подбора уезжает в расчёт, а не только название объекта: шаг 5 обязан
  // стартовать с ТЕХ ЖЕ входов, на которых посчитан этот список, иначе первое число там не
  // совпадёт с числом здесь, и человек справедливо перестанет верить обоим.
  const calcQuery = buildWizardQuery({
    industry: wizard.industry,
    facility: type,
    objectName,
    params: wizard.complete ? wizard.params : null,
  });
  const calcSuffix = calcQuery ? `?${calcQuery}` : "";

  /**
   * Экономика решения под параметры объекта.
   *
   * Считается на DEFAULT_ASSUMPTIONS из БД, без пользовательских правок — правки допущений
   * живут на шаге расчёта. Это не деталь реализации, а условие паритета между экранами.
   */
  const economicsFor = (s: SolutionRow) =>
    wizard.complete ? computeEconomics(toSolutionCapacity(s), wizard.params, a) : null;

  // Кандидаты собираются по всем категориям сразу: человек спрашивал «что окупится у меня»,
  // а не «что лучшее среди AS/RS». Деление на категории — способ разложить таблицу, а не
  // граница, внутри которой имеет смысл выбирать.
  const candidates: Candidate[] = wizard.complete
    ? catalog.solutionCategories.flatMap((c) =>
        c.solutions.map((s) => ({
          id: s.id,
          name: s.name,
          vendor: s.vendor,
          isClass: s.isClass,
          result: computeEconomics(toSolutionCapacity(s as SolutionRow), wizard.params, a),
        }))
      )
    : [];

  const paramsHref = `/onboarding/params?${buildWizardQuery({
    industry: wizard.industry,
    facility: type,
    objectName,
    params: wizard.complete ? wizard.params : null,
  })}`;

  return (
    <div className="surface-data flex flex-col gap-8 py-12">
      <div>
        <h1>
          Сравнение решений: {objectName ? `«${objectName}»` : catalog.name} ({catalog.industry.name})
        </h1>
        <p className="text-sm text-muted-foreground">
          {wizard.complete
            ? "Окупаемость и NPV — верхняя граница: расчёт предполагает, что решение закрывает работу всего заявленного вами персонала. В расчёте это число можно сузить до тех, кто действительно занят работой этого решения, и цифры станут вашими. Отсортировано по NPV."
            : "Показатели по каждому типу решений — цена, полный OPEX и нормированная стоимость единицы годовой производительности. Нормировка использует допущения по умолчанию."}
        </p>
      </div>

      {wizard.complete && (
        <BestSolution
          candidates={candidates}
          usdToRub={a.usdToRub}
          calcHref={(id) => `/calculate/${id}${calcSuffix}`}
          backHref={paramsHref}
        />
      )}

      {catalog.solutionCategories.map((category) => (
        <section key={category.id} className="flex flex-col gap-3">
          <div>
            <h2>{category.name}</h2>
            <p className="text-sm text-muted-foreground">{category.description}</p>
          </div>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full border-collapse text-sm">
              <thead className="border-b bg-muted/50 text-muted-foreground">
                <tr>
                  {/* Порядок колонок — это порядок вопросов, а не порядок происхождения
                      данных. Окупаемость и NPV стояли одиннадцатыми из двенадцати и уезжали
                      за правый край, пока подпись над таблицей обещала сортировку по NPV.
                      Остальное нужно тому, кто копает, и стоит после ответа. */}
                  <Th>Решение</Th>
                  {wizard.complete && <Th className="text-right">Окупаемость</Th>}
                  {wizard.complete && <Th className="text-right">NPV</Th>}
                  {wizard.complete && <Th className="text-right">Единиц</Th>}
                  <Th className="text-right">Цена</Th>
                  <Th>Производительность</Th>
                  <Th className="text-right">Годовая произв.</Th>
                  <Th className="text-right">OPEX/год</Th>
                  <Th className="text-right">Обслуж./год</Th>
                  <Th className="text-right">Энергия/год</Th>
                  <Th className="text-right">Лицензии/год</Th>
                  <Th className="text-right">Цена за 1000 ед./год</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {[...category.solutions]
                  .sort((x, y) => {
                    // Пока параметров нет, порядок остаётся алфавитным: ранжировать по цене
                    // за абстрактную единицу — это ранжировать по числу, которое ничего не
                    // говорит про объект, и лучше не делать вид, что список отсортирован.
                    if (!wizard.complete) return 0;
                    const rx = economicsFor(x as SolutionRow);
                    const ry = economicsFor(y as SolutionRow);
                    // NPV есть только у экономичного варианта: «нет экономии» и «некорректные
                    // входные» его не несут, и это разные вещи, а не отсутствие числа.
                    const npv = (r: ReturnType<typeof economicsFor>) =>
                      r && isCalculable(r) && r.economical ? r.npvUsd : -Infinity;
                    return npv(ry) - npv(rx);
                  })
                  .map((s) => {
                  const opex = s.maintenanceUsdYear + s.energyUsdYear + s.licensingUsdYear;
                  const economics = economicsFor(s as SolutionRow);
                  const calculable = economics && isCalculable(economics) ? economics : null;
                  // Ещё один шаг сужения: «нет экономии» — это тоже посчитанный результат, у
                  // него есть количество единиц, но нет ни NPV, ни срока окупаемости. Показать
                  // прочерк там, где ответ «не окупается», значило бы скрыть вывод.
                  const viable = calculable && calculable.economical ? calculable : null;
                  const annual = annualThroughput(s as SolutionRow, a);
                  // Per 1000 units of annual throughput: the per-unit figure is sub-dollar for
                  // high-throughput solutions and would round to "US$0" under the whole-unit
                  // money formatter, making the headline comparison metric useless.
                  const normPrice = annual && annual > 0 ? (s.priceUsd * 1000) / annual : null;
                  return (
                    <tr key={s.id} className="border-b last:border-0">
                      <Td>
                        <div className="font-medium">{s.name}</div>
                        <div className="text-xs text-muted-foreground">{s.vendor}</div>
                        <div className="mt-1">
                          <ProvenanceBadge source={s.source} sourceUrl={s.sourceUrl} isClass={s.isClass} />
                        </div>
                      </Td>
                      {wizard.complete && (
                        <Td className="text-right whitespace-nowrap font-medium">
                          {!calculable
                            ? "—"
                            : !viable || viable.discountedPaybackYears === null
                              ? "не окупается"
                              : formatYearsRu(viable.discountedPaybackYears)}
                        </Td>
                      )}
                      {wizard.complete && (
                        <Td className="text-right whitespace-nowrap font-medium">
                          {viable ? money(viable.npvUsd) : "—"}
                        </Td>
                      )}
                      {wizard.complete && (
                        <Td className="text-right whitespace-nowrap">
                          {calculable ? calculable.quantity : "—"}
                        </Td>
                      )}
                      <Td className="text-right whitespace-nowrap">
                        {s.priceEstimated && s.priceLowUsd != null && s.priceHighUsd != null ? (
                          <span title={s.priceBasis ?? undefined}>
                            {money(s.priceLowUsd)}–{money(s.priceHighUsd)}{" "}
                            <sup className="text-[10px] text-caution">оценка</sup>
                          </span>
                        ) : (
                          money(s.priceUsd)
                        )}
                      </Td>
                      <Td className="whitespace-nowrap">
                        {s.capacityPerUnit} {s.capacityUnit}
                        <div className="text-xs text-muted-foreground">
                          {BASIS_LABEL[s.capacityBasis]}
                        </div>
                      </Td>
                      <Td className="text-right whitespace-nowrap">
                        {annual === null
                          ? "—"
                          : `${annual.toLocaleString("ru-RU")} ${s.capacityUnit.split("/")[0]}/год`}
                      </Td>
                      <Td className="text-right whitespace-nowrap font-medium">{money(opex)}</Td>
                      <Td className="text-right whitespace-nowrap">{money(s.maintenanceUsdYear)}</Td>
                      <Td className="text-right whitespace-nowrap">{money(s.energyUsdYear)}</Td>
                      <Td className="text-right whitespace-nowrap">{money(s.licensingUsdYear)}</Td>
                      <Td className="text-right whitespace-nowrap">
                        {normPrice === null ? "—" : money(normPrice)}
                      </Td>
                      <Td>
                        <Link
                          href={`/calculate/${s.id}${calcSuffix}`}
                          className="whitespace-nowrap text-sm font-medium underline underline-offset-4"
                        >
                          Рассчитать →
                        </Link>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
