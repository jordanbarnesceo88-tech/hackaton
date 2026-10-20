import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CostPackage } from "@/lib/tz/types";
import { CostPackageEditor, parseCostPackageForm } from "./cost-package";

const packageValue: CostPackage = {
  softwareIncludedInIntegration: true, repairsIncludedInService: true, includedChargers: 0,
  allChargersIncluded: true, startup: { mode: "separate", amountRub: 80000, basis: "per-site" },
  platformMonthly: { mode: "separate", amountRub: 12200, basis: "per-robot" }, reason: "Условия предложения поставщика",
};
function form(patch: Record<string, string | null> = {}) {
  const values: Record<string, string | null> = {
    software: "on", repair: "on", allChargers: "on", reason: packageValue.reason,
    "startup-mode": "separate", "startup-amount": "80000", "startup-basis": "per-site",
    "platformMonthly-mode": "separate", "platformMonthly-amount": "12200", "platformMonthly-basis": "per-robot", ...patch,
  };
  const data = new FormData(); for (const [key, value] of Object.entries(values)) if (value !== null) data.set(key, value);
  return data;
}
const text = (html: string) => html.replace(/\s/g, " ");

describe("purchase cost-package editor", () => {
  it("round-trips optional startup, recurring platform and all-stations terms without losing older flags", () => {
    expect(parseCostPackageForm(form(), 6)).toEqual(packageValue);
    expect(parseCostPackageForm(form({ chargers: "999" }), 6).includedChargers).toBe(0);
    const source = "А".repeat(1000);
    expect(parseCostPackageForm(form({ reason: source }), 6).reason).toBe(source);
    expect(parseCostPackageForm(form({ "startup-basis": "per-robot", "platformMonthly-basis": "per-site", allChargers: null, chargers: "2" }), 6)).toMatchObject({
      includedChargers: 2, startup: { mode: "separate", amountRub: 80000, basis: "per-robot" },
      platformMonthly: { mode: "separate", amountRub: 12200, basis: "per-site" },
    });
  });

  it("leaves absent scopes at legacy semantics and preserves explicit unknown costs as unknown", () => {
    const legacy = parseCostPackageForm(form({ "startup-mode": "legacy", "platformMonthly-mode": "legacy", allChargers: null, chargers: "0", software: null, repair: null }), 6);
    expect(legacy).toEqual({ softwareIncludedInIntegration: false, repairsIncludedInService: false, includedChargers: 0, reason: packageValue.reason });
    expect(parseCostPackageForm(form({ "startup-mode": "included", "platformMonthly-mode": "unassessed" }), 6)).toMatchObject({ startup: { mode: "included" }, platformMonthly: { mode: "unassessed" } });
    expect(parseCostPackageForm(form({ "startup-mode": "unassessed", "platformMonthly-mode": "included" }), 6)).toMatchObject({ startup: { mode: "unassessed" }, platformMonthly: { mode: "included" } });
  });

  it("rejects blank or invalid amounts, incomplete bases, excess fixed stations and overlong sources", () => {
    const invalid: Record<string, string | null>[] = [
      { "startup-amount": "" }, { "startup-amount": "-1" }, { "platformMonthly-amount": "Infinity" },
      { "platformMonthly-amount": "1000000000001" }, { "startup-basis": "other" }, { "startup-mode": null },
      { allChargers: null, chargers: "7" }, { allChargers: null, chargers: "" }, { allChargers: null, chargers: "0.5" },
      { reason: " " }, { reason: "А".repeat(1001) },
    ];
    for (const patch of invalid) expect(() => parseCostPackageForm(form(patch), 6)).toThrow();
    expect(() => parseCostPackageForm(form(), NaN)).toThrow();
    expect(parseCostPackageForm(form({ "startup-amount": "0", "platformMonthly-amount": "0" }), 6)).toMatchObject({ startup: { amountRub: 0 }, platformMonthly: { amountRub: 0 } });
  });

  it("keeps defaults explicitly separate without pre-filling a quotation or calling apply", () => {
    const onChange = vi.fn();
    const html = renderToStaticMarkup(createElement(CostPackageEditor, { chargers: 6, onChange }));
    expect([...html.matchAll(/value="legacy" selected/g)]).toHaveLength(2);
    expect(html).not.toContain(" checked"); expect(html).not.toContain('name="startup-amount"');
    expect(html).not.toContain('value="80000"'); expect(html).not.toContain('value="12200"');
    expect(html).toContain("заменяет исходные статьи интеграции"); expect(html).toContain("заменяет исходную годовую оценку лицензии");
    expect([...html.matchAll(/<form/g)]).toHaveLength(1); expect(onChange).not.toHaveBeenCalled();
  });

  it("read-only output retains all scope, periods, bases and the full source without editable controls", () => {
    const source = "А".repeat(1000);
    const html = text(renderToStaticMarkup(createElement(CostPackageEditor, { value: { ...packageValue, reason: source }, chargers: 6, readOnly: true, onChange: vi.fn() })));
    for (const expected of [source, "Все необходимые станции", "сейчас 6", "фиксированное число в данных — 0", "80 000,00 ₽ разово за всю площадку", "12 200,00 ₽/мес за каждого робота", "ставка × 12 × число роботов", "включено в интеграцию / запуск", "включён в сервис"]) expect(html).toContain(expected);
    for (const tag of ["<input", "<select", "<textarea", "<form", "<button"]) expect(html).not.toContain(tag);
    const site = text(renderToStaticMarkup(createElement(CostPackageEditor, { value: { ...packageValue, platformMonthly: { mode: "separate", amountRub: 12200, basis: "per-site" } }, chargers: 6, readOnly: true })));
    expect(site).toContain("без умножения на число роботов");
    const unknown = renderToStaticMarkup(createElement(CostPackageEditor, { value: { ...packageValue, startup: { mode: "unassessed" }, platformMonthly: { mode: "included" } }, chargers: 6 }));
    expect(unknown).toContain("финансовый расчёт остановится"); expect(unknown).toContain("отдельный платёж не начисляется"); expect(unknown).not.toContain("<form");
  });

  it("labels fields uniquely, shows all-stations as disabled zero and preserves entered optional amounts", () => {
    const html = renderToStaticMarkup(createElement(CostPackageEditor, { value: packageValue, chargers: 6, onChange: () => {} }));
    const ids = [...html.matchAll(/<label[^>]*for="([^"]+)"/g)].map(match => match[1]!);
    expect(new Set(ids).size).toBe(ids.length); for (const id of ids) expect(html).toContain(`id="${id}"`);
    const stationInput = html.match(/<input\b[^>]*name="chargers"[^>]*>/)?.[0];
    expect(stationInput).toContain('disabled=""'); expect(stationInput).toContain('value="0"');
    expect(html).toContain('name="startup-amount"'); expect(html).toContain('value="80000"');
    expect(html).toContain('name="platformMonthly-amount"'); expect(html).toContain('value="12200"');
    expect([...html.matchAll(/<form/g)]).toHaveLength(1);
  });
});
