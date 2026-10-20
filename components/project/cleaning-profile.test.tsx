import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { cleaningDay } from "@/lib/tz/econ/cleaning-profile";
import { cleaningWorkingProfile } from "@/lib/data/cleaning-assumptions";
import { CleaningProfileEditor, cleaningWorkingEstimate, parseCleaningProfileDraft, type CleaningProfileDraft } from "./cleaning-profile";

const draft: CleaningProfileDraft = {
  throughputM2PerH: "550", workBeforeChargeH: "2", chargeH: "2", dailyCareMin: "15", windowH: "8",
  automatableLabourPct: "50", mode: "Влажная мойка плитки", source: "Оценка команды", date: "2026-10-20", reason: "Проверить на объекте",
};
const text = (html: string) => html.replace(/\s/g, " ");

describe("cleaning working-profile editor", () => {
  it("converts editable percentages exactly once and delegates all domain validation", () => {
    const profile = parseCleaningProfileDraft({ ...draft, automatableLabourPct: "25,5" });
    expect(profile.automatableLabourShare).toBe(0.255);
    expect(profile).toMatchObject({ basis: "active-hour", initiallyCharged: true, careWithinWindow: true, throughputM2PerH: 550 });
    expect(profile).not.toHaveProperty("calibratedOperatingEvidence");
    for (const patch of [
      { throughputM2PerH: "" }, { dailyCareMin: "" }, { automatableLabourPct: "" },
      { automatableLabourPct: "101" }, { chargeH: "0" }, { dailyCareMin: "480" },
      { windowH: "25" }, { source: " " }, { date: "2026-02-30" }, { throughputM2PerH: "Infinity" },
    ]) expect(() => parseCleaningProfileDraft({ ...draft, ...patch })).toThrow();
    expect(parseCleaningProfileDraft({ ...draft, dailyCareMin: "0", automatableLabourPct: "0" })).toMatchObject({ dailyCareMin: 0, automatableLabourShare: 0 });
    expect(parseCleaningProfileDraft({ ...draft, automatableLabourPct: "100" }).automatableLabourShare).toBe(1);
  });

  it.each([
    ["pudu-cc1", 550, 2, 2, 2200], ["agibot-c5", 600, 2, 1, 3450], ["viggo-sc80", 1500, 4, 2, 8625],
  ] as const)("keeps %s as explicit model-specific estimates, not catalogue or shift-hour defaults", (slug, throughput, work, charge, dailyArea) => {
    const estimate = cleaningWorkingEstimate(slug)!;
    expect(estimate).toMatchObject({ throughputM2PerH: throughput, workBeforeChargeH: work, chargeH: charge, windowH: 8, dailyCareMin: 15, automatableLabourShare: 0.5, date: "2026-10-20" });
    expect(cleaningDay(estimate).capacityM2PerDay).toBe(dailyArea);
    expect(estimate).toEqual(cleaningWorkingProfile(slug));
    expect(estimate.mode).toContain("кафеля");
    expect(estimate.source).toContain("Экспертная оценка команды");
    if (slug === "viggo-sc80") expect(estimate.reason).toContain("не подтверждена");
  });

  it("starts missing profiles blank and never applies an example merely by rendering", () => {
    const onChange = vi.fn();
    const html = text(renderToStaticMarkup(createElement(CleaningProfileEditor, { productSlug: "pudu-cc1", onChange })));
    expect(html).toContain("Рабочий профиль не задан");
    expect(html).toContain("паспортная производительность автоматически не подставляется");
    expect(html).toContain("Заполнить рабочую оценку");
    expect(html).toContain('name="throughputM2PerH"');
    expect(html).not.toContain('value="550"');
    expect(html).not.toContain('value="700"');
    expect(html).not.toContain('type="checkbox"');
    expect(html).toContain("отдельная зарядная станция");
    expect(html).toContain("не подтверждённая выработка на объекте или результат 3D-проверки");
    expect(onChange).not.toHaveBeenCalled();
    for (const slug of ["unknown", "pudu-cc1-pro", "avtomakon-ak-sc80", "__proto__", "constructor"]) {
      expect(cleaningWorkingEstimate(slug)).toBeUndefined();
      expect(renderToStaticMarkup(createElement(CleaningProfileEditor, { productSlug: slug, onChange }))).not.toContain("Заполнить рабочую оценку");
    }
  });

  it("preserves the entire accepted source, mode, basis and numeric values in read-only output", () => {
    const value = parseCleaningProfileDraft({ ...draft, source: "А".repeat(1000), reason: "Б".repeat(1000) });
    const html = text(renderToStaticMarkup(createElement(CleaningProfileEditor, { productSlug: "pudu-cc1", value, readOnly: true, onChange: vi.fn() })));
    expect(html).toContain("А".repeat(1000)); expect(html).toContain("Б".repeat(1000));
    for (const expected of ["active-hour", "550,00", "2,00 ч / 2,00 ч", "8,00 ч / 15,00 мин", "50,00%", "2026-10-20", value.mode, "Полный заряд", "один раз"]) expect(html).toContain(expected);
    for (const tag of ["<input", "<textarea", "<form", "<button"]) expect(html).not.toContain(tag);
    const noCallback = renderToStaticMarkup(createElement(CleaningProfileEditor, { productSlug: "pudu-cc1", value }));
    expect(noCallback).toContain("data-cleaning-profile-readonly");
    const absent = renderToStaticMarkup(createElement(CleaningProfileEditor, { productSlug: "pudu-cc1", readOnly: true }));
    expect(absent).toContain("Рабочий профиль не задан"); expect(absent).not.toContain("Заполнить рабочую оценку");
  });

  it("associates each field with a unique label across multiple scenario items", () => {
    const html = renderToStaticMarkup(createElement("div", null,
      createElement(CleaningProfileEditor, { productSlug: "pudu-cc1", value: cleaningWorkingEstimate("pudu-cc1"), onChange: () => {} }),
      createElement(CleaningProfileEditor, { productSlug: "agibot-c5", onChange: () => {} }),
    ));
    const ids = [...html.matchAll(/<label[^>]*for="([^"]+)"/g)].map(match => match[1]!);
    expect(ids).toHaveLength(20); expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(html).toContain(`id="${id}"`);
    expect(html).toContain('name="automatableLabourPct"');
    expect(html).toContain('value="50"');
    expect(html).toContain("Убрать рабочий профиль");
  });
});
