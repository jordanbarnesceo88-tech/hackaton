import { describe, expect, it } from "vitest";
import { changeFieldLabel, projectAuditDiff, toChangeLogRows, type ProjectAuditInput } from "./changes";
import type { PendingChange, ScenarioSpec } from "../tz/types";

function input(): ProjectAuditInput {
  return { name: "Склад", params: { activeAreaM2: 5000 }, scenarios: [
    { key: "asis", name: "Как есть", kind: "asis", items: [] },
    { key: "p1", name: "Покупка", kind: "purchase", items: [{ process: "pallet-transport", productSlug: "one" }] },
  ] };
}
const find = (rows: PendingChange[], field: string) => rows.find(row => row.field === field);

describe("server-derived project audit facts", () => {
  it("records omitted edits and accepts only a reason for a real matching field", () => {
    const before = input(), after = structuredClone(before);
    after.params.activeAreaM2 = 6000;
    after.scenarios[1]!.items[0]!.quantityOverride = 6;
    const notes: PendingChange[] = [
      { field: "param:activeAreaM2", old: -999, new: 1, auto: 123, unit: "forged", reason: "Расширение участка" },
      { field: "param:forged", old: 1, new: 2, auto: 1, reason: "Не происходило" },
      { scenarioKey: "asis", field: "item:pallet-transport:quantity", old: 1, new: 999, auto: 1, reason: "Чужой сценарий" },
    ];
    const unchanged = structuredClone({ before, after, notes });
    const diff = projectAuditDiff(before, after, notes);
    expect(diff).toHaveLength(2);
    expect(find(diff, "param:activeAreaM2")).toEqual({ field: "param:activeAreaM2", old: 5000, new: 6000, auto: null, reason: "Расширение участка" });
    expect(find(diff, "item:pallet-transport:quantity")).toEqual({ scenarioKey: "p1", field: "item:pallet-transport:quantity", old: null, new: 6, auto: null, unit: "шт." });
    const rows = toChangeLogRows(diff, { projectId: "project", userId: "owner", scenarioIdByKey: new Map([["p1", "scenario"]]), serverAuto: () => 4 });
    expect(rows[1]).toMatchObject({ newValue: 6, autoValue: 4, scenarioId: "scenario", userId: "owner" });
    expect(rows[1]).not.toHaveProperty("oldValue");
    expect({ before, after, notes }).toEqual(unchanged);
  });

  it("covers every current manual item/scenario input without treating receipts as edits", () => {
    const before = input(), after = structuredClone(before), s = after.scenarios[1]!;
    after.name = "Вариант";
    s.name = "Другая покупка"; s.kind = "raas"; s.simSeed = 0; s.cashRealizationShare = .5;
    s.normOverrides = { utilization: .8 }; s.terminalResidualRub = 100;
    s.operationsStaffing = { mode: "integrator", billing: "included-in-service", reason: "Договор" };
    s.pilotPlan = { schemaVersion: "pilot-plan-1" } as ScenarioSpec["pilotPlan"];
    s.siteLayout = { widthM: 1 } as ScenarioSpec["siteLayout"];
    Object.assign(s.items[0]!, { productSlug: "two", quantityOverride: 6, chargersOverride: 2, automationCoverageOverride: .7,
      priceRubOverride: 1, throughputPerHOverride: 2, serviceRubYearOverride: 0, raasRubMonthOverride: 3, raasFromEstimate: true,
      costPackage: { softwareIncludedInIntegration: true, repairsIncludedInService: false, includedChargers: 1, reason: "Комплект" },
      manuallyAdded: true, manualReason: "Пилот" });
    const fields = projectAuditDiff(before, after).map(row => row.field);
    expect(fields).toEqual(expect.arrayContaining(["project:name", "scenario:name", "scenario:kind", "scenario:seed", "scenario:cashShare", "scenario:pilot", "scenario:site", "scenario:residual", "scenario:staffing", "norm:utilization",
      ...["product", "quantity", "chargers", "coverage", "price", "throughput", "service", "raasRate", "raasEstimate", "package", "manual"].map(f => `item:pallet-transport:${f}`)]));
    expect(new Set(fields).size).toBe(fields.length);
    expect(fields.every(field => changeFieldLabel(field) !== field)).toBe(true);
    const receiptsOnly = structuredClone(before);
    receiptsOnly.scenarios[1]!.spatialEvidence = { executionInputKey: "new server observation" } as ScenarioSpec["spatialEvidence"];
    expect(projectAuditDiff(before, receiptsOnly)).toEqual([]);
    expect(projectAuditDiff(after, JSON.parse(JSON.stringify(after)))).toEqual([]);
  });

  it("retains scenario/item add-remove facts and detects reset of an override", () => {
    const before = input(); before.scenarios[1]!.items[0]!.quantityOverride = 6;
    const after = structuredClone(before); delete after.scenarios[1]!.items[0]!.quantityOverride;
    expect(find(projectAuditDiff(before, after), "item:pallet-transport:quantity")).toMatchObject({ old: 6, new: null });
    after.scenarios[1]!.items = [{ process: "cleaning", productSlug: "cleaner" }];
    expect(projectAuditDiff(before, after).map(row => row.field)).toEqual(["item:pallet-transport:remove", "item:cleaning:add"]);
    after.scenarios = [after.scenarios[0]!, { key: "p2", name: "Другой", kind: "purchase", items: [] }];
    const diff = projectAuditDiff(before, after);
    expect(diff.map(row => row.field)).toEqual(["scenario:remove", "scenario:add"]);
    expect(diff[0]!.old).toEqual(before.scenarios[1]);
    const rows = toChangeLogRows(diff, { projectId: "project", userId: "owner", scenarioIdByKey: new Map([["p2", "new-row"]]), serverAuto: () => null });
    expect(rows[0]).toMatchObject({ scenarioId: null, entityId: "p1" });
    expect(rows[1]).toMatchObject({ scenarioId: "new-row" });
  });
});
