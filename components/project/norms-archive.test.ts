import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { normRowsFromSnapshot } from "../../lib/tz/methodology";
import { NORM_DEFS } from "../../lib/tz/norms";
import { fixtureResults } from "../../lib/report/tz/test-fixtures";
import { NormsPanel } from "./norms-panel";
import { readOverride } from "./override-input";

describe("labour input and archived norm panel", () => {
  it("shows recorded simulation-window overrides in their original units", () => {
    const results = fixtureResults();
    const html = renderToStaticMarkup(createElement(NormsPanel, {
      rows: normRowsFromSnapshot(results), overrides: { simPeakMin: 240 }, readOnly: true,
    }));
    expect(html.includes("240 мин")).toBe(true);
    expect(html).toContain("задано вами");
    expect(html).not.toContain("24000 %");
  });

  it("keeps recorded non-common overrides editable with their own bounds and units", () => {
    const rows = NORM_DEFS.map(def => ({ ...def }));
    const html = renderToStaticMarkup(createElement(NormsPanel, {
      rows, overrides: { simPeakMin: 240 }, onOverride: () => {},
    }));
    expect(html.includes('placeholder="240"')).toBe(true);
    expect(html.includes("24000")).toBe(false);
    expect(html.includes("вернуть расчётное")).toBe(true);
    expect(readOverride("240", { range: [30, 480], unit: "мин" })).toEqual({ ok: true, value: 240 });
    expect(readOverride("500", { range: [30, 480], unit: "мин" }).ok).toBe(false);
  });

  it("allows 0–100 percent and explains the pre-exclusion basis and estimate band", () => {
    const rows = NORM_DEFS.map(def => ({ ...def }));
    const html = renderToStaticMarkup(createElement(NormsPanel, { rows, onOverride: () => {} }));
    expect(html).toContain("диапазон 0–100 %");
    expect(html).toContain("до исключения нестандартных грузов");
    expect(html).toContain("30–70 %");
    expect(html).toContain("не подтверждает хронометраж");
    for (const percent of ["0", "10", "90", "100"]) {
      expect(readOverride(percent, { percent: true, range: [0, 1] })).toMatchObject({ ok: true, value: Number(percent) / 100 });
    }
  });

  it("uses saved labels and bounds in read-only overrides, without current-code hints", () => {
    const results = fixtureResults();
    const def = results.methodologySnapshot!.normDefinitions!.find(row => row.key === "laborShareAutomatable")!;
    Object.assign(def, { label: "Сохранённая историческая доля", min: 0.2, max: 0.6, basis: "Историческое обоснование" });
    const html = renderToStaticMarkup(createElement(NormsPanel, {
      rows: normRowsFromSnapshot(results), overrides: { laborShareAutomatable: 0.4 }, readOnly: true,
    }));
    expect(html).toContain("Сохранённая историческая доля");
    expect(html).toContain("Историческое обоснование");
    expect(html).toContain("диапазон 20–60 %");
    expect(html).not.toContain("диапазон 0–100 %");
    expect(html).not.toContain("ввод не подтверждает хронометраж");
  });

  it("shows missing metadata honestly for old snapshots and never adds current normative rows", () => {
    const results = fixtureResults(); delete results.methodologySnapshot;
    const rows = normRowsFromSnapshot(results);
    const html = renderToStaticMarkup(createElement(NormsPanel, { rows, overrides: { laborShareAutomatable: 0.4 }, readOnly: true }));
    expect(html).toContain("Метаданные норматива не сохранены");
    expect(html).toContain("Не сохранено");
    expect(html).not.toContain("диапазон 0–100 %");
    expect(html).not.toContain("Доля труда до исключения нестандартных грузов");
  });
});
