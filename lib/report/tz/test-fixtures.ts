import { baseValuesFor, paramSpecsFor } from "../../data/organizer/params";
import { SIM_MODEL_VERSION, type SimSummaryStored } from "../../sim/types";
import { buildConclusion, computeScenarios } from "../../tz/econ";
import { FIXTURE_CARRIER_P, FIXTURE_H1500, FIXTURE_PRODUCTS, fixtureContext, fixtureSpecs } from "../../tz/econ/fixtures";
import { processDef } from "../../tz/processes";
import { selectProducts } from "../../tz/selection";
import type { ComparisonRow, ParamSpec, ProjectResults, ScenarioResult, ScenarioSpec } from "../../tz/types";
import { TZ_MODEL_VERSION, dataVersionOf } from "../../tz/version";
import type { ReportChange } from "./rows";

/**
 * Фикстуры тестов выгрузок: результаты проекта, собранные настоящим движком экономики и подбора
 * на фикстурах T1.2 (склад организатора, цикл H1500 подставлен как 20 пал./ч — эталон T1.2).
 * Сценарии: «Как есть», покупка и услуга H1500, покупка DMR Carrier P, добавленная вручную
 * (проверка значка ⚠), и услуга Carrier P без ставки RaaS (проверка отказа).
 *
 * Сводки имитации — условные значения для проверки строк отчёта, а не результат прогона.
 */

/** Условная сводка имитации для тестов (не результат прогона). */
function simSummary(scenarioKey: string, over: Partial<SimSummaryStored>): SimSummaryStored {
  return {
    simModelVersion: SIM_MODEL_VERSION,
    seed: 1,
    scenarioKey,
    fleet: 10,
    requiredPerH: 129.5,
    achievedPerH: 128.1,
    servedShare: 0.99,
    fleetUtilPct: 71.2,
    assumedUtilPct: 77.5,
    idlePct: 18.3,
    chargingPct: 9.1,
    waitAtPointsPct: 1.4,
    queueMax: 4,
    waitP95Min: 3.2,
    verdict: "CONFIRMED",
    bottleneck: "none",
    oversized: false,
    minStableFleet: 9,
    fleetByNorm: 3,
    verdictByNorm: "NOT_CONFIRMED",
    durationMs: 0,
    ...over,
  };
}

function comparisonOf(results: readonly ScenarioResult[]): ComparisonRow[] {
  const out: ComparisonRow[] = [];
  for (const r of results) {
    if (r.kind !== "purchase" || r.status !== "ok") continue;
    for (const it of r.items) {
      const p = FIXTURE_PRODUCTS.find((x) => x.slug === it.productSlug);
      out.push({
        process: it.process,
        productSlug: it.productSlug,
        productName: it.productName,
        status: "candidate",
        manuallyAdded: it.manuallyAdded,
        payloadKg: p?.payloadKg ?? null,
        speedMps: p?.speedMps ?? null,
        thrNorm: it.thrNorm,
        thrCycle: it.thrCycle,
        thrEff: it.thrEff,
        autonomyH: p?.autonomyH ?? null,
        chargeMin: p?.chargeMin ?? null,
        minAisleM: p?.minAisleM ?? null,
        n: it.n,
        chargers: it.chargers,
        priceRub: p?.priceRub ?? null,
        capexPurchaseRub: r.capexRub,
        npvPurchaseRub: r.npvRub,
        paybackPurchaseYears: r.paybackYears,
        raasRubMonth: p?.raasRubMonth ?? null,
        completenessPct: p?.completenessPct ?? null,
      });
    }
  }
  return out;
}

/** Сценарии фикстуры: эталон T1.2 плюс ручное решение и отказ RaaS. */
export function fixtureScenarioSpecs(): ScenarioSpec[] {
  return [
    ...fixtureSpecs(FIXTURE_H1500),
    {
      key: "p2",
      name: `Покупка — ${FIXTURE_CARRIER_P.name}`,
      kind: "purchase",
      items: [
        {
          process: "pallet-transport",
          productSlug: FIXTURE_CARRIER_P.slug,
          manuallyAdded: true,
          manualReason: "проверка значка ручного добавления",
        },
      ],
    },
    {
      key: "r2",
      name: `Услуга (RaaS) — ${FIXTURE_CARRIER_P.name}`,
      kind: "raas",
      items: [{ process: "pallet-transport", productSlug: FIXTURE_CARRIER_P.slug }],
    },
  ];
}

/** Результаты проекта для тестов выгрузок (форма `ProjectResults`, как сохраняет проект). */
export function fixtureResults(): ProjectResults {
  const ctx = fixtureContext(20);
  const specs = fixtureScenarioSpecs();
  const results = computeScenarios(ctx, specs);
  const process = processDef("pallet-transport");
  if (!process) throw new Error("нет процесса pallet-transport");
  const selection = selectProducts({
    facility: "warehouse",
    params: ctx.params,
    process,
    products: FIXTURE_PRODUCTS,
    norms: ctx.norms,
  });
  const productSnapshots = { [FIXTURE_H1500.slug]: FIXTURE_H1500, [FIXTURE_CARRIER_P.slug]: FIXTURE_CARRIER_P };
  return {
    modelVersion: TZ_MODEL_VERSION,
    simModelVersion: SIM_MODEL_VERSION,
    dataVersion: dataVersionOf({ productSnapshots, normsUsed: ctx.norms }),
    calculatedAt: "2026-09-25T10:05:00.000Z",
    facility: "warehouse",
    // Полный набор параметров, как после applyDefaults: базовые значения организатора плюс то,
    // с чем считала экономика (ключи, которые экономика не читает, на результат не влияют).
    paramsUsed: { ...baseValuesFor("warehouse"), ...ctx.params },
    normsUsed: ctx.norms,
    productSnapshots,
    scenarios: specs,
    results,
    selection,
    comparison: comparisonOf(results),
    conclusion: buildConclusion(results, ctx, specs),
    sim: {
      asis: null,
      p1: simSummary("p1", {}),
      r1: null,
      p2: simSummary("p2", {
        fleet: 7,
        achievedPerH: 96.4,
        servedShare: 0.74,
        verdict: "NOT_CONFIRMED",
        bottleneck: "fleet",
        idlePct: 2.1,
      }),
      r2: null,
    },
    paramIssues: [],
  };
}

/** Описания параметров склада из данных организатора (T1.1). */
export function fixtureDefs(): ParamSpec[] {
  return paramSpecsFor("warehouse");
}

/** Журнал корректировок для тестов. */
export function fixtureChanges(): ReportChange[] {
  return [
    {
      at: "2026-09-25T09:30:00.000Z",
      user: "demo@demo.local",
      scenario: "Покупка — Ronavi H1500",
      field: "item:pallet-transport:quantity",
      auto: 10,
      old: 10,
      new: 12,
      unit: "шт.",
      reason: "принят парк по имитации",
    },
    {
      at: "2026-09-25T09:31:00.000Z",
      user: "demo@demo.local",
      field: "param:forkliftSalaryRubMonth",
      auto: null,
      old: 120_000,
      new: 130_000,
      unit: "₽/мес",
    },
    { at: "2026-09-25T09:32:00.000Z", field: "norm:utilization", auto: 0.775, old: 0.775, new: 0.8 },
  ];
}
