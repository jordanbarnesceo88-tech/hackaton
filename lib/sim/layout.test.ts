import { describe, expect, it } from "vitest";
import { WAREHOUSE_BASE_LAYOUT } from "./fixtures";
import { LAYOUT_ASSUMPTIONS, LAYOUT_LIMITS, buildWarehouseLayout, isWarehouseLike, sqrtNewton } from "./layout";

describe("sqrtNewton", () => {
  it("совпадает с известными значениями корня (не дальше 1 ulp)", () => {
    // Эталоны — корректно округлённые значения √x в double. Ньютон в двоичной арифметике может
    // остановиться на соседнем числе (1 ulp); для планировки это 1e-14 м, а детерминизм сохраняется.
    expect(Math.abs(sqrtNewton(2) - 1.4142135623730951)).toBeLessThanOrEqual(2.23e-16);
    expect(sqrtNewton(20000)).toBeCloseTo(141.4213562373095, 12);
    expect(sqrtNewton(5000)).toBeCloseTo(70.71067811865476, 12);
    expect(sqrtNewton(4)).toBe(2);
    expect(sqrtNewton(1)).toBe(1);
    expect(sqrtNewton(0.25)).toBe(0.5);
  });

  it("квадрат результата равен аргументу с относительной точностью 1e-15 на широком диапазоне", () => {
    for (const x of [1e-12, 3e-7, 0.1, 0.3, 7, 99, 12345.678, 1e6, 3.3e9, 1e15, 7.7e30]) {
      const r = sqrtNewton(x);
      expect(Math.abs(r * r - x) / x).toBeLessThan(1e-15);
    }
  });

  it("тотальна на краях: 0, отрицательное и NaN — 0, +∞ — +∞", () => {
    expect(sqrtNewton(0)).toBe(0);
    expect(sqrtNewton(-4)).toBe(0);
    expect(sqrtNewton(Number.NaN)).toBe(0);
    expect(sqrtNewton(Infinity)).toBe(Infinity);
  });
});

describe("buildWarehouseLayout", () => {
  const layout = buildWarehouseLayout(WAREHOUSE_BASE_LAYOUT);

  it("прямоугольник 2 : 1 площадью активной зоны", () => {
    expect(layout.widthM).toBeCloseTo(141.42135623730951, 10);
    expect(layout.heightM).toBeCloseTo(70.71067811865476, 10);
    expect(layout.widthM * layout.heightM).toBeCloseTo(10000, 8);
  });

  it("детерминирована", () => {
    expect(buildWarehouseLayout(WAREHOUSE_BASE_LAYOUT)).toEqual(layout);
  });

  it("четыре зоны с подписями, внутри планировки", () => {
    expect(layout.zones.map((z) => z.label).sort()).toEqual(["Зарядка", "Отгрузка", "Приёмка", "Хранение"]);
    for (const z of layout.zones) {
      expect(z.x).toBeGreaterThanOrEqual(0);
      expect(z.y).toBeGreaterThanOrEqual(0);
      expect(z.x + z.w).toBeLessThanOrEqual(layout.widthM + 1e-9);
      expect(z.y + z.h).toBeLessThanOrEqual(layout.heightM + 1e-9);
    }
    const receiving = layout.zones.find((z) => z.kind === "receiving")!;
    const shipping = layout.zones.find((z) => z.kind === "shipping")!;
    const charging = layout.zones.find((z) => z.kind === "charging")!;
    expect(receiving).toMatchObject({ x: 0, w: 8 });
    expect(shipping.x).toBeCloseTo(layout.widthM - 8, 10);
    expect(charging).toMatchObject({ x: 0, y: 0, w: 8, h: 8 });
  });

  it("поперечные проезды: main/2, H/2, H − main/2", () => {
    expect(layout.crossAislesY).toEqual([1.75, layout.heightM / 2, layout.heightM - 1.75]);
  });

  it("стеллажные проходы: x = 12 + k × (2,8 + 2,4), пока x < W − 12", () => {
    expect(layout.rackAislesX.length).toBe(23);
    layout.rackAislesX.forEach((x, k) => expect(x).toBeCloseTo(12 + k * 5.2, 10));
    expect(layout.rackAislesX.at(-1)!).toBeLessThan(layout.widthM - 12);
  });

  it("места хранения — на осях проходов через 4 м, вне полос поперечных проездов", () => {
    expect(layout.slots.length).toBe(23 * 15);
    for (const s of layout.slots) {
      expect(layout.rackAislesX).toContain(s.x);
      expect((s.y - 2) % LAYOUT_ASSUMPTIONS.slotPitchM).toBeCloseTo(0, 10);
      for (const c of layout.crossAislesY) expect(Math.abs(s.y - c)).toBeGreaterThan(1.75);
      expect(s.y).toBeGreaterThan(0);
      expect(s.y).toBeLessThan(layout.heightM);
    }
  });

  it("ворота равномерно по высоте своих полос, зарядки — в углу", () => {
    expect(layout.receiving.map((p) => p.id)).toEqual(["R1", "R2", "R3", "R4"]);
    expect(layout.shipping.map((p) => p.id)).toEqual(["S1", "S2", "S3", "S4"]);
    for (const p of layout.receiving) {
      expect(p.x).toBe(4);
      expect(p.y).toBeGreaterThan(8);
      expect(p.y).toBeLessThan(layout.heightM);
    }
    const gaps = layout.shipping.slice(1).map((p, i) => p.y - layout.shipping[i]!.y);
    for (const g of gaps) expect(g).toBeCloseTo(layout.heightM / 5, 10);
    expect(layout.chargers).toEqual([{ id: "C1", kind: "charger", x: 4, y: 4 }]);

    const many = buildWarehouseLayout({ ...WAREHOUSE_BASE_LAYOUT, chargers: 7 });
    expect(many.chargers).toHaveLength(7);
    for (const c of many.chargers) {
      expect(c.x).toBeGreaterThan(0);
      expect(c.x).toBeLessThan(8);
      expect(c.y).toBeGreaterThan(0);
      expect(c.y).toBeLessThan(8);
    }
    expect(new Set(many.chargers.map((c) => `${c.x}:${c.y}`)).size).toBe(7);
  });

  it("без зарядных станций зарядок нет; дробное число ворот округляется, не меньше одних", () => {
    const l = buildWarehouseLayout({ ...WAREHOUSE_BASE_LAYOUT, chargers: 0, receivingDocksCount: 0, shippingDocksCount: 2.6 });
    expect(l.chargers).toHaveLength(0);
    expect(l.receiving).toHaveLength(1);
    expect(l.shipping).toHaveLength(3);
  });

  it("заведомо ошибочные величины прижимаются к защитным пределам", () => {
    const l = buildWarehouseLayout({
      ...WAREHOUSE_BASE_LAYOUT,
      activeAreaM2: 1e12,
      receivingDocksCount: 1e9,
      chargers: 1e9,
    });
    expect(l.widthM * l.heightM).toBeCloseTo(LAYOUT_LIMITS.maxActiveAreaM2, 3);
    expect(l.receiving).toHaveLength(LAYOUT_LIMITS.maxPointsPerKind);
    expect(l.chargers).toHaveLength(LAYOUT_LIMITS.maxPointsPerKind);
  });

  it("маленькая площадь даёт вырожденную, но пригодную планировку", () => {
    const l = buildWarehouseLayout({ ...WAREHOUSE_BASE_LAYOUT, activeAreaM2: 200 });
    expect(l.rackAislesX.length).toBeGreaterThanOrEqual(1);
    expect(l.slots.length).toBeGreaterThanOrEqual(1);
    const bad = buildWarehouseLayout({ ...WAREHOUSE_BASE_LAYOUT, activeAreaM2: -5, mainAisleWidthM: Number.NaN });
    expect(bad.slots.length).toBeGreaterThanOrEqual(1);
    expect(Number.isFinite(bad.widthM)).toBe(true);
  });
});

describe("isWarehouseLike", () => {
  it("склад и складоподобные объекты — да, остальное — нет", () => {
    for (const slug of [
      "warehouse",
      "fulfillment",
      "darkstore",
      "cold-storage",
      "distribution-center",
      "parcel-hub",
      "pharmacy-warehouse",
      "pharma-warehouse",
      "mine-warehouse",
    ]) {
      expect(isWarehouseLike(slug)).toBe(true);
    }
    for (const slug of ["airport", "medical", "hospital", "other", ""]) expect(isWarehouseLike(slug)).toBe(false);
  });
});
