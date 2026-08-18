import { notFound } from "next/navigation";
import { getCatalogForFacilityType } from "@/lib/db/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCost } from "@/lib/format/currency";

export default async function ComparePage({
  params,
}: {
  params: Promise<{ type: string }>;
}) {
  const { type } = await params;
  const catalog = await getCatalogForFacilityType(type);

  if (!catalog) {
    notFound();
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 py-12">
      <h1 className="text-2xl font-semibold">
        Решения для объекта: {catalog.name} ({catalog.industry.name})
      </h1>

      {catalog.solutionCategories.map((category) => (
        <section key={category.id} className="flex flex-col gap-4">
          <h2 className="text-xl font-medium">{category.name}</h2>
          <p className="text-sm text-muted-foreground">{category.description}</p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {category.solutions.map((solution) => (
              <Card key={solution.id}>
                <CardHeader>
                  <CardTitle>{solution.name}</CardTitle>
                  <p className="text-sm text-muted-foreground">{solution.vendor}</p>
                </CardHeader>
                <CardContent className="flex flex-col gap-1 text-sm">
                  <div>Цена: {formatCost(solution.priceUsd)}</div>
                  <div>
                    Производительность: {solution.capacityPerUnit} {solution.capacityUnit}
                  </div>
                  <div>
                    Обслуживание/год: {formatCost(solution.maintenanceUsdYear)}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
