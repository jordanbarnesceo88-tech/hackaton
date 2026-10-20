import type { CleaningProfile, ProductForCalc, ScenarioSpec } from "../types";
import { FIXTURE_H1500, fixtureContext } from "./fixtures";

export const TEST_CLEANING_PROFILE: CleaningProfile = { basis: "active-hour", throughputM2PerH: 550,
  workBeforeChargeH: 2, chargeH: 2, windowH: 8, dailyCareMin: 15, initiallyCharged: true, careWithinWindow: true,
  automatableLabourShare: .5, mode: "Влажная уборка", source: "Синтетическая рабочая оценка команды", date: "2026-10-20", reason: "Не полевой замер и не паспортная производительность" };
export const TEST_CLEANER: ProductForCalc = { ...FIXTURE_H1500, slug: "test-cleaner", name: "Тестовый уборщик", solutionType: "cleaner", handlingClass: "cleaner", processes: ["cleaning"],
  throughputPerH: 99999, throughputUnit: "м²/ч", autonomyH: 99, chargeMin: 1, operatingEvidence: undefined };
export function cleaningContext() {
  const ctx = fixtureContext(20, { params: { cleaningAreaM2: 4400, cleaningsPerDay: 1, cleanersCount: 4, cleanerSalaryRubMonth: 65000 } });
  ctx.products[TEST_CLEANER.slug] = TEST_CLEANER;
  return ctx;
}
export function cleaningSpecs(profile: CleaningProfile = TEST_CLEANING_PROFILE): ScenarioSpec[] {
  return [{ key: "asis", name: "Как есть", kind: "asis", items: [] }, { key: "c1", name: "Уборка", kind: "purchase", items: [{ process: "cleaning", productSlug: TEST_CLEANER.slug, cleaningProfile: profile }] }];
}
