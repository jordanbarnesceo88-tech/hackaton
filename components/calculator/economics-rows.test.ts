import { describe, it, expect } from "vitest";
import { economicsRows, PANEL_LABELS, REPORT_LABELS } from "./economics-rows";
import { computeEconomics } from "@/lib/economics/calculate";
import { makeAssumptions, makeCapacity, makeParams } from "@/lib/economics/fixtures";
import { isCalculable, type CalculableResult } from "@/lib/economics/types";

function calculable(overrides = {}, paramOverrides = {}): CalculableResult {
  const r = computeEconomics(
    makeCapacity(overrides),
    makeParams(paramOverrides),
    makeAssumptions()
  );
  if (!isCalculable(r)) throw new Error("fixture expected to be calculable");
  return r;
}

/**
 * Золотой снимок отрисованных строк.
 *
 * Существует потому, что «паритет панели и отчёта» ничего не гарантировал по построению: обе
 * поверхности зовут ОДИН `economicsRows`, поэтому e2e «report figures match the calculator panel
 * exactly» сравнивал два отображения одного вызова. Разойтись там нечему, и тест ловил ровно два
 * случая — разъехавшиеся подписи и не отрисовавшуюся поверхность.
 *
 * Гарантия появляется только от НЕЗАВИСИМО зафиксированного ответа. Отсюда снимок: любое
 * изменение модели, которое двигает хоть одну цифру на экране, роняет этот тест — и обновить его
 * можно только осознанно, отдельным действием. Это правило «МЕНЯЕТ ЧИСЛА» в виде теста, а не
 * договорённости.
 *
 * Если тест упал, а число менять НЕ собирались — упало по делу.
 */
describe("золотой снимок: что видит человек на экране", () => {
  // Пробел в русском формате чисел — узкий неразрывный (U+202F), и в исходнике теста он
  // невидим: следующий, кто станет править снимок, скопирует обычный пробел и получит
  // расхождение, которого не увидит глазами. Поэтому КЛАСС пробела намеренно вне снимка —
  // пиннятся цифры, валюта и подписи. Смена пробела косметична; смена цифры — нет.
  const norm = (rows: { key: string; label: string; value: string }[]) =>
    rows.map((r) => ({ ...r, value: r.value.replace(/[\u00a0\u202f\u2009]/g, " ") }));

  it("панель показывает ровно эти десять строк", () => {
    expect(norm(economicsRows(calculable(), 90, PANEL_LABELS))).toEqual([
      { key: "quantity", label: "Требуется единиц", value: "1" },
      { key: "displacedFte", label: "Замещается персонала (ЭПЗ)", value: "8.0" },
      { key: "capex", label: "CAPEX", value: "5 175 000 ₽ (US$57,500)" },
      { key: "opex", label: "OPEX/год", value: "810 000 ₽ (US$9,000)" },
      { key: "baseline", label: "Базовые затраты на труд/год", value: "9 648 000 ₽ (US$107,200)" },
      { key: "savings", label: "Годовая экономия", value: "3 531 600 ₽ (US$39,240)" },
      { key: "simplePayback", label: "Срок окупаемости (простой)", value: "1,5 года" },
      { key: "discountedPayback", label: "Срок окупаемости (дисконт.)", value: "1,7 года" },
      { key: "roi", label: "ROI (простой, без дисконтирования)", value: "241%" },
      { key: "npv", label: "NPV (чистая приведённая стоимость)", value: "7 555 628 ₽ (US$83,951)" },
    ]);
  });

  it("отчёт показывает ТЕ ЖЕ значения — расходятся только две подписи", () => {
    // Настоящее содержание паритета: одинаковы ЧИСЛА, а не разметка. Подписи различаются
    // намеренно — в отчёте они короче.
    const panel = economicsRows(calculable(), 90, PANEL_LABELS);
    const report = economicsRows(calculable(), 90, REPORT_LABELS);
    expect(report.map((r) => r.value)).toEqual(panel.map((r) => r.value));
    const differing = panel.filter((p, i) => p.label !== report[i]!.label).map((p) => p.key);
    expect(differing).toEqual(["roi", "npv"]);
  });
});

describe("economicsRows", () => {
  it("emits the ten figures in order for an economical result", () => {
    const rows = economicsRows(calculable(), 90, PANEL_LABELS);
    expect(rows.map((r) => r.key)).toEqual([
      "quantity",
      "displacedFte",
      "capex",
      "opex",
      "baseline",
      "savings",
      "simplePayback",
      "discountedPayback",
      "roi",
      "npv",
    ]);
  });

  it("stops after the five common figures when the solution does not pay back", () => {
    // OPEX far above any labor saving -> no_savings, which carries the common fields only.
    const r = calculable({ maintenanceUsdYear: 5_000_000 });
    expect(r.economical).toBe(false);
    expect(economicsRows(r, 90, PANEL_LABELS).map((x) => x.key)).toEqual([
      "quantity",
      "displacedFte",
      "capex",
      "opex",
      "baseline",
    ]);
  });

  it("uses the caller's ROI/NPV label variant and nothing else differs", () => {
    const panel = economicsRows(calculable(), 90, PANEL_LABELS);
    const report = economicsRows(calculable(), 90, REPORT_LABELS);
    expect(panel.map((r) => r.value)).toEqual(report.map((r) => r.value));
    const differing = panel
      .filter((r, i) => r.label !== report[i]!.label)
      .map((r) => r.key);
    expect(differing).toEqual(["roi", "npv"]);
    expect(report.find((r) => r.key === "roi")!.label).toBe("ROI (простой)");
    expect(panel.find((r) => r.key === "npv")!.label).toBe("NPV (чистая приведённая стоимость)");
  });

  it("words a payback that never lands inside the horizon rather than printing a number", () => {
    // Savings barely positive against a large CAPEX -> discounted payback exceeds the horizon.
    const r = calculable({ priceUsd: 400_000 });
    const row = economicsRows(r, 90, PANEL_LABELS).find((x) => x.key === "discountedPayback");
    expect(row?.value).toBe("не окупается в пределах горизонта");
  });

  it("formats money against the supplied USD→RUB rate", () => {
    const rows = economicsRows(calculable(), 90, PANEL_LABELS);
    const capex = rows.find((r) => r.key === "capex")!.value;
    const doubled = economicsRows(calculable(), 180, PANEL_LABELS).find(
      (r) => r.key === "capex"
    )!.value;
    expect(capex).not.toBe(doubled); // the RUB half of the label tracks the rate
    expect(capex).toContain("57"); // 1 unit x $50k x 1.15 install = $57,500
  });
});
