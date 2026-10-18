import { describe, expect, it } from "vitest";
import { siteSegmentIsClear, validateSiteLayout } from "../../lib/sim/site-layout";
import { complexSite } from "./site";
import { prepareWarehouseTraffic } from "./traffic";
import { calculateCase, createPlayback, playbackFrame } from "./core";

describe("owned L-shaped mobile storage", () => {
  it("fills compact paired rows with actual pod homes while keeping explicit legacy solids unchanged", () => {
    const explicit = complexSite(10000, 1), mobile = complexSite(10000, 1, true);
    expect(explicit.slots).toHaveLength(15);
    expect(explicit.obstacles?.filter(r => r.kind === "rack")).toHaveLength(6);
    expect(mobile.slots).toHaveLength(768);
    expect(mobile.obstacles).toEqual(explicit.obstacles?.filter(r => r.kind !== "rack"));
    for (const key of ["footprint", "walls", "columns", "doors", "receiving", "shipping", "chargers"] as const) expect(mobile[key]).toEqual(explicit[key]);
    expect(validateSiteLayout(mobile)).toEqual([]);
    expect(mobile.zones.find(z => z.kind === "storage")?.label).toBe("Зоны мобильных стеллажей");
  });

  it.each([5000, 10000])("prepares real docking spurs and a permanent pod registry at %i m²", (areaM2) => {
    const site = complexSite(areaM2, 1, true);
    const input = prepareWarehouseTraffic({ seed: 1, layout: { activeAreaM2: areaM2, mainAisleWidthM: 3.5, rackAisleWidthM: 2.8, receivingDocksCount: 2, shippingDocksCount: 2, chargers: 1 }, siteLayout: site, robots: { count: 3, speedMps: 1.5, loadedSpeedFactor: 0.8, handlingSec: 20, autonomyH: null, chargeMin: null, payloadKg: 1500 }, demand: { avgPerH: 0, peakPerH: 0, warmupMin: 0, peakMin: 20 }, loadMassKg: 800, thresholds: { servedShareMin: 0.97, p95WaitMaxMin: 10, oversizedIdleShare: 0.4 }, charge: { startSoc: 0.2, stopSoc: 0.9 } });
    const frame = playbackFrame(createPlayback(input));
    expect(frame.carriers).toHaveLength(site.slots.length);
    expect(frame.carriers.length).toBeGreaterThan(300);
    expect(frame.carriers.every(p => p.phase === "parked" && p.visible && p.liftM === 0)).toBe(true);
    expect(input.siteLayout!.obstacles).toEqual(site.obstacles);
    expect(validateSiteLayout(input.siteLayout!)).toEqual([]);
    for (const dock of input.demoUnderlift!.docks) expect(siteSegmentIsClear(input.siteLayout!, dock, dock.entry)).toBe(true);
  });

  it("uses the mobile storage plan as the financial source of the existing complex preset", () => {
    const model = calculateCase("complex", { fleet: 3 });
    expect(model.racks).toEqual([]);
    expect(model.layout.slots).toHaveLength(768);
    expect(model.financialSourceInput?.siteLayout?.slots).toEqual(model.layout.slots);
    expect(model.financialSourceInput?.siteLayout?.obstacles).toEqual(model.layout.obstacles);
    expect(model.assessment.checks.find(c => c.id === "safety")?.status).toBe("PASS");
  },30000);
});
