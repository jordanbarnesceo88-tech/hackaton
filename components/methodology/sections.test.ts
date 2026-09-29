import { describe, expect, it } from "vitest";
import map from "@/public/methodology/00-map.json";
import { FORMULAS } from "@/lib/tz/econ/formulas";
import { FORMULA_GROUPS, methodologyAnchors } from "./sections";

describe("карта расчёта методики", () => {
  it("каждая станция ведёт на существующий раздел страницы", () => {
    const anchors = methodologyAnchors();
    for (const h of map.hotspots) {
      expect(h.href.startsWith("#"), h.id).toBe(true);
      expect(anchors.has(h.href.slice(1)), `${h.id} → ${h.href}`).toBe(true);
    }
  });

  it("станции не перекрывают друг друга и лежат внутри рисунка", () => {
    const hs = map.hotspots;
    for (const h of hs) {
      expect(h.x >= 0 && h.y >= 0 && h.x + h.w <= map.width && h.y + h.h <= map.height, h.id).toBe(true);
    }
    for (let i = 0; i < hs.length; i++) {
      for (let j = i + 1; j < hs.length; j++) {
        const [a, b] = [hs[i]!, hs[j]!];
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap, `${a.id} и ${b.id}`).toBe(false);
      }
    }
  });

  it("у каждой группы формул своя станция", () => {
    const targets = new Set(map.hotspots.map((h) => h.href.slice(1)));
    for (const g of FORMULA_GROUPS) expect(targets.has(g.id), g.id).toBe(true);
  });
});

describe("группы формул", () => {
  it("ключи групп — существующие формулы, без повторов", () => {
    const keys = FORMULA_GROUPS.flatMap((g) => g.keys);
    for (const k of keys) expect(FORMULAS[k], k).toBeDefined();
    expect(new Set(keys).size).toBe(keys.length);
  });
});
