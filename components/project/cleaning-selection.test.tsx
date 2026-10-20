import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { baseValuesFor } from "@/lib/data/organizer/params";
import { VENDOR_CLEANING_PRODUCTS } from "@/lib/data/vendor-cleaning";
import { productForCalcFromSeed } from "@/lib/catalog/product-for-calc";
import { warehouseCleaningInputs } from "@/lib/projects/cleaning-example";
import { compareCleaningOptions, type CleaningSelectionInput } from "@/lib/tz/cleaning-selection";
import { resolveNorms } from "@/lib/tz/norms";
import { applyCleaningSelection, CleaningSelectionPanel } from "./cleaning-selection";

function input(): CleaningSelectionInput {
  const products = VENDOR_CLEANING_PRODUCTS.map(productForCalcFromSeed);
  return { facility: "warehouse", params: warehouseCleaningInputs(baseValuesFor("warehouse"), products).params, products, norms: resolveNorms(), mode: "scrubbing" };
}
describe("cleaning selection panel", () => {
  it("renders all three physically comparable options and unknown prices without auto-applying", () => {
    const onApply = vi.fn();
    const html = renderToStaticMarkup(createElement(CleaningSelectionPanel, { ...input(), onApply }));
    for (const name of ["PUDU CC1", "AGIBOT C5", "VIGGO SC80"]) expect(html).toContain(name);
    expect(html).toContain("Финансовый вариант не ранжируется"); expect(html).toContain("цена не задана");
    expect(html).toContain("Цикл, уход и выработка редактируются"); expect(html).toContain("не подтверждение качества уборки");
    expect(html).toContain("Применить цены к сравнению"); expect(html).toContain("Источник цен");
    expect(html).not.toContain("NPV 0 ₽"); expect(html).not.toContain("fetch("); expect(onApply).not.toHaveBeenCalled();
  });
  it("applies two isolated scenarios only on the explicit action and refuses excluded options", () => {
    const rows = compareCleaningOptions(input()), onApply = vi.fn();
    applyCleaningSelection(rows[1]!, onApply);
    expect(onApply).toHaveBeenCalledOnce();
    const specs = onApply.mock.calls[0]![0];
    expect(specs.map((spec: { kind: string }) => spec.kind)).toEqual(["purchase", "raas"]);
    expect(specs.every((spec: { items: { productSlug: string }[] }) => spec.items[0]?.productSlug === "agibot-c5")).toBe(true);
    expect(specs[0].items[0]).not.toHaveProperty("priceRubOverride");
    onApply.mockClear();
    expect(applyCleaningSelection({ ...rows[0]!, status: "excluded", reasons: ["Узкий проход"] }, onApply)).toBe("Узкий проход");
    expect(onApply).not.toHaveBeenCalled();
  });
  it("does not calculate new working estimates or expose editors in a historical archive", () => {
    const onApply = vi.fn();
    const html = renderToStaticMarkup(createElement(CleaningSelectionPanel, { ...input(), readOnly: true, onApply }));
    expect(html).toContain("Архив открыт без пересчёта");
    expect(html).not.toContain("550"); expect(html).not.toContain("<input"); expect(html).not.toContain("<button");
    expect(onApply).not.toHaveBeenCalled();
  });
});
