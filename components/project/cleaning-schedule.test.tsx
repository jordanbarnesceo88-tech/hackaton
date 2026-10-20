import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { cleaningWorkingProfile } from "@/lib/data/cleaning-assumptions";
import { cleaningDay, parseCleaningProfile } from "@/lib/tz/econ/cleaning-profile";
import type { CleaningProfile } from "@/lib/tz/types";
import { CleaningSchedule, buildCleaningSchedule } from "./cleaning-schedule";

const profile = cleaningWorkingProfile("pudu-cc1")!;
const text = (html: string) => html.replace(/\s/g, " ");
function verify(input: CleaningProfile) {
  const { segments, day } = buildCleaningSchedule(input);
  expect(segments[0]?.startH).toBe(0); expect(segments.at(-1)?.endH).toBe(input.windowH);
  expect(segments.length).toBeLessThanOrEqual(1441);
  for (const [index, segment] of segments.entries()) {
    expect(segment.endH).toBeGreaterThan(segment.startH);
    if (index) expect(segment.startH).toBe(segments[index - 1]!.endH);
  }
  const hours = (kind: "care" | "cleaning" | "charging") => segments.filter(segment => segment.kind === kind).reduce((sum, segment) => sum + segment.endH - segment.startH, 0);
  expect(hours("care")).toBeCloseTo(day.careHoursPerDay, 9);
  expect(hours("cleaning")).toBeCloseTo(day.activeHoursPerDay, 9);
  expect(hours("charging")).toBeCloseTo(day.chargeHoursPerDay, 9);
  expect(hours("care") + hours("cleaning") + hours("charging")).toBeCloseTo(input.windowH, 9);
  expect(day).toEqual(cleaningDay(parseCleaningProfile(input)));
  expect(day.remainingChargeH).toBeLessThanOrEqual(day.overnightH + 1e-9);
  return { segments, day };
}

describe("analytical cleaning schedule", () => {
  it("matches finite-window shared capacity and one-time care for each explicit model example", () => {
    for (const slug of ["pudu-cc1", "agibot-c5", "viggo-sc80"]) verify(cleaningWorkingProfile(slug)!);
    expect(verify(profile).segments).toEqual([
      { kind: "care", startH: 0, endH: 0.25 }, { kind: "cleaning", startH: 0.25, endH: 2.25 },
      { kind: "charging", startH: 2.25, endH: 4.25 }, { kind: "cleaning", startH: 4.25, endH: 6.25 },
      { kind: "charging", startH: 6.25, endH: 8 },
    ]);
  });

  it.each([
    [8, 0], [6, 2], [7, 1], [5, 2], [1 / 60, 2],
  ])("handles %sh windows and keeps %sh outside-window charge outside area capacity", (windowH, chargeH) => {
    const { day } = verify({ ...profile, dailyCareMin: 0, windowH });
    expect(day.remainingChargeH).toBeCloseTo(chargeH, 9);
  });

  it("bounds the one-robot series at one-minute cycles over a full day without rounding drift", () => {
    const fast = { ...profile, dailyCareMin: 0, windowH: 24, workBeforeChargeH: 1 / 60, chargeH: 1 / 60 };
    const { segments, day } = verify(fast);
    expect(segments).toHaveLength(1440); expect(day.activeHoursPerDay).toBe(12);
    verify({ ...fast, windowH: 23.9, dailyCareMin: 0.001 });
  });

  it("shows planned, unconfirmed area coverage and one representative timeline rather than copying it by fleet", () => {
    const html = text(renderToStaticMarkup(createElement(CleaningSchedule, { profile, fleet: 3, requiredM2PerDay: 5000, productName: "PUDU CC1" })));
    for (const expected of ["Расписание по рабочим допущениям", "не 3D-имитация, полевая проверка или фактическая телеметрия", "Парк: 3 роботов", "отдельная зарядная станция", "6 600,00 / 5 000,00 м²", "132,00%", "Запас 1 600,00", "Ежедневный уход", "Зарядка", "Уборка", "вне окна", "0,25 ч зарядки", "качество уборки ещё не подтверждены", "active-hour", profile.source, profile.reason]) expect(html).toContain(expected);
    expect([...html.matchAll(/<figure/g)]).toHaveLength(1);
    expect(html).toContain('role="meter"'); expect(html).toContain('aria-valuenow="100"');
    expect(html).toContain("00:15:00–02:15:00"); expect(html).toContain("08:00:00–08:15:00");
    expect(html).not.toContain("<canvas"); expect(html).not.toContain("<button");
  });

  it("exposes deficits and guards unknown plan/fleet without NaN or false qualification", () => {
    const html = text(renderToStaticMarkup(createElement(CleaningSchedule, { profile, fleet: 2, requiredM2PerDay: 5000, productName: "PUDU CC1" })));
    expect(html).toContain("88,00% плана"); expect(html).toContain("Дефицит 600,00 м²/день");
    for (const input of [{ fleet: 0, requiredM2PerDay: 5000 }, { fleet: 2, requiredM2PerDay: 0 }, { fleet: NaN, requiredM2PerDay: NaN }]) {
      const unknown = renderToStaticMarkup(createElement(CleaningSchedule, { ...input, profile, productName: "PUDU CC1" }));
      expect(unknown).not.toContain("NaN"); expect(unknown).not.toContain('role="meter"'); expect(unknown).toContain("Не задано");
    }
    const invalid = renderToStaticMarkup(createElement(CleaningSchedule, { profile: { ...profile, chargeH: 0 }, fleet: 2, requiredM2PerDay: 5000, productName: "PUDU CC1" }));
    expect(invalid).toContain('role="alert"'); expect(invalid).not.toContain("<figure");
  });

  it("shows conservative outside recharge for partial work, not a made-up SOC reading", () => {
    const html = text(renderToStaticMarkup(createElement(CleaningSchedule, { profile: cleaningWorkingProfile("agibot-c5")!, fleet: 5, requiredM2PerDay: 17000, productName: "AGIBOT C5" })));
    expect(html).toContain("1,00 ч зарядки вне окна"); expect(html).toContain("принят полный цикл зарядки");
    expect(html).toContain("Уровень заряда и кривая заряда АКБ не рассчитываются");
    expect(html).toContain("вне окна площадь уборки не добавляется");
  });
});
