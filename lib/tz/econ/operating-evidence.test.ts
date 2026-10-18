import { describe, expect, it } from "vitest";
import type { OperatingEvidence } from "../../catalog/operating-evidence";
import { computeScenariosCore } from "./core";
import { fixtureContext, fixtureSpecs, FIXTURE_H1500 } from "./fixtures";
import { throughputFor } from "./fleet";
import { scenarioRisks } from "./risks";

function input(basis: OperatingEvidence["basis"] = "shift-hour", observedPerH = 10) {
  const ctx = fixtureContext();
  const evidence: OperatingEvidence = { schemaVersion: "operating-evidence-1", productSlug: FIXTURE_H1500.slug, process: "pallet-transport", facility: "warehouse", mode: "transport", unit: "паллет/ч",
    site: "Синтетический тестовый участок", measuredAt: "2026-10-01", verifiedAt: "2026-10-02", validUntil: "2026-11-01", sourceRef: "Синтетический акт теста", measuredBy: "Тест", samples: 3,
    operatingMinutes: 60, elapsedMinutes: 120, output: observedPerH * (basis === "shift-hour" ? 2 : 1), basis, confirmed: true };
  ctx.products = { ...ctx.products, [FIXTURE_H1500.slug]: { ...FIXTURE_H1500, operatingEvidence: evidence, operatingEvidenceConfirmed: true, operatingEvidenceEvaluatedOn: "2026-10-18" } };
  const specs = fixtureSpecs();
  specs[1]!.items[0]!.operatingMode = "transport";
  specs[2]!.items[0]!.operatingMode = "transport";
  return { ctx, specs };
}

describe("field evidence through real financial calculations", () => {
  it("does not auto-adopt an observation when a historical scenario has no operating mode", () => {
    const { ctx, specs } = input();
    delete specs[1]!.items[0]!.operatingMode;
    const actual = throughputFor(ctx, specs[1]!.items[0]!);
    const original = throughputFor(fixtureContext(), fixtureSpecs()[1]!.items[0]!);
    expect(actual.thrEff).toBe(original.thrEff);
    expect(actual.evidence?.applied).toBe(false);
  });

  it("caps shift-hour capacity once and produces the expected fleet and equipment cost", () => {
    const { ctx, specs } = input("shift-hour", 10);
    const purchase = computeScenariosCore(ctx, specs).find(r => r.kind === "purchase")!;
    expect(purchase.status).toBe("ok");
    if (purchase.status !== "ok") throw new Error(purchase.refusal.message);
    const item = purchase.items[0]!;
    const expectedN = Math.ceil(item.peakPerHour / 10 * (1 + ctx.norms.reservePct) - 1e-9);
    expect(item.nAuto).toBe(expectedN);
    expect(item.thrEff).toBe(10);
    expect(item.thrEvidence?.applied).toBe(true);
    expect(purchase.capexLines.find(l => l.key === "equipment")?.valueRub).toBe(expectedN * FIXTURE_H1500.priceRub!);
    expect(purchase.trace.find(t => t.key === "fleet")?.substituted).toContain("× 1 × 1");
    expect(Number.isFinite(purchase.npvRub)).toBe(true);
  });

  it("retains separate downtime for a productive-hour observation", () => {
    const { ctx, specs } = input("operating-hour", 10);
    const actual = computeScenariosCore(ctx, specs).find(r => r.kind === "purchase")!;
    if (actual.status !== "ok") throw new Error(actual.refusal.message);
    const item = actual.items[0]!;
    expect(item.nAuto).toBe(Math.ceil(item.peakPerHour / (10 * ctx.norms.utilization * ctx.norms.availability) * (1 + ctx.norms.reservePct) - 1e-9));
  });

  it("explains zero measured output instead of silently restoring the nameplate", () => {
    const { ctx, specs } = input("shift-hour", 0);
    const actual = computeScenariosCore(ctx, specs).find(r => r.kind === "purchase")!;
    expect(actual.status).toBe("refused");
    if (actual.status !== "refused") throw new Error("A zero-output observation must not be financed as productive");
    expect(actual.refusal.message).toContain("нулевую выработку");
    expect(actual.refusal.message).toContain("Паспортная производительность её не заменяет");
  });

  it("never raises conservative model capacity even when the observed shift performs better", () => {
    const { ctx, specs } = input("shift-hour", 1000);
    const baseline = computeScenariosCore(fixtureContext(), fixtureSpecs()).find(r => r.kind === "purchase")!;
    const actual = computeScenariosCore(ctx, specs).find(r => r.kind === "purchase")!;
    if (actual.status !== "ok" || baseline.status !== "ok") throw new Error("Expected real purchase calculations");
    expect(actual.items[0]!.nAuto).toBe(baseline.items[0]!.nAuto);
    expect(actual.capexRub).toBe(baseline.capexRub);
    expect(actual.npvRub).toBeCloseTo(baseline.npvRub!, 5);
  });

  it("uses the scenario's own downtime norms when comparing a shift-hour observation", () => {
    const { ctx, specs } = input("shift-hour", 1000);
    const ordinarySpecs = fixtureSpecs();
    const overrides = { utilization: .7, availability: .9 };
    specs[1]!.normOverrides = overrides;
    ordinarySpecs[1]!.normOverrides = overrides;
    const baseline = computeScenariosCore(fixtureContext(), ordinarySpecs).find(r => r.kind === "purchase")!;
    const actual = computeScenariosCore(ctx, specs).find(r => r.kind === "purchase")!;
    if (actual.status !== "ok" || baseline.status !== "ok") throw new Error("Expected comparable purchase scenarios");
    expect(actual.items[0]!.thrEff).toBeCloseTo(baseline.items[0]!.thrEff! * overrides.utilization * overrides.availability, 8);
    expect(actual.items[0]!.nAuto).toBe(baseline.items[0]!.nAuto);
    expect(actual.capexRub).toBe(baseline.capexRub);
    expect(actual.npvRub).toBeCloseTo(baseline.npvRub!, 5);
  });

  it.each(["unit", "confirmation", "expiry", "future", "mode"])("does not treat incompatible %s as operating fact", reason => {
    const { ctx, specs } = input();
    const p = ctx.products[FIXTURE_H1500.slug]!;
    if (reason === "unit") p.operatingEvidence!.unit = "м²/ч";
    if (reason === "confirmation") p.operatingEvidenceConfirmed = false;
    if (reason === "expiry") p.operatingEvidenceEvaluatedOn = "2026-12-01";
    if (reason === "future") p.operatingEvidenceEvaluatedOn = "2026-09-01";
    if (reason === "mode") specs[1]!.items[0]!.operatingMode = "scrubbing";
    const result = throughputFor(ctx, specs[1]!.items[0]!);
    expect(result.evidence?.applied).toBe(false);
    expect(result.thrEff).toBe(throughputFor(fixtureContext(), fixtureSpecs()[1]!.items[0]!).thrEff);
    const purchase = computeScenariosCore(ctx, specs).find(r => r.kind === "purchase")!;
    expect(scenarioRisks(ctx, purchase, [], specs[1]).some(r => r.code === "FIELD_OBSERVATION_NOT_APPLIED" && r.text.includes(result.evidence!.reason))).toBe(true);
  });
});
