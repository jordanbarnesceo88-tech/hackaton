import { test, expect } from "@playwright/test";
import { createOwnedArchive } from "./legacy-support";

test("retired editable URL cannot mutate an owned archive; guest and foreign access stay protected", async ({ page, browser }) => {
  const fixture = await createOwnedArchive(page);
  const stranger = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": `e2e-archive-foreign-${Date.now()}` } });
  try {
    await page.goto(`/calculate/${fixture.solution.id}?analysis=${fixture.analysis.id}&quantityOverride=999&capexPerUnitUsdOverride=1&ops=999999&userId=forged-owner`);
    await expect(page).toHaveURL(new RegExp(`/report/${fixture.analysis.id}$`));
    await expect(page.locator("[data-legacy-report]")).toContainText("просмотр без сохранения");
    await expect(page.getByText(/количество единиц — 6/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Сохранить расчёт", exact: true })).toHaveCount(0);
    await expect(page.locator("#analysis-name, #quantityOverride, #capexPerUnitUsdOverride")).toHaveCount(0);
    expect(await fixture.db.savedAnalysis.findUniqueOrThrow({ where: { id: fixture.analysis.id } })).toEqual(fixture.analysis);

    const mismatch = await page.goto(`/calculate/not-the-saved-solution?analysis=${fixture.analysis.id}`);
    expect(mismatch?.status()).toBe(404);
    const guest = await stranger.newPage();
    await guest.goto(`/calculate/${fixture.solution.id}?analysis=${fixture.analysis.id}`);
    await expect(guest).toHaveURL(/\/login(?:\?|$)/);
    await expect(guest.getByRole("heading", { name: "Вход", exact: true })).toBeVisible();

    // A different real session must not learn another owner's record via either archive route.
    const foreign = await createOwnedArchive(guest);
    try {
      const direct = await guest.goto(`/report/${fixture.analysis.id}`);
      expect(direct?.status()).toBe(404);
      const legacy = await guest.goto(`/calculate/${fixture.solution.id}?analysis=${fixture.analysis.id}`);
      expect(legacy?.status()).toBe(404);
      await guest.goto("/analyses");
      await expect(guest.locator(`a[href="/report/${fixture.analysis.id}"]`)).toHaveCount(0);
      await expect(guest.locator(`a[href="/report/${foreign.analysis.id}"]`)).toHaveCount(1);
    } finally { await foreign.cleanup(); }
    expect(await fixture.db.savedAnalysis.count({ where: { userId: fixture.owner.id } })).toBe(1);
    expect(await fixture.db.savedAnalysis.findUniqueOrThrow({ where: { id: fixture.analysis.id } })).toEqual(fixture.analysis);
  } finally { await stranger.close(); await fixture.cleanup(); }
});
