import Link from "next/link";
import { notFound } from "next/navigation";
import { getCatalogForFacilityType, getAssumptions } from "@/lib/db/queries";
import { formatCost } from "@/lib/format/currency";
import { capacityPerYear } from "@/lib/economics/normalize";
import { assumptionsToValues } from "@/lib/economics/assumptions";
import type { AssumptionValues, CapacityBasis } from "@/lib/economics/types";

const BASIS_LABEL: Record<CapacityBasis, string> = {
  PER_HOUR_FLOW: "поток/час",
  PER_DAY_FLOW: "поток/сутки",
  CONCURRENT_STOCK: "одновременно",
};

type SolutionRow = {
  id: string;
  name: string;
  vendor: string;
  priceUsd: number;
  capacityPerUnit: number;
  capacityUnit: string;
  capacityBasis: CapacityBasis;
  maintenanceUsdYear: number;
  energyUsdYear: number;
  licensingUsdYear: number;
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
}: {
  params: Promise<{ type: string }>;
}) {
  const { type } = await params;
  const [catalog, assumptionRows] = await Promise.all([
    getCatalogForFacilityType(type),
    getAssumptions(),
  ]);

  if (!catalog) {
    notFound();
  }

  const a = assumptionsToValues(assumptionRows);
  const money = (usd: number) => formatCost(usd, a.usdToRub);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8 py-12">
      <div>
        <h1 className="text-2xl font-semibold">
          Сравнение решений: {catalog.name} ({catalog.industry.name})
        </h1>
        <p className="text-sm text-muted-foreground">
          Показатели по каждому типу решений — цена, полный OPEX и нормированная стоимость
          единицы годовой производительности. Нормировка использует допущения по умолчанию.
        </p>
      </div>

      {catalog.solutionCategories.map((category) => (
        <section key={category.id} className="flex flex-col gap-3">
          <div>
            <h2 className="text-xl font-medium">{category.name}</h2>
            <p className="text-sm text-muted-foreground">{category.description}</p>
          </div>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full border-collapse text-sm">
              <thead className="border-b bg-muted/50 text-muted-foreground">
                <tr>
                  <Th>Решение</Th>
                  <Th className="text-right">Цена</Th>
                  <Th>Производительность</Th>
                  <Th className="text-right">Годовая произв.</Th>
                  <Th className="text-right">Обслуж./год</Th>
                  <Th className="text-right">Энергия/год</Th>
                  <Th className="text-right">Лицензии/год</Th>
                  <Th className="text-right">OPEX/год</Th>
                  <Th className="text-right">Цена за ед./год</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {category.solutions.map((s) => {
                  const opex = s.maintenanceUsdYear + s.energyUsdYear + s.licensingUsdYear;
                  const annual = annualThroughput(s as SolutionRow, a);
                  const normPrice = annual && annual > 0 ? s.priceUsd / annual : null;
                  return (
                    <tr key={s.id} className="border-b last:border-0">
                      <Td>
                        <div className="font-medium">{s.name}</div>
                        <div className="text-xs text-muted-foreground">{s.vendor}</div>
                      </Td>
                      <Td className="text-right whitespace-nowrap">{money(s.priceUsd)}</Td>
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
                      <Td className="text-right whitespace-nowrap">{money(s.maintenanceUsdYear)}</Td>
                      <Td className="text-right whitespace-nowrap">{money(s.energyUsdYear)}</Td>
                      <Td className="text-right whitespace-nowrap">{money(s.licensingUsdYear)}</Td>
                      <Td className="text-right whitespace-nowrap font-medium">{money(opex)}</Td>
                      <Td className="text-right whitespace-nowrap">
                        {normPrice === null ? "—" : money(normPrice)}
                      </Td>
                      <Td>
                        <Link
                          href={`/calculate/${s.id}`}
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
