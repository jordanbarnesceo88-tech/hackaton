import { describe, expect, it } from "vitest";
import { assessOperatingEvidence, measuredThroughput, operatingEvidenceText, parseOperatingEvidence, type OperatingEvidence } from "./operating-evidence";

export const evidenceFixture = (): OperatingEvidence => ({
  schemaVersion: "operating-evidence-1", productSlug: "test-cleaner", process: "cleaning", facility: "warehouse", mode: "scrubbing", unit: "м²/ч",
  site: "Тестовый участок (синтетическая фикстура)", measuredAt: "2026-10-01", verifiedAt: "2026-10-02", validUntil: "2026-11-01",
  sourceRef: "Синтетический акт для теста", measuredBy: "Тест", samples: 3, output: 1200, operatingMinutes: 120, elapsedMinutes: 240, basis: "operating-hour", confirmed: true,
});
const context = { productSlug: "test-cleaner", process: "cleaning", facility: "warehouse", mode: "scrubbing", unit: "м²/ч", confirmed: true, asOf: "2026-10-18" };

describe("field operating evidence", () => {
  it("derives hourly production from the declared denominator without inventing idle factors", () => {
    const e = parseOperatingEvidence(JSON.stringify(evidenceFixture()));
    expect(measuredThroughput(e)).toBe(600);
    expect(measuredThroughput({ ...e, basis: "shift-hour" })).toBe(300);
    expect(assessOperatingEvidence(e, context)).toMatchObject({ applied: true, observedPerH: 600, basis: "operating-hour" });
    expect(operatingEvidenceText(e)).toContain("600 м²/ч");
  });

  it.each([
    { samples: 0 }, { samples: 1.5 }, { output: -1 }, { output: NaN }, { operatingMinutes: 0 }, { operatingMinutes: 241 },
    { measuredAt: "2026-02-30" }, { verifiedAt: "2026-09-30" }, { validUntil: "2026-09-30" }, { mode: "" }, { unit: "площадь" },
    { sourceRef: "" }, { site: "" }, { measuredBy: "" }, { sourceUrl: "http://example.org/act" }, { sourceUrl: "https://user:secret@example.org/act" }, { mysteriousFactor: 0.4 },
  ])("rejects malformed context or provenance %j", override => {
    expect(() => parseOperatingEvidence({ ...evidenceFixture(), ...override })).toThrow();
  });

  it.each([
    { mode: undefined }, { mode: "sweeping" }, { unit: "паллет/ч" }, { facility: "airport" }, { productSlug: "other" }, { process: "terminal-cleaning" },
    { confirmed: false }, { asOf: undefined }, { asOf: "2026-09-01" }, { asOf: "2026-12-01" },
  ])("never adopts incompatible, unconfirmed, future or expired observations %j", override => {
    expect(assessOperatingEvidence(evidenceFixture(), { ...context, ...override }).applied).toBe(false);
  });

  it("requires the observation's confirmation and keeps an unknown expiry unknown", () => {
    expect(assessOperatingEvidence({ ...evidenceFixture(), confirmed: false }, context).applied).toBe(false);
    const { validUntil: _expiry, ...withoutExpiry } = evidenceFixture();
    void _expiry;
    expect(assessOperatingEvidence(withoutExpiry, { ...context, asOf: "2028-10-18" }).applied).toBe(true);
    expect(operatingEvidenceText(withoutExpiry)).toContain("срок применимости не задан");
    expect(assessOperatingEvidence(undefined, context).reason).toContain("не предоставлен");
  });
});
