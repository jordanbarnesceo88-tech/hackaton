import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { buildImplementationSnapshot } from "@/lib/implementation/snapshot";
import { ImplementationGuidePanel } from "./guide-panel";

it("exposes class-specific acceptance and sourced service contacts without promising an SLA", () => {
  const html = renderToStaticMarkup(createElement(ImplementationGuidePanel, { snapshot: buildImplementationSnapshot("cleaner", "Pudu"), expanded: true }));
  expect(html).toContain("/knowledge/cleaner");
  expect(html).toContain("долю ручной доработки");
  expect(html).toContain("https://pudurobots.ru/support");
  expect(html).toContain("support@pudurobots.ru");
  expect(html).toContain("Договорный SLA");
  expect(html).toContain("не согласован для объекта");
  expect(html).toContain("условия обслуживания не подтверждены");
  expect(html).toContain("https://www.alfa-int.ru");
  expect(html).toContain("+7 (495) 741-49-50");
  expect(html).toContain("Сведения команды для подготовки договора");
  expect(html).toContain("Работа заказчика");
});
