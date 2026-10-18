import { describe, expect, it } from "vitest";
import { validateProductSeeds } from "../api/import";
import { VENDOR_CLEANING_PRODUCTS } from "../data/vendor-cleaning";
import type { ProductSeed } from "../tz/types";
import { fromCharacteristics, productForCalcFromSeed, sourcedToCharRow } from "./product-for-calc";
import type { OperatingEvidence } from "./operating-evidence";
import { fixtureSpecs } from "../tz/econ/fixtures";
import { validatePendingChanges, validateScenarioSpecs } from "../projects/validate";
import { projectAuditDiff } from "../projects/changes";
import { parseServiceCharacteristic } from "./service-evidence";
import { serviceProviders } from "../implementation/service-directory";

function seedWithObservation(): ProductSeed {
  const seed = structuredClone(VENDOR_CLEANING_PRODUCTS[0]!);
  const evidence: OperatingEvidence = { schemaVersion: "operating-evidence-1", productSlug: seed.slug, process: "cleaning", facility: "warehouse", mode: "scrubbing", unit: "м²/ч", site: "Синтетическая фикстура", measuredAt: "2026-10-01", verifiedAt: "2026-10-02", sourceRef: "Синтетический журнал", measuredBy: "Тест", samples: 3, output: 600, operatingMinutes: 60, elapsedMinutes: 120, basis: "shift-hour", confirmed: true };
  seed.characteristics.operatingEvidence = { value: JSON.stringify(evidence), origin: "research", sourceType: "field-measurement", sourceUrl: null, sourceRef: "Синтетический журнал", date: "2026-10-02", confirmed: true };
  return seed;
}

describe("operating evidence boundary and snapshot", () => {
  it("accepts a private sourced field record and freezes all metadata independently of the nameplate", () => {
    const seed = seedWithObservation(), checked = validateProductSeeds([seed]);
    expect(checked.ok ? [] : checked.issues).toEqual([]);
    const base = productForCalcFromSeed(seed);
    const snapshot = fromCharacteristics({ ...base, solutionTypeSlug: base.solutionType }, Object.entries(seed.characteristics).map(([k, v]) => sourcedToCharRow(k, v)), "2026-10-18");
    expect(snapshot.throughputPerH).toBe(700);
    expect(snapshot.operatingEvidence?.output).toBe(600);
    expect(snapshot.operatingEvidenceConfirmed).toBe(true);
    expect(snapshot.operatingEvidenceEvaluatedOn).toBe("2026-10-18");
    expect(snapshot.sources.find(s => s.key === "operatingEvidence")?.value).toContain("300 м²/ч");
    expect(snapshot.sources.find(s => s.key === "operatingEvidence")?.value).not.toContain("schemaVersion");
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  it.each(["bad-unit", "wrong-model", "missing-site", "fake-confirmation"])("rejects malformed imported evidence: %s", failure => {
    const seed = seedWithObservation();
    const field = seed.characteristics.operatingEvidence!;
    const e = JSON.parse(field.value as string);
    if (failure === "bad-unit") e.unit = "м²/смена";
    if (failure === "wrong-model") e.productSlug = "some-other-robot";
    if (failure === "missing-site") delete e.site;
    if (failure === "fake-confirmation") e.confirmed = false;
    field.value = JSON.stringify(e);
    expect(validateProductSeeds([seed]).ok).toBe(false);
  });

  it("accepts explicit mode changes and records them through the canonical journal diff", () => {
    const before = fixtureSpecs(), after = structuredClone(before);
    after[1]!.items[0]!.operatingMode = "transport";
    const parsed = validateScenarioSpecs(after, "warehouse", [after[1]!.items[0]!.productSlug], ["pallet-transport"]);
    expect(parsed.ok).toBe(true);
    const change = { scenarioKey: after[1]!.key, field: "item:pallet-transport:operatingMode", auto: null, old: null, new: "transport", reason: "Выбран режим наблюдения" };
    expect(validatePendingChanges([change]).ok).toBe(true);
    expect(projectAuditDiff({ params: {}, scenarios: before }, { params: {}, scenarios: after }).some(c => c.field === change.field && c.new === "transport")).toBe(true);
  });

  it("freezes custom service contacts and never silently falls back on invalid explicit contracts", () => {
    const seed = seedWithObservation();
    const custom = { ...serviceProviders("cleaner", "Pudu")[0]!, id: "test-contract", name: "Синтетический сервис теста", responseSla: "4 часа — тестовая фикстура", verification: "contract-reference" as const, sourceRef: "Синтетический договор теста, объект X", sourceUrl: null };
    seed.characteristics.serviceProviders = { value: JSON.stringify([custom]), origin: "research", sourceType: "contract-reference", sourceUrl: null, sourceRef: custom.sourceRef, date: "2026-10-18", confirmed: true };
    expect(validateProductSeeds([seed]).ok).toBe(true);
    const frozen = productForCalcFromSeed(seed);
    expect(frozen.implementation?.providers).toEqual([custom]);
    expect(frozen.sources.find(s => s.key === "serviceProviders")?.value).toContain("Синтетический сервис теста");
    expect(frozen.sources.find(s => s.key === "serviceProviders")?.value).not.toContain('"verification"');
    expect(() => parseServiceCharacteristic([custom], false)).toThrow(/подтверждения/);
    seed.characteristics.serviceProviders.confirmed = false;
    expect(validateProductSeeds([seed]).ok).toBe(false);
    expect(productForCalcFromSeed(seed).implementation?.providers).toEqual([]);
    seed.characteristics.serviceProviders.value = "malformed";
    expect(productForCalcFromSeed(seed).implementation?.providers).toEqual([]);
    expect(frozen.implementation?.providers).toEqual([custom]);
  });
});
