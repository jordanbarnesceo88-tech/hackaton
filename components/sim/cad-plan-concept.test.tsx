import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CadPlanConcept } from "./cad-plan-concept";

describe("CAD plan concept boundary", () => {
  it("offers an inspectable concept without accepting files or changing geometry", () => {
    const html = renderToStaticMarkup(createElement(CadPlanConcept));
    expect(html).toContain("Загрузить схему · концепт CAD");
    expect(html).toContain("Импорт DWG, DXF и SVG пока не реализован");
    expect(html).toContain("файл не загружается и текущий расчёт не меняется");
    expect(html).toContain("контрольный размер");
    expect(html).toContain("связность маршрутов");
    expect(html).toContain("новый серверный расчёт");
    expect(html).toContain('href="/methodology/tz#limitations"');
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<details open");
  });
});
