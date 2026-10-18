import { describe, expect, it, vi } from "vitest";
import { paramSpecsFor } from "../data/organizer/params";
import * as underlift from "../sim/underlift-layout";
import { FIXTURE_H1500, WAREHOUSE_BASE_PARAMS } from "./econ/fixtures";
import { buildProjectModel, storedPartOf } from "./model";
import { resolveNorms } from "./norms";
import type { ScenarioSpec } from "./types";

describe("saved static layout reuse", () => {
  it("builds each complete geometry input once and preserves detached exact layouts", () => {
    const specs: ScenarioSpec[] = [
      { key: "asis", name: "Как есть", kind: "asis", items: [] },
      ...[2, 2, 1].map((chargers, index) => ({ key: `p${index}`, name: `Покупка ${index}`, kind: "purchase" as const,
        items: [{ process: "pallet-transport", productSlug: FIXTURE_H1500.slug, quantityOverride: 6, chargersOverride: chargers }] })),
    ];
    const defs = paramSpecsFor("warehouse");
    const model = buildProjectModel({ facility: "warehouse", params: { ...WAREHOUSE_BASE_PARAMS, activeAreaM2: 5000 },
      paramDefs: defs, scenarios: specs, products: [FIXTURE_H1500], norms: resolveNorms() });
    const expected = Object.fromEntries(Object.entries(model.simInputs).flatMap(([key, entry]) => entry.calculated
      ? [[key, structuredClone(underlift.buildClosedPodLayout(entry.calculated.layout, entry.calculated.siteLayout).layout)]] : []));
    const before = structuredClone(model);
    const build = vi.spyOn(underlift, "buildClosedPodLayout");
    try {
      const stored = storedPartOf(model, defs);
      expect(stored.runtime!.layouts).toEqual(expected);
      expect(build).toHaveBeenCalledTimes(2);
      expect(model).toEqual(before);
      const first = stored.runtime!.layouts!.p0!, second = stored.runtime!.layouts!.p1!;
      expect(first).toEqual(second);
      expect(first).not.toBe(second);
      first.slots[0]!.x += 100;
      expect(second).toEqual(expected.p1);
      expect(model).toEqual(before);
    } finally { build.mockRestore(); }
  });
});
