import { test, expect, type Page } from "@playwright/test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { createSpatialProjectSnapshot, parseSpatialProjectResult, type SpatialProjectSnapshot } from "../lib/sim/spatial-bridge";
import type { SimInput } from "../lib/sim/types";
import type { ProjectResults } from "../lib/tz/types";
import { businessExampleInputs } from "../lib/projects/business-examples";
import { baseValuesFor, paramSpecsFor } from "../lib/data/organizer/params";
import { CATALOG } from "../lib/data/organizer/catalog";
import { productForCalcFromSeed } from "../lib/catalog/product-for-calc";
import { buildProjectModel } from "../lib/tz/model";
import { resolveNorms } from "../lib/tz/norms";

type DemoWindow = Window & {
  warehouseDemo: { calculationMode(): string; snapshot(): { caseId: string; input: SimInput; projectOrigin?: { requestId: string; scenarioKey: string; sourceInput: SimInput; sourceInputKey: string }; frame: { tS: number }; busy: boolean } };
  routingPeer?: { snapshot: SpatialProjectSnapshot; child: Window | null; ready: boolean; result: unknown; error: string | null };
  spatialMessages?: { origin: string; fromChild: boolean; data: { requestId?: string } }[];
};

test.use({ launchOptions: { args: ["--enable-unsafe-swiftshader"] } });

function observeErrors(page: Page, errors: string[]) {
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
}

async function ready(page: Page, domain: "warehouse" | "cleaning") {
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true", { timeout: 60_000 });
  await expect(page.locator("body")).toHaveAttribute("data-domain", domain);
  expect(await page.evaluate(() => (window as unknown as DemoWindow).warehouseDemo.calculationMode())).toBe("worker");
  await expect(page.locator("#stage canvas").first()).toBeVisible();
  await expect(page.locator("#work-status")).toContainText("история одного полного прогона", { timeout: 120_000 });
  const state = await page.evaluate(() => (window as unknown as DemoWindow).warehouseDemo.snapshot());
  await expect(page.locator("#work-lanes .work-row")).toHaveCount(state.input.robots.count);
  const segments = page.locator("#work-lanes .work-state-lane .work-segment");
  const target = await segments.evaluateAll((buttons, time) => buttons.map((button, index) => ({
    index, start: Number((button as HTMLElement).dataset.start), width: button.getBoundingClientRect().width,
  })).filter(button => button.width >= 4 && Math.abs(button.start - time) > 2)
    .sort((a, b) => Math.abs(a.start - time) - Math.abs(b.start - time))[0], state.frame.tS);
  expect(target).toBeTruthy();
  if (!target) throw new Error("Timeline contains no clickable state intervals");
  const segment = segments.nth(target.index);
  await segment.hover();
  await expect(page.locator("#work-caption strong")).toContainText(" — ");
  await segment.click();
  await expect.poll(() => page.evaluate(start => {
    const snapshot = (window as unknown as DemoWindow).warehouseDemo.snapshot();
    return !snapshot.busy && Math.abs(snapshot.frame.tS - start) <= 0.11;
  }, target.start)).toBe(true);
}

test("clean viewer routes, crosslinks, legacy redirect fragments and offline files", async ({ page, baseURL }, testInfo) => {
  test.setTimeout(180_000);
  if (!baseURL) throw new Error("Viewer routes require Playwright baseURL");
  const errors: string[] = [];
  observeErrors(page, errors);
  const response = await page.goto("/demo/warehouse?case=warehouse#trace");
  expect(response?.status()).toBe(200);
  expect(response?.headers()["content-security-policy"]).toMatch(/worker-src[^;]*blob:/);
  await ready(page, "warehouse");
  await expect(page.locator("#complex-demo-link")).toHaveAttribute("href", "/demo/warehouse?case=complex");
  await expect(page.locator("#cleaning-demo-link")).toHaveAttribute("href", "/demo/cleaning");
  expect(await page.locator("#demo-link").getAttribute("href")).toBe("/demo/cleaning");
  await testInfo.attach("warehouse-viewer", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  await page.locator("#demo-link").click();
  await expect(page).toHaveURL(new URL("/demo/cleaning", baseURL).href);
  await ready(page, "cleaning");
  await expect(page.locator("#complex-demo-link")).toHaveAttribute("href", "/demo/warehouse?case=complex");
  await expect(page.locator("#cleaning-demo-link")).toHaveAttribute("href", "/demo/cleaning");
  expect(await page.locator("#demo-link").getAttribute("href")).toBe("/demo/warehouse");
  await testInfo.attach("cleaning-viewer", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  await page.locator("#demo-link").click();
  await ready(page, "warehouse");

  for (const [file, canonical, domain] of [
    ["warehouse-3d.html", "/demo/warehouse", "warehouse"],
    ["cleaning-3d.html", "/demo/cleaning", "cleaning"],
  ] as const) {
    const redirect = await page.request.get(`/${file}?case=kept&flag=1`, { maxRedirects: 0 });
    expect(redirect.status()).toBe(308);
    const location = redirect.headers().location;
    expect(location).toBeTruthy();
    const destination = new URL(location!, baseURL);
    expect(destination.pathname).toBe(canonical);
    expect(destination.searchParams.get("case")).toBe("kept");
    expect(destination.searchParams.get("flag")).toBe("1");
    await page.goto(`/${file}?case=kept&flag=1#history`);
    await ready(page, domain);
    const actual = new URL(page.url());
    expect(actual.pathname).toBe(canonical);
    expect(actual.searchParams.get("case")).toBe("kept");
    expect(actual.hash).toBe("#history");
  }

  await page.goto(pathToFileURL(resolve("public/warehouse-3d.html")).href);
  await ready(page, "warehouse");
  await expect(page.locator("#complex-demo-link")).toHaveAttribute("href", "./warehouse-3d.html?case=complex");
  await expect(page.locator("#cleaning-demo-link")).toHaveAttribute("href", "./cleaning-3d.html");
  expect(await page.locator("#demo-link").getAttribute("href")).toBe("./cleaning-3d.html");
  await page.locator("#demo-link").click();
  await ready(page, "cleaning");
  expect(new URL(page.url()).protocol).toBe("file:");
  expect(new URL(page.url()).pathname).toMatch(/\/cleaning-3d\.html$/);
  expect(await page.locator("#demo-link").getAttribute("href")).toBe("./warehouse-3d.html");
  expect(errors).toEqual([]);
});

test("warehouse case URL selects its scenario and explicit switching preserves other URL state", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  observeErrors(page, errors);
  await page.goto("/demo/warehouse?case=baseline&flag=1#history");
  await ready(page, "warehouse");
  await expect(page.locator('[data-case="baseline"]')).toHaveAttribute("aria-pressed", "true");
  expect(new URL(page.url()).searchParams.get("case")).toBe("baseline");

  await page.locator('[data-case="complex"]').click();
  await expect(page.locator('[data-case="complex"]')).toHaveAttribute("aria-pressed", "true", { timeout: 60_000 });
  await ready(page, "warehouse");
  const switched = new URL(page.url());
  expect(switched.searchParams.get("case")).toBe("complex");
  expect(switched.searchParams.get("flag")).toBe("1");
  expect(switched.hash).toBe("#history");
  expect(errors).toEqual([]);
});

test("reloading a selected warehouse case rebuilds its full history from the same input", async ({ page, browser }, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  observeErrors(page, errors);
  const lifecycle: { event: string; at: string }[] = [];
  const record = (event: string) => lifecycle.push({ event, at: new Date().toISOString() });
  const onCrash = () => { record("page-crash"); };
  const onClose = () => { record("page-close"); };
  const onDisconnect = () => { record("browser-disconnected"); };
  page.on("crash", onCrash);
  page.on("close", onClose);
  browser.on("disconnected", onDisconnect);
  try {
    await page.goto("/demo/warehouse?case=complex&flag=1#history");
    record("initial-navigation-loaded");
    await expect(page.locator("body")).toHaveAttribute("data-ready", "true", { timeout: 60_000 });
    await expect.poll(() => page.evaluate(() => {
      const state = (window as unknown as DemoWindow).warehouseDemo.snapshot();
      return !state.busy && state.caseId === "complex";
    })).toBe(true);
    await expect(page.locator('[data-case="complex"]')).toHaveAttribute("aria-pressed", "true");
    const beforeReload = await page.evaluate(() => (window as unknown as DemoWindow).warehouseDemo.snapshot().input);
    const beforeUrl = page.url();

    // The route contract needs the installed worker result; full-history replay is checked after reload.
    await page.reload();
    await ready(page, "warehouse");
    await expect(page.locator('[data-case="complex"]')).toHaveAttribute("aria-pressed", "true");
    expect(page.url()).toBe(beforeUrl);
    const reloaded = await page.evaluate(() => (window as unknown as DemoWindow).warehouseDemo.snapshot());
    expect(reloaded.caseId).toBe("complex");
    expect(reloaded.input).toEqual(beforeReload);
    expect(errors).toEqual([]);
    record("full-reload-history-and-input-verified");
  } finally {
    await testInfo.attach("viewer-lifecycle", { body: JSON.stringify({ lifecycle, errors }, null, 2), contentType: "application/json" });
    page.off("crash", onCrash);
    page.off("close", onClose);
    browser.off("disconnected", onDisconnect);
  }
});

test("guest closed-pod scenario opens its exact server input through the clean 3D popup route", async ({ page, baseURL }) => {
  test.setTimeout(240_000);
  if (!baseURL) throw new Error("Viewer popup requires Playwright baseURL");
  const errors: string[] = [];
  observeErrors(page, errors);
  const response = page.waitForResponse(r => r.url().endsWith("/api/v1/demo-calculation") && r.request().method() === "POST", { timeout: 120_000 });
  await page.goto("/demo?example=steady-flow");
  const receipt = await response;
  expect(receipt.status(), await receipt.text()).toBe(200);
  const { results } = await receipt.json() as { results: ProjectResults };
  const input = results.runtime?.simInputs.purchase?.calculated;
  expect(input?.transportWorkflow).toBe("closed-pod-1");
  if (!input) throw new Error("The server did not return a canonical purchase simulation input");
  expect(results.scenarios.find(s => s.key === "purchase")?.items[0]?.productSlug).toBe("ronavi-h1500");
  await expect(page.locator("[data-guest-calculation]")).toHaveAttribute("data-guest-calculation", "ready", { timeout: 120_000 });
  expect((await page.request.post("/api/v1/calculate", { data: { facility: "warehouse" } })).status()).toBe(404);
  await page.getByRole("navigation", { name: "Шаги расчёта" }).getByRole("link", { name: /^7 / }).click();
  const simulation = page.locator("#simulation");
  await simulation.getByLabel("Сценарий", { exact: true }).selectOption("purchase");
  await expect(simulation.locator('[data-validation-kind="spatial"]')).toHaveAttribute("data-spatial-receipt", results.scenarios.find(s => s.key === "purchase")!.spatialEvidence!.assessment.status);
  await expect(simulation.getByRole("definition").first()).toBeVisible();
  await page.evaluate(() => {
    const local = window as unknown as DemoWindow;
    local.spatialMessages = [];
    window.addEventListener("message", event => {
      if (event.origin !== location.origin || event.data?.type !== "spatial-project-result") return;
      local.spatialMessages?.push({ origin: event.origin, fromChild: (event.source as Window | null)?.opener === window, data: event.data });
    });
  });
  const open = page.getByRole("button", { name: "Проверить этот вариант в 3D ↗", exact: true });
  await expect(open).toBeEnabled({ timeout: 60_000 });
  const popup = page.waitForEvent("popup");
  await open.click();
  const child = await popup;
  observeErrors(child, errors);
  await child.waitForURL(url => url.pathname === "/demo/warehouse" && /^#project=/.test(url.hash));
  await ready(child, "warehouse");
  const nonce = new URL(child.url()).hash.slice("#project=".length);
  const origin = await child.evaluate(() => (window as unknown as DemoWindow).warehouseDemo.snapshot().projectOrigin);
  expect(origin).toMatchObject({ requestId: nonce, scenarioKey: "purchase", sourceInput: input });
  await expect(child.locator("#complex-demo-link")).toHaveAttribute("href", "/demo/warehouse?case=complex");
  await expect(child.locator("#cleaning-demo-link")).toHaveAttribute("href", "/demo/cleaning");
  for (const id of ["complex-demo-link", "cleaning-demo-link"]) {
    await expect(child.locator(`#${id}`)).toHaveAttribute("target", "_blank");
    await expect(child.locator(`#${id}`)).toHaveAttribute("rel", "noopener noreferrer");
  }
  await expect.poll(() => page.evaluate(requestId => (window as unknown as DemoWindow).spatialMessages?.some(message => message.fromChild && message.data.requestId === requestId), nonce), { timeout: 120_000 }).toBe(true);
  const message = await page.evaluate(requestId => (window as unknown as DemoWindow).spatialMessages!.find(message => message.fromChild && message.data.requestId === requestId)!.data, nonce);
  const expectedSnapshot = createSpatialProjectSnapshot({ requestId: nonce, scenarioKey: "purchase", scenarioName: results.scenarios.find(s => s.key === "purchase")!.name, variantId: "calculated", input });
  const result = parseSpatialProjectResult(message, expectedSnapshot);
  expect(result.assessment.terminal).toBe(true);
  expect(result.summary.fleet).toBe(input.robots.count);
  expect(result.summary.requiredPerH).toBe(input.demand.peakPerH);
  await expect(page.locator("[data-guest-calculation]")).toHaveAttribute("data-guest-calculation", "ready", { timeout: 120_000 });
  await expect(simulation.locator('[data-validation-kind="spatial"]')).toHaveAttribute("data-spatial-receipt", result.assessment.status);
  expect(await child.locator("#demo-link").getAttribute("href")).toBe("/demo/warehouse");
  await child.locator("#demo-link").click();
  await expect(child).toHaveURL(new URL("/demo/warehouse", baseURL).href);
  await ready(child, "warehouse");
  expect(await child.evaluate(() => Boolean((window as unknown as DemoWindow).warehouseDemo.snapshot().projectOrigin))).toBe(false);
  await child.close();
  expect(errors).toEqual([]);
});

test("legacy popup redirect retains the project nonce, opener and exact-input message bridge", async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  observeErrors(page, errors);
  // The opener only hosts the bridge. Its viewer's executed input is not a project input.
  await page.goto("/methodology/tz");
  const products = CATALOG.map(productForCalcFromSeed);
  const example = businessExampleInputs("steady-flow", baseValuesFor("warehouse"), products);
  const model = buildProjectModel({ facility: "warehouse", params: example.params, scenarios: example.scenarios,
    paramDefs: paramSpecsFor("warehouse"), products, norms: resolveNorms() });
  const input = model.simInputs.purchase?.calculated;
  if (!input) throw new Error("Canonical business example did not produce a purchase simulation input");
  const snapshot = createSpatialProjectSnapshot({ requestId: randomUUID(), scenarioKey: "purchase", scenarioName: "Проверка маршрута", variantId: "calculated", input,
    ...(model.simInputs.purchase?.provenance ? { provenance: model.simInputs.purchase.provenance } : {}) });
  const popup = page.waitForEvent("popup");
  await page.evaluate(snapshot => {
    const local = window as unknown as DemoWindow;
    local.routingPeer = { snapshot, ready: false, result: null, error: null, child: null };
    window.addEventListener("message", event => {
      const peer = local.routingPeer;
      const message = event.data as { requestId?: string; type?: string; message?: string } | null;
      if (!peer || event.origin !== location.origin || event.source !== peer.child || message?.requestId !== snapshot.requestId) return;
      if (message.type === "spatial-project-ready") {
        peer.ready = true;
        peer.child?.postMessage({ type: "spatial-project-snapshot", requestId: snapshot.requestId, payload: snapshot }, location.origin);
      } else if (message.type === "spatial-project-result") peer.result = event.data;
      else if (message.type === "spatial-project-error") peer.error = message.message ?? "Project handoff failed";
    });
    local.routingPeer.child = window.open(`/warehouse-3d.html?case=bridge#project=${snapshot.requestId}`, "_blank");
  }, snapshot);
  const child = await popup;
  observeErrors(child, errors);
  await child.waitForURL(url => url.pathname === "/demo/warehouse" && url.hash === `#project=${snapshot.requestId}`);
  expect(new URL(child.url()).searchParams.get("case")).toBe("bridge");
  await ready(child, "warehouse");
  await expect.poll(() => page.evaluate(() => Boolean((window as unknown as DemoWindow).routingPeer?.result)), { timeout: 120_000 }).toBe(true);
  const handoff = await page.evaluate(() => {
    const peer = (window as unknown as DemoWindow).routingPeer;
    return { ready: peer?.ready, error: peer?.error, result: peer?.result };
  });
  expect(handoff.ready).toBe(true);
  expect(handoff.error).toBeNull();
  const result = parseSpatialProjectResult(handoff.result, snapshot);
  expect(result.assessment.terminal).toBe(true);
  expect(result.summary.fleet).toBe(input.robots.count);
  expect(result.summary.requiredPerH).toBe(input.demand.peakPerH);
  await child.close();
  expect(errors).toEqual([]);
});
