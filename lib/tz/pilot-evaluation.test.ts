import { describe, expect, it } from "vitest";
import { evaluatePilotAcceptance, parsePilotAcceptanceThresholds, parsePilotObservation } from "./pilot-evaluation";
import { parsePilotPlanInput, defaultPilotPlan } from "./pilot-budget";
import type { PilotAcceptanceThresholds, PilotObservation, PilotPlanInput } from "./types";
import { buildProjectModel } from "./model";
import { FIXTURE_PRODUCTS, WAREHOUSE_BASE_PARAMS, fixtureSpecs } from "./econ/fixtures";
import { paramSpecsFor } from "../data/organizer/params";
import { resolveNorms } from "./norms";

export function thresholds(): PilotAcceptanceThresholds {
  return { schemaVersion: "pilot-acceptance-1", scope: "Участок А", metric: "accepted-area-m2-day", source: "Согласованные критерии испытания, тестовая фикстура", date: "2026-10-01",
    minAcceptedPerUnit: 1000, minPlanCompletionPct: 100, maxManualReworkPct: 5, maxDowntimePct: 10, maxIncidents: 0, maxInterventionsPerShift: 1, minCustomerScore: 4, minDurationDays: 2 };
}
export function observation(): PilotObservation {
  return { schemaVersion: "pilot-observation-1", scope: "Участок А", metric: "accepted-area-m2-day", productSlug: "test-cleaner", fleet: 2,
    periodStart: "2026-10-05", periodEnd: "2026-10-06", observedDays: 2, dayBasis: "working", acceptedQuantity: 2000, plannedQuantity: 2000, manualReworkQuantity: 100,
    scheduledHours: 16, downtimeHours: 1.6, incidents: 0, interventions: 2, shifts: 2, customerScore: 4, source: "Журнал участка, тестовая фикстура", date: "2026-10-07" };
}
function plan(): PilotPlanInput {
  return { schemaVersion: "pilot-plan-1", fleet: 2, chargers: 2, durationDays: 2, dayBasis: "working", acquisition: "purchase", costs: Object.fromEntries(["setup", "integration", "training", "logistics", "sitePreparation", "evaluation"].map(k => [k, { valueRub: null, source: "Не оценено" }])) as PilotPlanInput["costs"],
    equipmentUnitRubOverride: null, contingencyPct: 10, targetThroughputPerH: null, maxP95WaitMin: 1, maxInterventionsPerShift: 1, readiness: [], notes: "", acceptanceThresholds: thresholds(), actualResult: observation() };
}
const expected = { metric: "accepted-area-m2-day" as const, productSlug: "test-cleaner" };

describe("pilot observations and acceptance", () => {
  it("accepts exact boundaries and computes all eight criteria from saved input without mutation", () => {
    const p = plan(), before = structuredClone(p), result = evaluatePilotAcceptance(p, expected);
    expect(result.status).toBe("PASS"); expect(result.checks.filter(row => row.key !== "identity")).toHaveLength(8);
    expect(result.checks.find(row => row.key === "accepted")?.actual).toBe(1000);
    expect(result.checks.find(row => row.key === "rework")?.actual).toBe(5);
    expect(result.checks.find(row => row.key === "downtime")?.actual).toBe(10);
    expect(p).toEqual(before);
  });
  it.each([
    ["acceptedQuantity", 1999, "accepted"], ["plannedQuantity", 2001, "plan"], ["manualReworkQuantity", 101, "rework"], ["downtimeHours", 1.61, "downtime"],
    ["incidents", 1, "incidents"], ["interventions", 3, "interventions"], ["customerScore", 3.9, "score"], ["observedDays", 1, "duration"],
  ] as const)("fails a complete observation outside %s boundary", (key, value, check) => {
    const p = plan(); p.actualResult![key] = value;
    // One observed working day can contain the same sixteen-hour measurement window.
    const result = evaluatePilotAcceptance(p, expected);
    expect(result.status).toBe("FAIL"); expect(result.checks.find(row => row.key === check)?.status).toBe("FAIL");
  });
  it("uses scheduled hours including downtime for operations, never brush hours or daily units", () => {
    const p = plan(); p.acceptanceThresholds!.metric = "completed-operations-hour"; p.acceptanceThresholds!.minAcceptedPerUnit = 125; p.actualResult!.metric = "completed-operations-hour";
    const r = evaluatePilotAcceptance(p, { ...expected, metric: "completed-operations-hour" });
    expect(r.status).toBe("PASS"); expect(r.checks.find(row => row.key === "accepted")?.actual).toBe(125);
    expect(evaluatePilotAcceptance(p, expected).status).toBe("INCOMPLETE");
  });
  it.each(["scope", "metric", "productSlug", "fleet", "dayBasis"] as const)("never passes mismatched %s", key => {
    const p = plan(); const changes = { scope: "Другой участок", metric: "completed-operations-hour", productSlug: "other-model", fleet: 3, dayBasis: "calendar" };
    p.actualResult = { ...p.actualResult!, [key]: changes[key] } as PilotObservation;
    expect(evaluatePilotAcceptance(p, expected).status).toBe("INCOMPLETE");
  });
  it("does not turn missing criteria, sources, dates or observations into zero or PASS", () => {
    const p = plan();
    expect(evaluatePilotAcceptance({ ...p, acceptanceThresholds: undefined, actualResult: undefined }, expected).status).toBe("INCOMPLETE");
    for (const key of ["minAcceptedPerUnit", "minPlanCompletionPct", "maxManualReworkPct", "maxDowntimePct", "maxIncidents", "maxInterventionsPerShift", "minCustomerScore", "minDurationDays"] as const) {
      expect(evaluatePilotAcceptance({ ...p, acceptanceThresholds: { ...p.acceptanceThresholds!, [key]: null } }, expected).status, key).toBe("INCOMPLETE");
    }
    for (const key of ["acceptedQuantity", "plannedQuantity", "manualReworkQuantity", "scheduledHours", "downtimeHours", "incidents", "interventions", "shifts", "customerScore", "observedDays", "periodStart", "periodEnd", "date"] as const) {
      expect(evaluatePilotAcceptance({ ...p, actualResult: { ...p.actualResult!, [key]: null } }, expected).status, key).toBe("INCOMPLETE");
    }
    expect(evaluatePilotAcceptance({ ...p, actualResult: { ...p.actualResult!, source: " " } }, expected).status).toBe("INCOMPLETE");
    expect(evaluatePilotAcceptance({ ...p, acceptanceThresholds: { ...p.acceptanceThresholds!, date: null } }, expected).status).toBe("INCOMPLETE");
  });
  it("handles a real zero accepted volume as failure, not a division-by-zero success", () => {
    const p = plan(); Object.assign(p.actualResult!, { acceptedQuantity: 0, manualReworkQuantity: 0 });
    const r = evaluatePilotAcceptance(p, expected); expect(r.status).toBe("FAIL"); expect(r.checks.find(row => row.key === "rework")?.actual).toBe(0);
  });
  it("validates finite values, dates, periods, denominator and subset constraints strictly", () => {
    for (const patch of [{ verdict: "PASS" }, { acceptedQuantity: NaN }, { fleet: 2.5 }, { incidents: -1 }, { customerScore: 5.1 }, { date: "2026-02-30" }, { periodEnd: "2026-10-04" }, { observedDays: 3 }, { scheduledHours: 49 }, { downtimeHours: 17 }, { manualReworkQuantity: 2001 }, { shifts: 0 }, { plannedQuantity: 0 }, { date: "2026-10-05" }]) {
      expect(() => parsePilotObservation({ ...observation(), ...patch }), JSON.stringify(patch)).toThrow();
    }
    for (const patch of [{ status: "PASS" }, { maxDowntimePct: 101 }, { minAcceptedPerUnit: 0 }, { minDurationDays: 1.5 }, { maxInterventionsPerShift: Infinity }, { source: "x".repeat(2001) }]) expect(() => parsePilotAcceptanceThresholds({ ...thresholds(), ...patch })).toThrow();
  });
  it("keeps calendar duration exact and working days explicit rather than assuming holidays", () => {
    expect(parsePilotObservation({ ...observation(), dayBasis: "calendar" }).observedDays).toBe(2);
    expect(() => parsePilotObservation({ ...observation(), dayBasis: "calendar", observedDays: 1 })).toThrow();
    expect(parsePilotObservation({ ...observation(), observedDays: 1 }).observedDays).toBe(1);
  });
  it("persists optional raw metadata only, with no backfill into legacy plans or catalogue", () => {
    const p = plan(); expect(parsePilotPlanInput(p)).toEqual(p);
    const parsed = parsePilotPlanInput(p); parsed.actualResult!.source = "changed"; expect(p.actualResult!.source).not.toBe("changed");
    const m = buildProjectModel({ facility: "warehouse", params: { ...WAREHOUSE_BASE_PARAMS }, paramDefs: paramSpecsFor("warehouse"), products: FIXTURE_PRODUCTS, norms: resolveNorms(), scenarios: fixtureSpecs() });
    const legacy = defaultPilotPlan(m, "p1");
    expect(parsePilotPlanInput(legacy)).not.toHaveProperty("actualResult"); expect(legacy).not.toHaveProperty("acceptanceThresholds");
    expect(() => parsePilotPlanInput({ ...p, actualResult: { ...p.actualResult, verdict: "PASS" } })).toThrow();
  });
});
