import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RaasPackage } from "@/lib/tz/types";
import { RaasPackageEditor } from "./raas-package";

describe("RaaS package form and saved terms", () => {
  const value: RaasPackage = {
    firstMonthRub: 250000, startup: { mode: "separate", amountRub: 80000, basis: "per-site" },
    platform: { mode: "separate", amountRub: 12200, basis: "per-robot" },
    service: { mode: "included" }, consumables: { mode: "unassessed" },
    repair: { mode: "unassessed" }, battery: { mode: "unassessed" }, reason: "Рабочая оценка команды, не договор",
  };
  it("prints the saved first payment, price basis and unassessed costs without editing controls", () => {
    const html = renderToStaticMarkup(createElement(RaasPackageEditor, { value, recurringRubMonth: 185000, readOnly: true }));
    expect(html).toContain("250000");
    expect(html).toContain("12200 ₽/мес за робота");
    expect(html).toContain("не оценено");
    expect(html).toContain(value.reason);
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<input");
  });
  it("does not silently preselect unknown services as included", () => {
    const html = renderToStaticMarkup(createElement(RaasPackageEditor, { recurringRubMonth: 185000, onChange: () => {} }));
    expect(html.match(/value="unassessed" selected/g)).toHaveLength(6);
    expect(html).toContain("Неизвестная стоимость не равна нулю");
    expect(html).toContain('min="185000"');
  });
});
