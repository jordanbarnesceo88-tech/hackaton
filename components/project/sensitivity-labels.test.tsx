import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SensitivityRow } from "@/lib/tz/types";
import { SensitivityPanel } from "./sensitivity-panel";

const labels = ["Доля роботизируемого труда уборщиков", "Рабочая выработка за активный час", "Горизонт расчёта"];
const rows: SensitivityRow[] = labels.map((label, i) => ({
  lever: `lever-${i}`, label, unit: "доля", base: .5, low: .3, high: .7,
  boundsSource: "норматив", clampedLow: false, clampedHigh: false,
  npvBase: 0, npvLow: -100, npvHigh: 100, paybackLow: null, paybackHigh: null,
  tcoLow: 100, tcoHigh: 200, swing: 200, signFlip: i === 0,
}));
const renderSvg = (values = rows) => renderToStaticMarkup(createElement(SensitivityPanel, {
  scenarioName: "Уборка", metric: "npv", rows: values,
})).match(/<svg\b[\s\S]*?<\/svg>/)![0];

describe("tornado labels fit their own rows", () => {
  it("wraps the complete cleaning labels, preserving the sign-flip warning", () => {
    const svg = renderSvg();
    const groups = [...svg.matchAll(/<g\b[^>]*opacity="[^"]*"[^>]*>([\s\S]*?)<\/g>/g)];
    for (const [index, group] of groups.entries()) {
      const lines = [...group[1]!.matchAll(/<tspan\b[^>]*>([^<]*)<\/tspan>/g)].map(match => match[1]!);
      expect(lines.join(" ")).toBe(`${labels[index]}${index === 0 ? " ⚠" : ""}`);
      if (index < 2) expect(lines.length).toBeGreaterThan(1);
    }
    expect(groups).toHaveLength(rows.length);
  });

  it("gives wrapped text separate vertical space inside the viewBox without changing the bars", () => {
    const svg = renderSvg(), height = Number(svg.match(/viewBox="0 0 [\d.]+ ([\d.]+)"/)![1]);
    const groups = [...svg.matchAll(/<g\b[^>]*opacity="[^"]*"[^>]*>([\s\S]*?)<\/g>/g)];
    let previousBaseline = 0;
    for (const group of groups) {
      const positions = [...group[1]!.matchAll(/<tspan\b[^>]*x="([\d.]+)"[^>]*y="([\d.]+)"/g)];
      expect(positions.length).toBeGreaterThan(0);
      for (const position of positions) {
        expect(Number(position[1])).toBeGreaterThan(0);
        expect(Number(position[2]) - previousBaseline).toBeGreaterThanOrEqual(14);
        expect(Number(position[2])).toBeLessThan(height);
        previousBaseline = Number(position[2]);
      }
      expect(group[1]!.match(/<rect\b/g)).toHaveLength(2);
    }
  });

  it("keeps the full no-effect suffix and leaves input evidence unchanged", () => {
    const values = [{ ...rows[0]!, npvLow: 10, npvHigh: 10, swing: 0, signFlip: false }];
    const before = structuredClone(values), svg = renderSvg(values);
    const lines = [...svg.matchAll(/<tspan\b[^>]*>([^<]*)<\/tspan>/g)].map(match => match[1]!);
    expect(lines.join(" ")).toBe(`${labels[0]} — не влияет`);
    expect(values).toEqual(before);
  });

  it("keeps the chart font at its native scale with keyboard-accessible scrolling", () => {
    const html = renderToStaticMarkup(createElement(SensitivityPanel, { scenarioName: "Уборка", metric: "npv", rows }));
    expect(html).toContain('aria-label="Диаграмма чувствительности с горизонтальной прокруткой" tabindex="0"');
    expect(html).toContain('class="h-auto max-w-none"');
    expect(html).toContain("Диаграмму можно прокручивать по горизонтали");
  });
});
