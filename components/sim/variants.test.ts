import { describe, expect, it } from "vitest";
import type { SimProvenance } from "@/lib/sim/adapter";
import { WAREHOUSE_BASE_LAYOUT, WAREHOUSE_BASE_PEAK_PER_H, warehouseBaseInput } from "@/lib/sim/fixtures";
import { runSimSync } from "@/lib/sim/runner";
import { toStored } from "@/lib/sim/metrics";
import type { SimSummaryStored } from "@/lib/sim/types";
import {
  buildSimVariants,
  fleetFacts,
  findSelection,
  initialSelection,
  optionValue,
  resolveSelection,
  simOptions,
  simVariantLabel,
  storedMatches,
  unavailableLabel,
  withFleetFacts,
  type SimScenario,
} from "./variants";

describe("simVariantLabel", () => {
  it("builds the three option labels of the spec", () => {
    expect(simVariantLabel("Покупка — Ronavi H1500", "calculated", 11)).toBe(
      "Покупка — Ronavi H1500 — парк по расчёту (11)",
    );
    expect(simVariantLabel("Покупка — Ronavi H1500", "minStable", 9)).toBe(
      "Покупка — Ronavi H1500 — минимальный по имитации (9)",
    );
    expect(simVariantLabel("Покупка — Ronavi H1500", "byNorm", 3)).toBe(
      "Покупка — Ronavi H1500 — парк по норме организатора (3)",
    );
  });

  it("says why the number is missing instead of printing 0 or null", () => {
    expect(simVariantLabel("Услуга", "calculated", null)).toBe("Услуга — парк по расчёту (нет данных)");
    expect(simVariantLabel("Услуга", "minStable", null)).toBe("Услуга — минимальный по имитации (не определён)");
    expect(simVariantLabel("Услуга", "byNorm", 0)).toBe("Услуга — парк по норме организатора (нет нормы)");
  });
});

describe("buildSimVariants", () => {
  const calculated = warehouseBaseInput(11);
  const byNorm = warehouseBaseInput(3);

  it("derives the minimal-fleet input from the calculated one with only the fleet changed", () => {
    const v = buildSimVariants({ scenarioName: "Покупка — H1500", calculated, byNorm, minStableFleet: 9 });
    expect(v.map((x) => x.id)).toEqual(["calculated", "minStable", "byNorm"]);
    expect(v[1]!.input!.robots.count).toBe(9);
    expect({ ...v[1]!.input!, robots: { ...v[1]!.input!.robots, count: 11 } }).toEqual(calculated);
    expect(v.map((x) => x.label)).toEqual([
      "Покупка — H1500 — парк по расчёту (11)",
      "Покупка — H1500 — минимальный по имитации (9)",
      "Покупка — H1500 — парк по норме организатора (3)",
    ]);
  });

  it("leaves the minimal variant without input when the sweep found nothing", () => {
    const v = buildSimVariants({ scenarioName: "Покупка — H1500", calculated, byNorm: null, minStableFleet: null });
    expect(v[1]!.input).toBeNull();
    expect(v[2]!.input).toBeNull();
    expect(v[2]!.label).toBe("Покупка — H1500 — парк по норме организатора (нет нормы)");
  });

  describe("«Откуда параметры» of each variant describes that variant's own run", () => {
    // Строки адаптера для парка по расчёту: 11 роботов (ручная правка), 2 станции, общая площадь.
    const provenance: SimProvenance[] = [
      { field: "param:activeAreaM2", label: "Площадь активной зоны", value: 10000, unit: "м²", origin: "organizer" },
      { field: "calc:fleet", label: "Число роботов", value: 11, unit: "шт.", origin: "user", note: "вручную" },
      { field: "calc:chargers", label: "Зарядные станции", value: 2, unit: "шт.", origin: "derived", note: "расчёт" },
      { field: "calc:peakPerH", label: "Пиковый поток", value: WAREHOUSE_BASE_PEAK_PER_H, unit: "ед./ч", origin: "derived" },
    ];
    const calc2 = warehouseBaseInput(11, { layout: { ...WAREHOUSE_BASE_LAYOUT, chargers: 2 } });
    const v = buildSimVariants({ scenarioName: "Покупка — H1500", calculated: calc2, byNorm, minStableFleet: 9, provenance });
    const row = (i: number, field: string) => v[i]!.provenance!.find((p) => p.field === field)!;

    it("keeps the adapter's rows for the calculated fleet", () => {
      expect(v[0]!.provenance).toEqual(provenance);
    });

    it("takes the numbers of the calculation rows from the variant's own input, keeping their origin", () => {
      const edited = warehouseBaseInput(12, { demand: { ...calc2.demand, peakPerH: 150 } });
      const w = buildSimVariants({ scenarioName: "X", calculated: edited, byNorm: null, minStableFleet: null, provenance });
      const fleet = w[0]!.provenance!.find((p) => p.field === "calc:fleet")!;
      expect(fleet).toMatchObject({ value: 12, origin: "user", note: "вручную" });
      expect(w[0]!.provenance!.find((p) => p.field === "calc:peakPerH")!.value).toBe(150);
    });

    it("puts M robots and the calculated chargers into the minimal variant", () => {
      expect(row(1, "calc:fleet")).toMatchObject({ value: 9, origin: "derived" });
      expect(row(1, "calc:fleet").note).toMatch(/перебору имитацией/);
      expect(row(1, "calc:chargers")).toMatchObject({ value: 2, origin: "derived" });
    });

    it("puts K robots and its own chargers into the by-norm variant", () => {
      expect(row(2, "calc:fleet")).toMatchObject({ value: 3, origin: "derived" });
      expect(row(2, "calc:fleet").note).toMatch(/норма организатора/);
      expect(row(2, "calc:chargers")).toMatchObject({ value: byNorm.layout.chargers, origin: "derived" });
    });

    it("leaves the shared rows untouched and gives no table to a variant without input", () => {
      expect(row(2, "param:activeAreaM2")).toEqual(provenance[0]);
      const none = buildSimVariants({ scenarioName: "X", calculated: calc2, byNorm: null, minStableFleet: null, provenance });
      expect(none[1]!.provenance).toBeUndefined();
      expect(none[2]!.provenance).toBeUndefined();
    });
  });
});

function scenarios(): SimScenario[] {
  return [
    { key: "asis", name: "Как есть", variants: [] },
    {
      key: "buy",
      name: "Покупка — H1500",
      variants: buildSimVariants({
        scenarioName: "Покупка — H1500",
        calculated: warehouseBaseInput(11),
        byNorm: warehouseBaseInput(3),
        minStableFleet: 9,
      }),
    },
    {
      key: "raas",
      name: "Услуга — H1500",
      variants: buildSimVariants({
        scenarioName: "Услуга — H1500",
        calculated: warehouseBaseInput(11),
        byNorm: null,
        minStableFleet: null,
      }),
    },
    {
      key: "shuttle",
      name: "Покупка — шаттл",
      variants: buildSimVariants({ scenarioName: "Покупка — шаттл", calculated: null, byNorm: null, minStableFleet: null }),
      unavailableReason: "класс решения имитацией не моделируется",
    },
  ];
}

describe("simOptions", () => {
  it("disables «Как есть» with the reason and every variant without input", () => {
    const opts = simOptions(scenarios());
    expect(opts[0]).toEqual({
      value: optionValue("asis", "none"),
      label: "Как есть (без роботов — имитировать нечего)",
      disabled: true,
    });
    expect(opts.filter((o) => !o.disabled).map((o) => o.label)).toEqual([
      "Покупка — H1500 — парк по расчёту (11)",
      "Покупка — H1500 — минимальный по имитации (9)",
      "Покупка — H1500 — парк по норме организатора (3)",
      "Услуга — H1500 — парк по расчёту (11)",
    ]);
    expect(opts.at(-1)).toEqual({
      value: optionValue("shuttle", "none"),
      label: "Покупка — шаттл (класс решения имитацией не моделируется)",
      disabled: true,
    });
  });

  it("uses a neutral reason for a robot scenario that simply has no inputs", () => {
    expect(unavailableLabel({ key: "x", name: "Покупка — X", variants: [{ id: "calculated", label: "", input: null }] })).toBe(
      "Покупка — X (нет данных для имитации)",
    );
  });
});

describe("selection", () => {
  it("starts on the calculated fleet of the initial scenario", () => {
    const sel = initialSelection(scenarios(), "raas");
    expect(sel?.scenario.key).toBe("raas");
    expect(sel?.variant.id).toBe("calculated");
  });

  it("skips «Как есть» to the first scenario that can be simulated", () => {
    const sel = initialSelection(scenarios(), "asis");
    expect(sel?.scenario.key).toBe("buy");
  });

  it("returns null when nothing can be simulated", () => {
    expect(initialSelection([{ key: "asis", name: "Как есть", variants: [] }], "asis")).toBeNull();
  });

  it("keeps the user's pick while it exists and falls back after a recalculation removed it", () => {
    const s = scenarios();
    expect(resolveSelection(s, optionValue("buy", "byNorm"), "raas")?.variant.id).toBe("byNorm");
    expect(findSelection(s, optionValue("raas", "minStable"))).toBeNull();
    expect(resolveSelection(s, optionValue("raas", "minStable"), "raas")?.variant.id).toBe("calculated");
    expect(resolveSelection(s, "garbage", "buy")?.scenario.key).toBe("buy");
  });
});

describe("storedMatches", () => {
  const calc = warehouseBaseInput(11);
  const stored: SimSummaryStored = toStored(runSimSync(calc));

  it("accepts the summary saved for the same seed, fleet, peak flow and model version", () => {
    expect(storedMatches(stored, calc)).toBe(true);
    // Пиковый поток после сохранения в JSON и обратно — в пределах допуска.
    expect(storedMatches({ ...stored, requiredPerH: stored.requiredPerH * (1 + 1e-9) }, calc)).toBe(true);
  });

  it("rejects a stale summary: another fleet, peak flow, seed or model version", () => {
    expect(storedMatches({ ...stored, fleet: 10 }, calc)).toBe(false);
    expect(storedMatches({ ...stored, requiredPerH: stored.requiredPerH + 1 }, calc)).toBe(false);
    expect(storedMatches({ ...stored, seed: 2 }, calc)).toBe(false);
    expect(storedMatches({ ...stored, simModelVersion: "sim-0.9.0" }, calc)).toBe(false);
  });

  it("has nothing to match without a summary or a calculated input", () => {
    expect(storedMatches(null, calc)).toBe(false);
    expect(storedMatches(undefined, calc)).toBe(false);
    expect(storedMatches(stored, null)).toBe(false);
  });
});

describe("withFleetFacts", () => {
  const summary = runSimSync(warehouseBaseInput(11));
  const current = toStored(summary);

  it("adds the sweep and norm fleets from the current variants, the norm verdict from a matching stored summary", () => {
    const buy = scenarios()[1]!;
    const stored = { ...current, fleetByNorm: 3, verdictByNorm: "NOT_CONFIRMED" as const, minStableFleet: 8 };
    const out = withFleetFacts(summary, { ...buy, stored });
    expect(out.minStableFleet).toBe(9);
    expect(out.fleetByNorm).toBe(3);
    expect(out.verdictByNorm).toBe("NOT_CONFIRMED");
    expect(out.achievedPerH).toBe(summary.achievedPerH);
  });

  it("drops the stored norm verdict when it was computed for another norm fleet", () => {
    const buy = scenarios()[1]!;
    const stored = { ...current, fleetByNorm: 4, verdictByNorm: "CONFIRMED" as const };
    const out = withFleetFacts(summary, { ...buy, stored });
    expect(out.fleetByNorm).toBe(3);
    expect(out.verdictByNorm).toBeNull();
  });

  it("falls back to a matching stored summary when the variants do not carry the numbers", () => {
    const raas = scenarios()[2]!;
    const stored = { ...current, minStableFleet: 9, fleetByNorm: 3, verdictByNorm: "NOT_CONFIRMED" as const };
    const out = withFleetFacts(summary, { ...raas, stored });
    expect(out.minStableFleet).toBe(9);
    expect(out.fleetByNorm).toBe(3);
    expect(out.verdictByNorm).toBe("NOT_CONFIRMED");
  });

  it("ignores a stale stored summary (parameters edited or recalculated before saving)", () => {
    const raas = scenarios()[2]!;
    const facts = { minStableFleet: 7, fleetByNorm: 3, verdictByNorm: "NOT_CONFIRMED" as const };
    const none = { minStableFleet: null, fleetByNorm: null, verdictByNorm: null };
    // Другой парк: сводка получена до того, как расчёт дал 11 роботов.
    expect(fleetFacts({ ...raas, stored: { ...current, ...facts, fleet: 10 } }, "calculated", summary)).toEqual(none);
    // Другой пиковый поток: изменены объёмы или часы работы.
    const peak = { ...current, ...facts, requiredPerH: current.requiredPerH * 1.2 };
    expect(fleetFacts({ ...raas, stored: peak }, "calculated", summary)).toEqual(none);
    // Другая версия модели имитации.
    const old = { ...current, ...facts, simModelVersion: "sim-0.9.0" };
    expect(fleetFacts({ ...raas, stored: old }, "calculated", summary)).toEqual(none);
    expect(withFleetFacts(summary, { ...raas, stored: { ...current, ...facts, fleet: 10 } }).minStableFleet).toBeNull();
  });

  it("takes the norm verdict from the run itself when the by-norm variant is shown", () => {
    const buy = scenarios()[1]!;
    const normRun = runSimSync(warehouseBaseInput(3));
    expect(normRun.verdict).toBe("NOT_CONFIRMED");
    // Сохранённая сводка устарела, но вердикт по норме известен из показанного прогона.
    const stale = { ...current, fleet: 10, verdictByNorm: "CONFIRMED" as const };
    expect(withFleetFacts(normRun, { ...buy, stored: stale }, "byNorm").verdictByNorm).toBe("NOT_CONFIRMED");
    // Кадр посреди проигрывания: вердикт — из полного прогона, а не из части окна.
    const partial = { ...normRun, verdict: "CONFIRMED" as const };
    expect(withFleetFacts(partial, { ...buy, stored: stale }, "byNorm", normRun).verdictByNorm).toBe("NOT_CONFIRMED");
  });
});
