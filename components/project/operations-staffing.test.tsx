import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OperationsStaffing } from "./operations-staffing";
import { refusalFieldLabel } from "./refusal-note";

describe("staffing cost display", () => {
  const defaults = { defaultSalaryRubMonth: 120000, defaultPayrollMultiplier: 1.302, defaultAnnualHours: 1973, readOnly: true };
  it("never presents a refused / unknown calculation as zero cost", () => {
    const html = renderToStaticMarkup(createElement(OperationsStaffing, { ...defaults, annualCostRub: null }));
    expect(html).toContain("Не рассчитано");
    expect(html).not.toContain("0 ₽/год");
    expect(html).not.toContain("<form");
    expect(refusalFieldLabel("scenario:operationsStaffing")).toBe("Организация и дополнительные расходы эксплуатации");
    expect(refusalFieldLabel("scenario:costPackage")).toBe("Комплектация покупки и границы платежей");
  });
  it("keeps an explicitly calculated zero and its basis distinct from unknown", () => {
    const html = renderToStaticMarkup(createElement(OperationsStaffing, { ...defaults, annualCostRub: 0,
      value: { mode: "shared-existing", incrementalHoursYear: 300, grossHourlyRub: 0, payrollMultiplier: 1.302, reason: "В текущих обязанностях мастера; доплаты нет — условие примера" } }));
    expect(html).toContain("0 ₽/год"); expect(html).toContain("доплаты нет");
    expect(html).not.toContain("Не рассчитано");
  });
});
