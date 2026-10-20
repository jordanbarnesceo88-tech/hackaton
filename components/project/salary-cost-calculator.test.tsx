import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { paramSpecsFor } from "@/lib/data/organizer/params";
import { ParamsForm } from "./params-form";
import { SalaryCostCalculator } from "./salary-cost-calculator";

const salaries = [
  { key: "forkliftSalaryRubMonth", label: "Оператор погрузчика (gross)", grossSalaryRubMonth: 120000 },
  { key: "cleanerSalaryRubMonth", label: "Уборщик склада (gross)", grossSalaryRubMonth: 65000 },
];
const normalize = (text: string) => text.replace(/\s/g, " ");

describe("inline payroll calculator", () => {
  it("shows the editable source inputs, real gross, all-in chain and common multiplier scope before apply", () => {
    const onApply = vi.fn();
    const html = normalize(renderToStaticMarkup(createElement(SalaryCostCalculator, { salaries, currentPayrollMultiplier: 1.302, onApply })));
    expect(html).toContain("Калькулятор ФОТ");
    for (const text of ["На руки за смену", "Оплачиваемых смен в месяц", "Удержания из gross", "Начисления работодателя", "Накладные расходы", "Наценка подрядчика", "Источник / основание расчёта"]) expect(html).toContain(text);
    for (const number of ["117 000,00", "134 482,76", "175 500,00", "193 050,00", "212 355,00", "2 548 260,00"]) expect(html).toContain(number);
    expect(html).toContain("1,302000 → 1,579050");
    expect(html).toContain("Коэффициент применяется ко всем зарплатным ролям объекта");
    expect(html).toContain("численность, рабочий график и ставки персонала не меняются");
    expect(html).toContain('value="Оценка команды"');
    expect(html).toMatch(/type="checkbox"[^>]*checked/);
    expect(html).toContain("Применить gross и общий коэффициент");
    expect(html).not.toContain("163 099"); expect(html).not.toContain("<dialog");
    expect(onApply).not.toHaveBeenCalled();
  });

  it("uses unique label associations and disables application for a malformed salary target", () => {
    const html = renderToStaticMarkup(createElement(SalaryCostCalculator, { salaries, currentPayrollMultiplier: null, onApply: () => {} }));
    const labels = [...html.matchAll(/<label[^>]*for="([^"]+)"/g)].map(match => match[1]!);
    expect(new Set(labels).size).toBe(labels.length);
    for (const id of labels) expect(html).toContain(`id="${id}"`);
    expect(normalize(html)).toContain("не задан → 1,579050");
    const malformed = renderToStaticMarkup(createElement(SalaryCostCalculator, { salaries: [{ ...salaries[0]!, key: "__proto__" }], currentPayrollMultiplier: 1.302, onApply: () => {} }));
    expect(malformed).toContain('role="alert"');
    expect(malformed).toMatch(/<button[^>]*disabled/);
  });

  it("adds exactly one worksheet to editable ParamsForm with a batch callback; readonly archives stay unchanged", () => {
    const defs = paramSpecsFor("warehouse").filter(def => ["forkliftSalaryRubMonth", "pickerSalaryRubMonth", "payrollTaxMultiplier"].includes(def.key));
    const props = { defs, values: { forkliftSalaryRubMonth: 120000, pickerSalaryRubMonth: 100000, payrollTaxMultiplier: 1.302 }, baseValues: {}, issues: [], onChange: () => {} };
    const withBatch = renderToStaticMarkup(createElement(ParamsForm, { ...props, onApplyPayroll: () => {} }));
    expect([...withBatch.matchAll(/data-payroll-calculator/g)]).toHaveLength(1);
    expect(withBatch).toContain('value="forkliftSalaryRubMonth" selected');
    expect(renderToStaticMarkup(createElement(ParamsForm, props))).not.toContain("data-payroll-calculator");
    expect(renderToStaticMarkup(createElement(ParamsForm, { ...props, onApplyPayroll: () => {}, readOnly: true }))).not.toContain("data-payroll-calculator");
  });
});
