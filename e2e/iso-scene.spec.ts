import { expect, test, type Locator } from "@playwright/test";

async function expectUniqueRoutes(scene: Locator) {
  const ids = await scene.locator("g.iso-routes polyline").evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-route")),
  );
  expect(ids.length).toBeGreaterThan(0);
  expect(new Set(ids).size, "повторное связывание сцены оставило старые маршруты").toBe(ids.length);
}

test("сцена переиспользует маршруты, останавливает пунктир и соблюдает явную тему", async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto("/demo?product=dikom-dmr-carrier-p#simulation");
  const sim = page.locator("#simulation");
  await sim.getByText("Упрощённая аналитическая проверка", { exact: true }).click();
  const scene = sim.locator('svg.iso-root[role="img"]');
  await expect(sim.getByRole("button", { name: "▶ Старт" })).toBeEnabled({ timeout: 60_000 });
  await expectUniqueRoutes(scene);
  const route = scene.locator(".iso-route").first();
  await expect(route).toHaveCSS("animation-play-state", "paused");

  for (const speed of ["×16", "×2", "×8"]) {
    await sim.getByRole("button", { name: speed, exact: true }).click();
    await expectUniqueRoutes(scene);
  }
  await sim.getByRole("button", { name: "▶ Старт" }).click();
  await expect(scene).toHaveAttribute("data-playing", "true");
  await expect(route).toHaveCSS("animation-play-state", "running");
  await expect(scene.locator("text.iso-hud-clock")).not.toHaveText(/^00:00:00/);
  await sim.getByRole("button", { name: "❚❚ Стоп" }).click();
  await expect(scene).toHaveAttribute("data-playing", "false");
  await expect(route).toHaveCSS("animation-play-state", "paused");
  await expectUniqueRoutes(scene);
  const pausedClock = await scene.locator("text.iso-hud-clock").textContent();
  await page.waitForTimeout(300);
  await expect(scene.locator("text.iso-hud-clock")).toHaveText(pausedClock!);

  await sim.getByRole("button", { name: /Сразу к итогу/ }).click();
  await expectUniqueRoutes(scene);
  await expect(route).toHaveCSS("animation-play-state", "paused");

  for (const os of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: os });
    for (const theme of ["", "light", "dark"]) {
      await page.evaluate((value) => {
        document.documentElement.classList.remove("light", "dark");
        if (value) document.documentElement.classList.add(value);
      }, theme);
      const expected = theme === "dark" || (theme === "" && os === "dark") ? "#EAECEC" : "#16282D";
      await expect.poll(() => scene.evaluate((svg) => getComputedStyle(svg).getPropertyValue("--iso-label").trim()))
        .toBe(expected);
    }
  }
});

test("×1 показывает реальное время, быстрый обзор назван отдельно", async ({ page }) => {
  await page.goto("/demo?product=dikom-dmr-carrier-p#simulation");
  const sim = page.locator("#simulation");
  await sim.getByText("Упрощённая аналитическая проверка", { exact: true }).click();
  const clock = sim.locator('svg[role="img"] text.iso-hud-clock');
  await expect(sim.getByRole("button", { name: "▶ Старт" })).toBeEnabled({ timeout: 60_000 });
  await expect(sim.getByRole("button", { name: "×1", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(sim.getByRole("button", { name: "Обзор ×480", exact: true })).toBeVisible();
  await expect(sim.getByText(/×1 — реальное время, ×2 — ускорение вдвое/)).toBeVisible();
  // Дробная секунда сохраняется на паузах: три коротких отрезка дают больше секунды модели.
  for (let i = 0; i < 3; i++) {
    await sim.getByRole("button", { name: "▶ Старт" }).click();
    await page.waitForTimeout(450);
    await sim.getByRole("button", { name: "❚❚ Стоп" }).click();
  }
  await expect(clock).toHaveText(/^00:00:0[1-4] · прогрев$/);
});
