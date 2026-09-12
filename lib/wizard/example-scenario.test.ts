import { describe, it, expect } from "vitest";
import { EXAMPLE_PARAMS, EXAMPLE_FACILITY, exampleHref } from "./example-scenario";
import { parseWizardParams } from "./steps";
import { APPLICABILITY } from "@/scripts/seed-data/applicability";
import { CATEGORIES } from "@/scripts/seed-data/categories";
import { SOLUTION_CLASSES } from "@/scripts/seed-data/solution-classes";
import { WAREHOUSE_REAL } from "@/scripts/parse-sources/warehouse-real";
import { DEFAULT_ASSUMPTIONS } from "@/lib/economics/assumptions";
import { computeEconomics } from "@/lib/economics/calculate";
import { detectUnitMismatch } from "@/lib/economics/commensurability";
import { isViable } from "@/lib/economics/types";

describe("готовый пример", () => {
  it("состояние подбора полное — иначе пример считался бы по умолчаниям", () => {
    // Ровно та ошибка, ради которой заведён `provided`: неполный набор молча подставляет
    // 1000/500/10, и «пример» показывал бы числа не того объекта.
    const q = new URLSearchParams(exampleHref().split("?")[1]);
    const state = parseWizardParams(Object.fromEntries(q));
    expect(state.complete).toBe(true);
    expect(state.rejected).toEqual([]);
    expect(state.params.areaM2).toBe(EXAMPLE_PARAMS.areaM2);
    expect(state.params.staffCount).toBe(EXAMPLE_PARAMS.staffCount);
  });

  it("занятость доезжает целиком", () => {
    const q = new URLSearchParams(exampleHref().split("?")[1]);
    const state = parseWizardParams(Object.fromEntries(q));
    expect(state.params.taskStaffing).toEqual(EXAMPLE_PARAMS.taskStaffing);
  });

  it("каждая задача примера применима к его типу объекта", () => {
    // Р-4 на входе демонстрации: посторонний ключ отфильтруется на экране занятости, и поле
    // молча опустеет — пример начнёт показывать отказ вместо расчёта.
    const applicable = new Set(
      APPLICABILITY.find((l) => l.facilityType === EXAMPLE_FACILITY)!.categories
    );
    for (const slug of Object.keys(EXAMPLE_PARAMS.taskStaffing ?? {})) {
      expect(applicable.has(slug), `${slug} неприменим к ${EXAMPLE_FACILITY}`).toBe(true);
    }
  });

  it("сумма занятостей не превышает штат — иначе экран покажет ошибку ввода", () => {
    const sum = Object.values(EXAMPLE_PARAMS.taskStaffing ?? {}).reduce((s, n) => s + n, 0);
    expect(sum).toBeLessThanOrEqual(EXAMPLE_PARAMS.staffCount);
    // И остаток должен быть содержательным: строка «остальные N не роботизируем» — половина
    // смысла примера, и при N = 0 она исчезает.
    expect(EXAMPLE_PARAMS.staffCount - sum).toBeGreaterThan(0);
  });
});

describe("пример обязан оставаться убедительным", () => {
  // Демонстрация — не украшение: это единственный путь, по которому судья увидит числа, не
  // набрав ни символа. Если после правки каталога она перестанет считаться или начнёт
  // показывать предупреждения о несопоставимой мерке, узнать об этом надо здесь, а не на показе.
  const a = DEFAULT_ASSUMPTIONS;
  const cats = APPLICABILITY.find((l) => l.facilityType === EXAMPLE_FACILITY)!.categories.map(
    (slug) => CATEGORIES.find((c) => c.slug === slug)!
  );
  const solutions = [
    ...SOLUTION_CLASSES.map((c) => ({
      name: c.name,
      categorySlug: c.categorySlug,
      priceUsd: Math.round((c.priceLowUsd + c.priceHighUsd) / 2),
      capacityPerUnit: Math.round((c.capacityLow + c.capacityHigh) / 2),
      capacityBasis: c.capacityBasis,
      maintenanceUsdYear: c.maintenanceUsdYear,
      energyUsdYear: c.energyUsdYear,
      licensingUsdYear: c.licensingUsdYear,
    })),
    ...WAREHOUSE_REAL.map((s) => ({
      name: s.name,
      categorySlug: s.categorySlug as string,
      priceUsd: s.priceUsd,
      capacityPerUnit: s.capacityPerUnit,
      capacityBasis: s.capacityBasis,
      maintenanceUsdYear: s.maintenanceUsdYear,
      energyUsdYear: s.energyUsdYear,
      licensingUsdYear: s.licensingUsdYear,
    })),
  ];

  const results = cats.flatMap((c) =>
    solutions
      .filter((s) => s.categorySlug === c.slug)
      .map((s) => {
        const cap = {
          ...s,
          workloadStream: c.workloadStream,
          categorySlug: c.slug,
          workerOutputPerYear: c.workerOutputPerYear ?? null,
        };
        const result = computeEconomics(cap, EXAMPLE_PARAMS, a);
        return { name: s.name, cap, result };
      })
  );

  it("считается целиком — ни одного отказа", () => {
    const refused = results.filter((x) => !("quantity" in x.result)).map((x) => x.name);
    expect(refused, `отказали: ${refused.join(", ")}`).toEqual([]);
  });

  it("хотя бы одно решение годно — иначе показывать нечего", () => {
    expect(results.some((x) => isViable(x.result))).toBe(true);
  });

  it("но НЕ всё подряд: инструмент, который всегда говорит «да», не убеждает", () => {
    expect(results.filter((x) => isViable(x.result)).length).toBeLessThan(results.length);
  });

  it("ни одной строки с несопоставимой меркой работы", () => {
    const flagged = results
      .filter((x) => "quantity" in x.result)
      .filter((x) =>
        detectUnitMismatch(x.cap, EXAMPLE_PARAMS, a, (x.result as { quantity: number }).quantity)
      )
      .map((x) => x.name);
    expect(flagged, `помечены: ${flagged.join(", ")}`).toEqual([]);
  });
});
