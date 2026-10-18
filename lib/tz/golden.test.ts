import { describe, expect, it } from "vitest";
import { paramSpecsFor } from "../data/organizer/params";
import { FIXTURE_CARRIER_P, FIXTURE_H1500, WAREHOUSE_BASE_PARAMS } from "./econ/fixtures";
import { buildProjectModel } from "./model";
import { resolveNorms } from "./norms";
import type { ScenarioSpec } from "./types";

/**
 * Эталон сборки модели tz-1.0.0 (ТЗ §5.6: результаты презентации воспроизводятся в сборке).
 * Базовый склад организатора, продукты — фикстуры экономики (H1500 и Carrier P с источниками
 * в lib/tz/econ/fixtures.ts), производительность по циклу — по НАСТОЯЩЕЙ планировке и
 * аналитике lib/sim, а не подставленные 20 пал./ч эталона T1.2. В tz-1.0.5 H1500 использует
 * dense closed-pod цикл: два физических рейса и четыре обработки на клиентскую паллету.
 * Его N=19 и ухудшившиеся NPV закреплены явно; fork Carrier P сохраняет прежний цикл.
 *
 * Числа закреплены снимком: любое изменение модели или данных, меняющее их, видно в diff
 * теста и требует пометки «МЕНЯЕТ ЧИСЛА» с повышением TZ_MODEL_VERSION. Деньги округлены до
 * рубля, доли и годы — до четырёх знаков: снимок проверяет модель, а не шум двоичной
 * арифметики в последнем бите.
 */

const PT = "pallet-transport";
const SPECS: ScenarioSpec[] = [
  { key: "asis", name: "Как есть", kind: "asis", items: [] },
  { key: "p1", name: "Покупка — Ronavi H1500", kind: "purchase", items: [{ process: PT, productSlug: FIXTURE_H1500.slug }] },
  { key: "r1", name: "Услуга (RaaS) — Ronavi H1500", kind: "raas", items: [{ process: PT, productSlug: FIXTURE_H1500.slug }] },
  { key: "p2", name: "Покупка — DMR Carrier P", kind: "purchase", items: [{ process: PT, productSlug: FIXTURE_CARRIER_P.slug }] },
];

const rub = (v: number | null) => (v === null ? null : Math.round(v));
const r4 = (v: number | null | undefined) => (v === null || v === undefined ? null : Math.round(v * 1e4) / 1e4);

describe("эталон: базовый склад, H1500 и Carrier P на настоящей планировке", () => {
  const model = buildProjectModel({
    facility: "warehouse",
    params: { ...WAREHOUSE_BASE_PARAMS },
    paramDefs: paramSpecsFor("warehouse"),
    scenarios: SPECS,
    products: [FIXTURE_H1500, FIXTURE_CARRIER_P],
    norms: resolveNorms(),
  });

  it("числа сценариев и парк по норме", () => {
    const pinned = model.results.map((r) => {
      if (r.status !== "ok") return { key: r.key, refused: r.refusal.reason };
      const item = r.items[0];
      return {
        key: r.key,
        N: item?.n ?? null,
        nExact: r4(item?.nExact),
        thrCycle: r4(item?.thrCycle),
        chargers: item?.chargers ?? null,
        capex: rub(r.capexRub),
        opex: rub(r.opexYearRub),
        effect: rub(r.effectYearRub),
        PB: r4(r.paybackYears),
        band: r.band,
        ROI_TZ: r4(r.roiTzPct),
        NPV: rub(r.npvRub),
        TCO: rub(r.tcoRub),
      };
    });
    expect(pinned).toMatchInlineSnapshot(`
      [
        {
          "N": null,
          "NPV": null,
          "PB": null,
          "ROI_TZ": null,
          "TCO": 234360000,
          "band": "none",
          "capex": 0,
          "chargers": null,
          "effect": 0,
          "key": "asis",
          "nExact": null,
          "opex": 46872000,
          "thrCycle": null,
        },
        {
          "N": 19,
          "NPV": -42430871,
          "PB": 11.628,
          "ROI_TZ": 45.0203,
          "TCO": 269255637,
          "band": "slow",
          "capex": 63470000,
          "chargers": 2,
          "effect": 5458373,
          "key": "p1",
          "nExact": 18.7008,
          "opex": 41413627,
          "thrCycle": 10.5026,
        },
        {
          "N": 19,
          "NPV": -33334585,
          "PB": null,
          "ROI_TZ": -2863.6777,
          "TCO": 280000637,
          "band": "none",
          "capex": 1540000,
          "chargers": 2,
          "effect": -8820127,
          "key": "r1",
          "nExact": 18.7008,
          "opex": 55692127,
          "thrCycle": 10.5026,
        },
        {
          "N": 13,
          "NPV": -51170177,
          "PB": 15.5616,
          "ROI_TZ": 34.1697,
          "TCO": 279473526,
          "band": "slow",
          "capex": 68530000,
          "chargers": 4,
          "effect": 4403795,
          "key": "p2",
          "nExact": 12.9438,
          "opex": 42468205,
          "thrCycle": 15.1739,
        },
      ]
    `);
    const byNorm = Object.fromEntries(
      Object.entries(model.simInputs).map(([k, v]) => [k, v.byNorm ? v.byNorm.robots.count : null]),
    );
    expect(byNorm).toMatchInlineSnapshot(`
      {
        "asis": null,
        "p1": null,
        "p2": 4,
        "r1": null,
      }
    `);
    expect(model.conclusion.recommendedScenarioKey).toMatchInlineSnapshot(`null`);
  });
});
