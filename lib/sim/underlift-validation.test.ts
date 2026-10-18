import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { buildClosedPodLayout, validateUnderliftConfig } from "./underlift-layout";

const params = { activeAreaM2: 5000, mainAisleWidthM: 3.5, rackAisleWidthM: 2.8, receivingDocksCount: 4, shippingDocksCount: 4, chargers: 2 };
const source = buildClosedPodLayout(params);
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

describe("indexed underlift validation retains exact geometry", () => {
  it("preserves the complete pre-optimization layout and docking configuration", () => {
    expect(source.layout.slots).toHaveLength(896);
    expect(hash(source.layout)).toBe("86e2661dfda9a2734c079ad556e236ef9cb29a2bb54579515d52f7cc4d4d42e2");
    expect(hash(source.config)).toBe("d5ab2b702f68fdb4965bc1142d2e92355803b5affd09444f1afcd099293277da");
    expect(() => validateUnderliftConfig(source.layout, source.config)).not.toThrow();
  });

  it("still accepts matching dock and entry across adjacent tolerance cells", () => {
    const { layout, config } = structuredClone(source);
    const p = layout.receiving[0]!;
    const dock = config.docks.find(d => d.x === p.x && d.y === p.y)!;
    dock.x += 9e-8;
    dock.entry.x += 9e-8;
    expect(() => validateUnderliftConfig(layout, config)).not.toThrow();
  });

  it("rejects a point outside the original strict distance tolerance", () => {
    const { layout, config } = structuredClone(source);
    const p = layout.receiving[0]!;
    const dock = config.docks.find(d => d.x === p.x && d.y === p.y)!;
    dock.x += 1.1e-7;
    dock.entry.x += 1.1e-7;
    expect(() => validateUnderliftConfig(layout, config)).toThrow("неверный прямой заезд");
  });

  it("detects near-duplicate docks across cell boundaries rather than accepting the first match", () => {
    const { layout, config } = structuredClone(source);
    const first = config.docks[0]!;
    config.docks[config.docks.length - 1] = { ...first, x: first.x + 9e-8, entry: { ...first.entry, x: first.entry.x + 9e-8 } };
    expect(() => validateUnderliftConfig(layout, config)).toThrow("неверный прямой заезд");
  });

  it("deduplicates repeated object references exactly as the original ordered scan", () => {
    const { layout, config } = structuredClone(source);
    layout.receiving.push(layout.receiving[0]!);
    expect(() => validateUnderliftConfig(layout, config)).not.toThrow();
  });

  it.each([NaN, Infinity, -Infinity])("does not accept non-finite coordinates via object identity (%s)", x => {
    const { layout, config } = structuredClone(source);
    const dock = config.docks[0]!;
    dock.x = x;
    layout.slots[0] = dock;
    expect(() => validateUnderliftConfig(layout, config)).toThrow();
  });
});
