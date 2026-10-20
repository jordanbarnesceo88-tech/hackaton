import { describe, expect, it } from "vitest";
import { CATALOG } from "../data/organizer/catalog";
import { productForCalcFromSeed } from "../catalog/product-for-calc";
import { baseValuesFor, paramSpecsFor } from "../data/organizer/params";
import { businessExampleInputs } from "../projects/business-examples";
import { buildProjectModel, storedPartOf } from "./model";
import { projectSnapshotModel } from "../projects/archive";
import { resolveNorms } from "./norms";
import type { ScenarioOk, ScenarioSpec } from "./types";
import { expectedCycleS, expectedLegsM } from "../sim/analytic";

const ronavi = productForCalcFromSeed(CATALOG.find(p => p.slug === "ronavi-h1500")!);
const fork = { ...ronavi, slug: "test-fork", name: "Fork", handlingClass: "fork" as const };
const norms = resolveNorms();
const data = businessExampleInputs("steady-flow", baseValuesFor("warehouse"), [ronavi]);
// Keep this five-robot accounting fixture independent of the public example's selected fleet.
data.scenarios.forEach(spec => spec.items.forEach(item => { item.quantityOverride = 5; }));
const mixed: ScenarioSpec[] = [...data.scenarios, { key: "fork", name: "Fork", kind: "purchase",
  items: [{ ...data.scenarios[1]!.items[0]!, productSlug: fork.slug }] }];

describe("per-item versioned transport workflow", () => {
  const model = buildProjectModel({ facility: "warehouse", params: data.params, scenarios: mixed,
    products: [ronavi, fork], paramDefs: paramSpecsFor("warehouse"), norms });
  const purchase = model.results.find(r => r.key === "purchase") as ScenarioOk;
  const forklift = model.results.find(r => r.key === "fork") as ScenarioOk;

  it("accounts for a closed pod cycle while retaining the original customer demand and manual fleet", () => {
    expect(purchase.status).toBe("ok");
    expect(purchase.items[0]!.n).toBe(5);
    expect(purchase.items[0]!.peakPerHour).toBeCloseTo(51.81818181818);
    expect(purchase.items[0]!.nAuto).toBe(6);
    expect(purchase.items[0]!.thrCycle).toBeCloseTo(13.5623948278);
    expect(model.simInputs.purchase!.calculated!.transportWorkflow).toBe("closed-pod-1");
    expect(model.simInputs.purchase!.byNorm).toBeNull();
    expect(model.modelVersion).toBe("tz-1.1.0");
  });

  it("keeps fork/tug cycle geometry and two-operation timing unchanged in mixed scenarios", () => {
    const legs = expectedLegsM(model.layout!);
    const cycle = expectedCycleS({ ...legs, speedMps: fork.speedMps!, loadedSpeedFactor: norms.loadedSpeedFactor,
      handlingSec: norms.handlingSecFork })!;
    expect(forklift.items[0]!.thrCycle).toBeCloseTo(3600 / cycle);
    expect(model.simInputs.fork!.calculated!.transportWorkflow).toBe("single-leg-pallet-1");
    expect(model.layout!.slots).toHaveLength(150);
    expect(data.scenarios[1]!.items[0]!.quantityOverride).toBe(5);
  });

  it("does not double annual robot hours or electricity for the internal transport job", () => {
    const annualHours = Math.min(24, Number(model.paramsUsed.shiftsPerDay) * Number(model.paramsUsed.shiftDurationH)) * Number(model.paramsUsed.workDaysPerYear);
    const expected = 5 * norms.robotAvgPowerKw * annualHours * norms.utilization * norms.electricityRubPerKwh;
    expect(purchase.opexLines.find(l => l.key === "electricity")!.valueRub).toBeCloseTo(expected);
  });

  it("opens an older saved calculation without applying the new cycle or input recipe", () => {
    const old = { ...storedPartOf(model), runtime: undefined, modelVersion: "tz-1.0.4", calculatedAt: "2026-10-17T00:00:00.000Z", sim: {} };
    const row = old.results.find(r => r.key === "purchase") as ScenarioOk;
    row.items[0]!.thrCycle = 25.455017438945685;
    row.items[0]!.nAuto = 4;
    const reopened = projectSnapshotModel(old);
    expect(reopened.modelVersion).toBe("tz-1.0.4");
    expect(reopened.results).toEqual(old.results);
    expect(reopened.simInputs.purchase!.calculated).toBeNull();
  });
});
